"""Optional end-to-end checks against a real local Ollama. Run with: pytest -m ollama"""

import asyncio

import httpx
import numpy as np
import pytest

from app.core.config import Settings
from app.services.embeddings import OllamaEmbedder
from app.services.llm import OllamaClient

pytestmark = pytest.mark.ollama


@pytest.fixture(scope="module")
def real_settings() -> Settings:
    settings = Settings(secret_key="x" * 40)
    try:
        httpx.get(f"{settings.ollama_base_url}/api/version", timeout=3).raise_for_status()
    except httpx.HTTPError:
        pytest.skip("Ollama is not running")
    return settings


def test_bge_m3_embeddings_are_multilingual(real_settings):
    embedder = OllamaEmbedder(real_settings)
    vectors = embedder.embed(
        [
            "Faut-il être à jeun avant une prise de sang ?",
            "Do I need to fast before a blood test?",
            "The parking lot is behind the building.",
        ]
    )
    assert vectors.shape[0] == 3
    assert np.allclose(np.linalg.norm(vectors, axis=1), 1.0, atol=1e-3)
    same_meaning = float(vectors[0] @ vectors[1])
    unrelated = float(vectors[0] @ vectors[2])
    assert same_meaning > unrelated


def test_chat_model_streams_answer(real_settings):
    client = OllamaClient(real_settings)

    async def collect():
        text, usage = "", None
        async for chunk in client.stream_chat([{"role": "user", "content": "Reply with the single word: OK"}]):
            text += chunk.text
            usage = chunk.usage or usage
        return text, usage

    text, usage = asyncio.run(collect())
    assert text.strip()
    assert usage is not None and usage.completion_tokens
