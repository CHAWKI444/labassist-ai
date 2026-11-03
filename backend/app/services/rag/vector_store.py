import json
import logging
import threading
from pathlib import Path

import faiss
import numpy as np

logger = logging.getLogger(__name__)


class FaissStore:
    """Cosine-similarity index (inner product on normalised vectors) keyed by chunk id."""

    def __init__(self, directory: Path | None, embedder_name: str):
        self.directory = directory
        self.embedder_name = embedder_name
        self._lock = threading.RLock()
        self._index: faiss.IndexIDMap2 | None = None
        self.dimension: int | None = None
        self.needs_rebuild = False

    @property
    def _index_path(self) -> Path | None:
        return self.directory / "index.faiss" if self.directory else None

    @property
    def _meta_path(self) -> Path | None:
        return self.directory / "index.json" if self.directory else None

    def load(self) -> None:
        with self._lock:
            if not self._index_path or not self._index_path.exists():
                return
            meta = json.loads(self._meta_path.read_text()) if self._meta_path.exists() else {}
            if meta.get("embedder") != self.embedder_name:
                logger.warning("Embedding model changed; FAISS index must be rebuilt")
                self.needs_rebuild = True
                return
            self._index = faiss.read_index(str(self._index_path))
            self.dimension = self._index.d

    def _save(self) -> None:
        if not self.directory or self._index is None:
            return
        self.directory.mkdir(parents=True, exist_ok=True)
        tmp = self._index_path.with_suffix(".tmp")
        faiss.write_index(self._index, str(tmp))
        tmp.replace(self._index_path)
        self._meta_path.write_text(json.dumps({"embedder": self.embedder_name, "dimension": self.dimension}))

    def reset(self) -> None:
        with self._lock:
            self._index = None
            self.dimension = None
            self.needs_rebuild = False
            if self._index_path and self._index_path.exists():
                self._index_path.unlink()

    def add(self, ids: list[int], vectors: np.ndarray) -> None:
        vectors = np.ascontiguousarray(vectors, dtype="float32")
        with self._lock:
            if self._index is None:
                self.dimension = vectors.shape[1]
                self._index = faiss.IndexIDMap2(faiss.IndexFlatIP(self.dimension))
            if vectors.shape[1] != self.dimension:
                raise ValueError(f"Vector dimension {vectors.shape[1]} != index dimension {self.dimension}")
            self._index.add_with_ids(vectors, np.asarray(ids, dtype="int64"))
            self._save()

    def remove(self, ids: list[int]) -> int:
        if not ids:
            return 0
        with self._lock:
            if self._index is None:
                return 0
            removed = self._index.remove_ids(np.asarray(ids, dtype="int64"))
            self._save()
            return int(removed)

    def search(self, vector: np.ndarray, k: int) -> list[tuple[int, float]]:
        with self._lock:
            if self._index is None or self._index.ntotal == 0:
                return []
            k = min(k, self._index.ntotal)
            scores, ids = self._index.search(np.ascontiguousarray(vector.reshape(1, -1), dtype="float32"), k)
        return [(int(i), float(s)) for i, s in zip(ids[0], scores[0]) if i != -1]

    @property
    def size(self) -> int:
        with self._lock:
            return 0 if self._index is None else int(self._index.ntotal)
