import re

from pydantic import BaseModel, Field, field_validator

from app.schemas.common import Language

_PHONE_ALLOWED = re.compile(r"^\+?[\d\s().-]+$")


def normalise_phone(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    if not value:
        return None
    digits = re.sub(r"\D", "", value)
    if not _PHONE_ALLOWED.match(value) or not 6 <= len(digits) <= 15:
        raise ValueError("Enter a valid phone number (6 to 15 digits, optional leading +).")
    return value


class ProfileUpdate(BaseModel):
    """Fields a user may change on their own account. Role and email are deliberately absent."""

    full_name: str | None = Field(default=None, min_length=1, max_length=120)
    phone: str | None = Field(default=None, max_length=30)
    job_title: str | None = Field(default=None, max_length=120)
    department: str | None = Field(default=None, max_length=120)
    preferred_language: Language | None = None

    _phone = field_validator("phone")(normalise_phone)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)
