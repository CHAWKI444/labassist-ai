from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Category = Literal["language_preference", "communication_style", "general_preference", "topic_interest"]


class MemoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    category: Category
    content: str
    source: str
    conversation_id: int | None
    created_at: datetime
    updated_at: datetime
    last_used_at: datetime | None
    expires_at: datetime


class MemoryCreate(BaseModel):
    category: Category = "general_preference"
    content: str = Field(min_length=1, max_length=300)


class MemoryUpdate(BaseModel):
    category: Category | None = None
    content: str | None = Field(default=None, min_length=1, max_length=300)


class MemorySettings(BaseModel):
    memory_enabled: bool
    retention_days: int
    max_memories: int
    count: int
