from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import Language, Mode


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: int | None = None
    mode: Mode = "auto"
    language: Language = "fr"


class SourceOut(BaseModel):
    type: str  # document | knowledge
    ref: str  # D1, KB2 ...
    title: str
    document_id: int | None = None
    knowledge_id: int | None = None
    page: int | None = None
    excerpt: str
    score: float | None = None
    cited: bool = False
    outdated: bool = False


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    role: str
    content: str
    language: str | None = None
    mode_requested: str | None = None
    architectures_used: list[str] | None = None
    sources: list[dict[str, Any]] | None = None
    context_info: dict[str, Any] | None = None
    error: str | None = None
    created_at: datetime
    feedback: int | None = None


class FeedbackIn(BaseModel):
    rating: Literal[1, -1] | None = Field(description="1 = helpful, -1 = not helpful, null = remove the vote")


class FeedbackOut(BaseModel):
    message_id: int
    rating: int | None


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    created_at: datetime
    updated_at: datetime


class ConversationSummary(ConversationOut):
    message_count: int = 0
    last_message_preview: str | None = None
    match_excerpt: str | None = None


class ConversationDetail(ConversationOut):
    messages: list[MessageOut]


class ConversationRename(BaseModel):
    title: str = Field(min_length=1, max_length=200)
