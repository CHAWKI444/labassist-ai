from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.auth import _normalise_email
from app.schemas.common import Language, RoleName


class InvitationCreate(BaseModel):
    email: str = Field(max_length=255)
    role: RoleName = "patient"

    _email = field_validator("email")(_normalise_email)


class InvitationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    role: RoleName
    status: Literal["pending", "accepted", "expired", "cancelled"]
    expires_at: datetime
    invited_by: int | None
    invited_by_name: str | None = None
    accepted_user_id: int | None
    send_count: int
    last_sent_at: datetime | None
    email_status: str | None
    email_error: str | None
    created_at: datetime
    accepted_at: datetime | None
    cancelled_at: datetime | None


class InvitationOptions(BaseModel):
    allowed_roles: list[RoleName]
    expire_hours: int
    email_backend: str


class TokenBody(BaseModel):
    token: str = Field(min_length=20, max_length=200)


class InvitationPreview(BaseModel):
    id: int
    email: str
    role: RoleName
    expires_at: datetime
    invited_by_name: str | None
    invited_by_role: str | None


class InvitationAccept(TokenBody):
    full_name: str = Field(min_length=1, max_length=120)
    job_title: str | None = Field(default=None, max_length=120)
    accept_terms: bool = False
    password: str = Field(min_length=8, max_length=128)
    preferred_language: Language = "fr"
