import hashlib
import logging
import uuid
from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import Settings
from app.models import Document, DocumentChunk
from app.models.document import DocumentStatus, Visibility
from app.models.notification import NotificationType
from app.services.embeddings import Embedder, EmbeddingError
from app.services.notifications import notify
from app.services.rag.chunking import chunk_pages
from app.services.rag.extraction import ExtractionError, extract_pages
from app.services.rag.vector_store import FaissStore

logger = logging.getLogger(__name__)


@dataclass
class RetrievedChunk:
    chunk_id: int
    document_id: int
    title: str
    page: int | None
    chunk_index: int
    text: str
    score: float
    document_version: int
    document_updated_at: str


def allowed_visibilities(is_staff: bool) -> tuple[str, ...]:
    return Visibility.ALL if is_staff else (Visibility.PUBLIC,)


class RagService:
    def __init__(self, settings: Settings, sessions: sessionmaker, embedder: Embedder, store: FaissStore):
        self.settings = settings
        self.sessions = sessions
        self.embedder = embedder
        self.store = store

    # ---------- file storage ----------
    def store_file(self, content: bytes, file_type: str) -> tuple[str, str]:
        stored = f"{uuid.uuid4().hex}.{file_type}"
        (self.settings.upload_dir / stored).write_bytes(content)
        return stored, hashlib.sha256(content).hexdigest()

    def delete_file(self, stored_filename: str) -> None:
        path = self.settings.upload_dir / stored_filename
        if path.exists():
            path.unlink()

    # ---------- indexing ----------
    def ingest(self, document_id: int) -> None:
        """Extract, chunk, embed and index one document. Runs in a background thread."""
        with self.sessions() as db:
            document = db.get(Document, document_id)
            if document is None:
                return
            try:
                self._remove_vectors(db, document_id)
                pages = extract_pages(self.settings.upload_dir / document.stored_filename, document.file_type)
                chunks = chunk_pages(pages, self.settings.chunk_size_chars, self.settings.chunk_overlap_chars)
                if not chunks:
                    raise ExtractionError("No text chunks could be produced from this document.")
                rows = [
                    DocumentChunk(document_id=document_id, chunk_index=c.index, page=c.page, text=c.text)
                    for c in chunks
                ]
                db.add_all(rows)
                db.flush()
                vectors = self.embedder.embed([f"{document.title}\n{r.text}" for r in rows])
                self.store.add([r.id for r in rows], vectors)
                document.status = DocumentStatus.INDEXED
                document.num_chunks = len(rows)
                document.num_pages = max((p.page or 0) for p in pages) or None
                document.error = None
                if document.uploaded_by:
                    notify(db, document.uploaded_by, NotificationType.EVENT, "Document indexed",
                           f"“{document.title}” (v{document.version}) is searchable: {len(rows)} passages.",
                           "/staff/documents", commit=False)
                db.commit()
                logger.info("Indexed document id=%s chunks=%s", document_id, len(rows))
            except (ExtractionError, EmbeddingError, ValueError) as exc:
                db.rollback()
                self._mark_failed(db, document_id, str(exc))
            except Exception as exc:  # noqa: BLE001 - keep the API alive, record failure
                logger.exception("Unexpected indexing failure for document id=%s", document_id)
                db.rollback()
                self._mark_failed(db, document_id, f"Unexpected error: {type(exc).__name__}")

    def _mark_failed(self, db: Session, document_id: int, error: str) -> None:
        document = db.get(Document, document_id)
        if document is None:
            return
        self._remove_vectors(db, document_id)
        document.status = DocumentStatus.FAILED
        document.error = error[:300]
        document.num_chunks = 0
        if document.uploaded_by:
            notify(db, document.uploaded_by, NotificationType.EVENT, "Document indexing failed",
                   f"“{document.title}”: {error[:200]}", "/staff/documents", commit=False)
        db.commit()
        logger.warning("Indexing failed for document id=%s: %s", document_id, error[:120])

    def _remove_vectors(self, db: Session, document_id: int) -> None:
        ids = list(db.scalars(select(DocumentChunk.id).where(DocumentChunk.document_id == document_id)))
        self.store.remove(ids)
        db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
        db.flush()

    def delete_document(self, db: Session, document: Document) -> None:
        self._remove_vectors(db, document.id)
        self.delete_file(document.stored_filename)
        db.delete(document)
        db.commit()

    def rebuild_index(self) -> int:
        """Re-embed every chunk from the database (used after an embedding-model change)."""
        self.store.reset()
        total = 0
        with self.sessions() as db:
            documents = db.scalars(select(Document).where(Document.status == DocumentStatus.INDEXED)).all()
            for document in documents:
                chunks = list(document.chunks)
                if not chunks:
                    continue
                vectors = self.embedder.embed([f"{document.title}\n{c.text}" for c in chunks])
                self.store.add([c.id for c in chunks], vectors)
                total += len(chunks)
        return total

    def index_consistent(self, db: Session) -> bool:
        count = db.query(DocumentChunk).count()
        return not self.store.needs_rebuild and count == self.store.size

    # ---------- retrieval ----------
    def retrieve(self, db: Session, query: str, is_staff: bool, top_k: int | None = None) -> list[RetrievedChunk]:
        top_k = top_k or self.settings.rag_top_k
        if self.store.size == 0:
            return []
        vector = self.embedder.embed([query])[0]
        candidates = self.store.search(vector, max(top_k * 8, 32))
        if not candidates:
            return []
        scores = dict(candidates)
        rows = db.execute(
            select(DocumentChunk, Document)
            .join(Document, Document.id == DocumentChunk.document_id)
            .where(
                DocumentChunk.id.in_(scores.keys()),
                Document.status == DocumentStatus.INDEXED,
                Document.visibility.in_(allowed_visibilities(is_staff)),
            )
        ).all()
        results = [
            RetrievedChunk(
                chunk_id=chunk.id,
                document_id=doc.id,
                title=doc.title,
                page=chunk.page,
                chunk_index=chunk.chunk_index,
                text=chunk.text,
                score=round(scores[chunk.id], 4),
                document_version=doc.version,
                document_updated_at=doc.updated_at.date().isoformat(),
            )
            for chunk, doc in rows
        ]
        results.sort(key=lambda r: r.score, reverse=True)
        return results[:top_k]
