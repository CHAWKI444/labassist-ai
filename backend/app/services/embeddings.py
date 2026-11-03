from typing import Protocol

import httpx
import numpy as np

from app.core.config import Settings


class EmbeddingError(Exception):
    pass


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> np.ndarray:
        """Return an (n, dim) float32 array of L2-normalised vectors."""
        ...


def _normalise(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype="float32")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return vectors / norms


class OllamaEmbedder:
    """BAAI/bge-m3 served by Ollama (`ollama pull bge-m3`)."""

    def __init__(self, settings: Settings):
        self.base_url = settings.ollama_base_url.rstrip("/")
        self.model = settings.embedding_model
        self.batch_size = settings.embedding_batch_size
        self.name = f"ollama:{self.model}"

    def embed(self, texts: list[str]) -> np.ndarray:
        if not texts:
            raise EmbeddingError("Nothing to embed")
        out: list[list[float]] = []
        try:
            with httpx.Client(timeout=httpx.Timeout(300.0, connect=5.0)) as client:
                for start in range(0, len(texts), self.batch_size):
                    batch = texts[start : start + self.batch_size]
                    response = client.post(
                        f"{self.base_url}/api/embed",
                        json={"model": self.model, "input": batch, "keep_alive": "10m"},
                    )
                    if response.status_code != 200:
                        raise EmbeddingError(
                            f"Ollama embedding failed (HTTP {response.status_code}): {response.text[:200]}"
                        )
                    out.extend(response.json()["embeddings"])
        except httpx.ConnectError as exc:
            raise EmbeddingError(f"Cannot reach Ollama at {self.base_url}") from exc
        except httpx.HTTPError as exc:
            raise EmbeddingError(f"Embedding request failed: {type(exc).__name__}") from exc
        return _normalise(np.array(out))


class SentenceTransformerEmbedder:
    """BAAI/bge-m3 loaded in-process (requires requirements-st.txt)."""

    def __init__(self, settings: Settings):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:  # pragma: no cover - optional dependency
            raise EmbeddingError("Install requirements-st.txt to use the sentence-transformers backend") from exc
        model_name = settings.embedding_model if "/" in settings.embedding_model else "BAAI/bge-m3"
        self._model = SentenceTransformer(model_name)
        self.batch_size = settings.embedding_batch_size
        self.name = f"st:{model_name}"

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = self._model.encode(texts, batch_size=self.batch_size, normalize_embeddings=True)
        return _normalise(vectors)


def build_embedder(settings: Settings) -> Embedder:
    if settings.embedding_backend == "sentence-transformers":
        return SentenceTransformerEmbedder(settings)
    return OllamaEmbedder(settings)
