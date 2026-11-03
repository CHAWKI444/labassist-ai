from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Language, VisibilityName

Kind = Literal["faq", "procedure", "policy"]
Status = Literal["draft", "approved", "archived"]


class KnowledgeItemBase(BaseModel):
    kind: Kind = "faq"
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=8000)
    language: Language = "fr"
    visibility: VisibilityName = "public"
    priority: int = Field(default=100, ge=0, le=1000)
    review_due: date | None = None


class KnowledgeItemCreate(KnowledgeItemBase):
    pass


class KnowledgeItemUpdate(BaseModel):
    kind: Kind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=200)
    content: str | None = Field(default=None, min_length=1, max_length=8000)
    language: Language | None = None
    visibility: VisibilityName | None = None
    priority: int | None = Field(default=None, ge=0, le=1000)
    review_due: date | None = None


class KnowledgeItemOut(KnowledgeItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    status: Status
    revision: int
    approved_by: int | None
    approved_at: datetime | None
    created_at: datetime
    updated_at: datetime


class CagStatus(BaseModel):
    kb_version: int
    audiences: dict[str, dict]
    max_context_tokens: int
    model_num_ctx: int
    reuse_explanation: str
