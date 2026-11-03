from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_DIR / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "LabAssist AI"
    environment: str = "development"

    database_url: str = "postgresql+psycopg2://labassist:labassist@localhost:5432/labassist"

    secret_key: str = ""
    access_token_expire_minutes: int = 120
    allow_self_registration: bool = True
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "mistral"
    ollama_num_ctx: int = 4096
    ollama_keep_alive: str = "30m"
    ollama_timeout_seconds: float = 300.0
    llm_temperature: float = 0.2
    llm_max_answer_tokens: int = 512

    embedding_backend: str = "ollama"  # "ollama" or "sentence-transformers"
    embedding_model: str = "bge-m3"  # Ollama tag; use "BAAI/bge-m3" with sentence-transformers
    embedding_batch_size: int = 16

    data_dir: Path = BACKEND_DIR / "data"
    max_upload_mb: int = 20
    chunk_size_chars: int = 1000
    chunk_overlap_chars: int = 150
    rag_top_k: int = 4
    rag_min_score: float = 0.45

    cag_max_context_tokens: int = 1500

    memory_retention_days: int = 180
    memory_max_per_user: int = 50
    memory_max_chars: int = 300

    metrics_retention_days: int = 90
    # Dashboard alerts are only raised once a window holds at least alert_min_requests chat requests.
    alert_min_requests: int = 5
    alert_p95_ms: int = 60000
    alert_error_rate_pct: float = 10.0
    alert_no_source_rate_pct: float = 30.0

    # LabVision AI: uploaded datasets are parsed in memory and never written to disk.
    labvision_max_upload_mb: int = 10
    labvision_max_rows: int = 100_000
    labvision_max_columns: int = 200
    labvision_dataset_ttl_minutes: int = 30
    labvision_max_datasets_per_user: int = 3
    labvision_max_findings: int = 5000
    labvision_retention_days: int = 30

    frontend_base_url: str = "http://localhost:5173"
    invitation_expire_hours: int = 72

    # "smtp" sends real emails; "outbox" writes .eml files to DATA_DIR/outbox (development, nothing is sent).
    email_backend: str = "outbox"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "LabAssist AI <no-reply@labassist.local>"
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    smtp_timeout_seconds: float = 15.0

    # Used only by app.scripts.seed
    admin_email: str = ""
    admin_password: str = ""
    demo_user_password: str = ""

    @field_validator("embedding_backend")
    @classmethod
    def _check_backend(cls, value: str) -> str:
        if value not in ("ollama", "sentence-transformers"):
            raise ValueError("EMBEDDING_BACKEND must be 'ollama' or 'sentence-transformers'")
        return value

    @field_validator("email_backend")
    @classmethod
    def _check_email_backend(cls, value: str) -> str:
        if value not in ("smtp", "outbox"):
            raise ValueError("EMAIL_BACKEND must be 'smtp' or 'outbox'")
        return value

    @property
    def outbox_dir(self) -> Path:
        return self.data_dir / "outbox"

    @property
    def avatar_dir(self) -> Path:
        return self.data_dir / "avatars"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def upload_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def index_dir(self) -> Path:
        return self.data_dir / "faiss"

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def labvision_max_upload_bytes(self) -> int:
        return self.labvision_max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.secret_key or len(settings.secret_key) < 32:
        raise RuntimeError(
            "SECRET_KEY must be set (>= 32 characters) in the environment or .env file. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )
    settings.upload_dir.mkdir(parents=True, exist_ok=True)
    settings.index_dir.mkdir(parents=True, exist_ok=True)
    return settings
