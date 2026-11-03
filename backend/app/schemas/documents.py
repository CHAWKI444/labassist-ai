from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import VisibilityName


class DocumentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    original_filename: str
    file_type: str
    size_bytes: int
    visibility: VisibilityName
    status: str
    error: str | None
    version: int
    num_chunks: int
    num_pages: int | None
    created_at: datetime
    updated_at: datetime


class DocumentUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    visibility: VisibilityName | None = None


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=4, ge=1, le=20)


class SearchHit(BaseModel):
    document_id: int
    title: str
    page: int | None
    chunk_index: int
    excerpt: str
    score: float
