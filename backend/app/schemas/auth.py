from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.common import Language, RoleName


def _normalise_email(value: str) -> str:
    value = value.strip().lower()
    local, sep, domain = value.partition("@")
    if not sep or not local or "." not in domain or " " in value:
        raise ValueError("Invalid email address")
    return value


class LoginRequest(BaseModel):
    email: str = Field(max_length=255)
    password: str = Field(min_length=1, max_length=128)

    _email = field_validator("email")(_normalise_email)


class RegisterRequest(BaseModel):
    email: str = Field(max_length=255)
    full_name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=128)
    preferred_language: Language = "fr"

    _email = field_validator("email")(_normalise_email)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    full_name: str
    job_title: str | None = None
    department: str | None = None
    phone: str | None = None
    avatar_url: str | None = None
    role: RoleName
    is_active: bool
    status: Literal["active", "inactive", "archived"]
    memory_enabled: bool
    preferred_language: Language
    created_at: datetime
    last_login_at: datetime | None = None
    archived_at: datetime | None = None


class UserDetail(UserOut):
    """Admin view: account metadata and counts only, never conversation or memory content."""

    updated_at: datetime | None = None
    conversation_count: int
    memory_count: int
    unread_notifications: int
    invitations_sent: int


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class UserPreferencesUpdate(BaseModel):
    memory_enabled: bool | None = None
    preferred_language: Language | None = None


class AdminUserCreate(RegisterRequest):
    role: RoleName = "patient"
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)


class AdminUserUpdate(BaseModel):
    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    role: RoleName | None = None
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserPage(BaseModel):
    items: list[UserOut]
    total: int


class UserStats(BaseModel):
    total: int
    active: int
    archived: int
    pending_invitations: int
    expiring_invitations_48h: int
    new_last_30_days: int
    signed_in_last_30_days: int
    departments: list[str]


class BulkUserAction(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=200)
    action: Literal["archive", "restore"]


class BulkResult(BaseModel):
    updated: list[int]
    skipped: dict[int, str]
