from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_services, require_admin, require_staff
from app.models import Document, User
from app.models.document import DocumentStatus, Visibility
from app.schemas.common import VisibilityName
from app.schemas.documents import DocumentOut, DocumentUpdate, SearchHit, SearchRequest
from app.services.container import Services
from app.services.embeddings import EmbeddingError
from app.services.rag.validation import UploadValidationError, safe_display_name, validate_upload

router = APIRouter(prefix="/documents", tags=["documents"])


async def _read_validated(file: UploadFile, services: Services) -> tuple[bytes, str]:
    content = await file.read(services.settings.max_upload_bytes + 1)
    try:
        file_type = validate_upload(file.filename or "", content, services.settings.max_upload_bytes)
    except UploadValidationError as exc:
        raise HTTPException(422, str(exc)) from exc
    return content, file_type


@router.get("", response_model=list[DocumentOut])
def list_documents(_: User = Depends(require_staff), db: Session = Depends(get_db)):
    return db.scalars(select(Document).order_by(Document.updated_at.desc())).all()


@router.post("", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    background: BackgroundTasks,
    file: UploadFile = File(...),
    title: str | None = Form(default=None, max_length=200),
    visibility: VisibilityName = Form(default=Visibility.STAFF),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    content, file_type = await _read_validated(file, services)
    stored, digest = services.rag.store_file(content, file_type)
    display = safe_display_name(file.filename or "document")
    document = Document(
        title=(title or display.rsplit(".", 1)[0]).strip()[:200] or display,
        original_filename=display,
        stored_filename=stored,
        file_type=file_type,
        size_bytes=len(content),
        sha256=digest,
        visibility=visibility,
        status=DocumentStatus.PROCESSING,
        uploaded_by=user.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    background.add_task(services.rag.ingest, document.id)
    return document


@router.get("/{document_id}", response_model=DocumentOut)
def get_document(document_id: int, _: User = Depends(require_staff), db: Session = Depends(get_db)):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return document


@router.patch("/{document_id}", response_model=DocumentOut)
def update_document(
    document_id: int,
    payload: DocumentUpdate,
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    if payload.title is not None:
        document.title = payload.title.strip()
    if payload.visibility is not None:
        document.visibility = payload.visibility
    db.commit()
    db.refresh(document)
    return document


@router.put("/{document_id}/file", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
async def replace_document_file(
    document_id: int,
    background: BackgroundTasks,
    file: UploadFile = File(...),
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    """Upload a new version: old passages are removed from the index and the document is re-indexed."""
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    content, file_type = await _read_validated(file, services)
    old_file = document.stored_filename
    stored, digest = services.rag.store_file(content, file_type)
    document.stored_filename = stored
    document.original_filename = safe_display_name(file.filename or document.original_filename)
    document.file_type = file_type
    document.size_bytes = len(content)
    document.sha256 = digest
    document.version += 1
    document.status = DocumentStatus.PROCESSING
    document.error = None
    db.commit()
    db.refresh(document)
    services.rag.delete_file(old_file)
    background.add_task(services.rag.ingest, document.id)
    return document


@router.post("/{document_id}/reindex", response_model=DocumentOut, status_code=status.HTTP_202_ACCEPTED)
def reindex_document(
    document_id: int,
    background: BackgroundTasks,
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    document.status = DocumentStatus.PROCESSING
    document.error = None
    db.commit()
    db.refresh(document)
    background.add_task(services.rag.ingest, document.id)
    return document


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: int,
    _: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    document = db.get(Document, document_id)
    if document is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    services.rag.delete_document(db, document)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/search", response_model=list[SearchHit])
async def search_documents(
    payload: SearchRequest,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    """Retrieval test tool for staff: shows raw passages and similarity scores."""
    try:
        hits = await run_in_threadpool(services.rag.retrieve, db, payload.query, user.is_staff, payload.top_k)
    except EmbeddingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return [
        SearchHit(
            document_id=h.document_id,
            title=h.title,
            page=h.page,
            chunk_index=h.chunk_index,
            excerpt=h.text,
            score=h.score,
        )
        for h in hits
    ]


@router.post("/rebuild-index", dependencies=[Depends(require_admin)])
async def rebuild_index(services: Services = Depends(get_services)) -> dict:
    try:
        total = await run_in_threadpool(services.rag.rebuild_index)
    except EmbeddingError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
    return {"vectors": total}
