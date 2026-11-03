from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.common import RoleName

NotificationTypeName = Literal["invitation", "account", "event", "system"]


class NotificationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    type: NotificationTypeName
    title: str
    body: str
    link: str | None
    read_at: datetime | None
    created_at: datetime


class NotificationPage(BaseModel):
    items: list[NotificationOut]
    total: int
    unread: int


class UnreadCount(BaseModel):
    unread: int


class BroadcastRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(default="", max_length=1000)
    roles: list[RoleName] | None = None


class BroadcastResult(BaseModel):
    recipients: int
