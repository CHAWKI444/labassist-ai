import hashlib
import os
import re
import tempfile
from collections.abc import AsyncIterator

os.environ["SECRET_KEY"] = "test-secret-key-for-pytest-only-0123456789abcdef"
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="labassist-test-")
os.environ["DATABASE_URL"] = "sqlite://"

import numpy as np  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import app.models  # noqa: E402,F401
from app.core.config import Settings  # noqa: E402
from app.core.database import Base, enable_sqlite_foreign_keys  # noqa: E402
from app.core.security import create_access_token, hash_password  # noqa: E402
from app.models import User  # noqa: E402
from app.services.container import build_services  # noqa: E402
from app.services.email import EmailResult  # noqa: E402
from app.services.llm import LLMError, LLMUsage, StreamChunk  # noqa: E402
from app.services.text import keywords  # noqa: E402


class HashingEmbedder:
    """Test double: deterministic bag-of-words vectors so retrieval behaves meaningfully offline."""

    name = "test:hashing"
    dim = 256

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), self.dim), dtype="float32")
        for row, text in enumerate(texts):
            for word in keywords(text):
                out[row, int(hashlib.md5(word.encode()).hexdigest(), 16) % self.dim] += 1.0
        norms = np.linalg.norm(out, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return out / norms


class ScriptedLLM:
    """Test double: records prompts and answers by citing the first tags present in the prompt."""

    model = "test-llm"

    def __init__(self):
        self.calls: list[list[dict]] = []
        self.fail_next = False

    async def health(self) -> dict:
        return {"reachable": True, "chat_model": self.model, "chat_model_available": True}

    async def stream_chat(self, messages: list[dict]) -> AsyncIterator[StreamChunk]:
        self.calls.append(messages)
        if self.fail_next:
            self.fail_next = False
            raise LLMError("Cannot reach Ollama (simulated)")
        prompt = "\n".join(m["content"] for m in messages)
        tags = [t for t in ("[D1]", "[KB1]", "[KB2]", "[KB3]") if t in prompt]
        for word in ["Test", " answer"] + [f" {t}" for t in tags[:2]]:
            yield StreamChunk(text=word)
        yield StreamChunk(usage=LLMUsage(model=self.model, prompt_tokens=123, completion_tokens=7, eval_ms=70))


class RecordingEmailSender:
    """Test double: keeps sent messages in memory instead of delivering them."""

    def __init__(self):
        self.sent: list[dict] = []
        self.fail = False

    def send(self, to, subject, text, html=None):
        if self.fail:
            return EmailResult("failed", "SMTP delivery failed (simulated)")
        self.sent.append({"to": to, "subject": subject, "text": text, "html": html})
        return EmailResult("sent")

    def last_token(self) -> str:
        match = re.search(r"#token=([\w-]+)", self.sent[-1]["text"])
        assert match, "no invitation link in the last email"
        return match.group(1)


@pytest.fixture(autouse=True)
def _reset_login_throttle():
    from app.api import auth as auth_api

    auth_api._failures.clear()
    yield


@pytest.fixture()
def settings(tmp_path) -> Settings:
    return Settings(
        _env_file=None,
        secret_key=os.environ["SECRET_KEY"],
        database_url="sqlite://",
        data_dir=tmp_path,
        rag_min_score=0.2,
        chunk_size_chars=400,
        chunk_overlap_chars=50,
    )


@pytest.fixture()
def sessions():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    enable_sqlite_foreign_keys(engine)
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    yield factory
    engine.dispose()


@pytest.fixture()
def llm() -> ScriptedLLM:
    return ScriptedLLM()


@pytest.fixture()
def mailer() -> RecordingEmailSender:
    return RecordingEmailSender()


@pytest.fixture()
def services(settings, sessions, llm, mailer):
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    return build_services(settings, sessions, embedder=HashingEmbedder(), llm=llm, email=mailer, persist_index=False)


@pytest.fixture()
def client(services):
    from app.main import create_app

    with TestClient(create_app(services)) as test_client:
        yield test_client


@pytest.fixture()
def db(sessions):
    with sessions() as session:
        yield session


def _make_user(db, email: str, role: str, memory_enabled: bool = True) -> User:
    user = User(email=email, full_name=email.split("@")[0], hashed_password=hash_password("password123"),
                role=role, memory_enabled=memory_enabled)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@pytest.fixture()
def users(db) -> dict[str, User]:
    return {
        "admin": _make_user(db, "admin@test.local", "admin"),
        "staff": _make_user(db, "staff@test.local", "staff"),
        "patient": _make_user(db, "patient@test.local", "patient"),
        "patient2": _make_user(db, "patient2@test.local", "patient"),
    }


def auth(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token(user.id, user.role)}"}
