from datetime import datetime
from enum import StrEnum

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class Role(StrEnum):
    PATIENT = "patient"
    STAFF = "staff"
    ADMIN = "admin"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("avatar_key", name="uq_users_avatar_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    job_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    avatar_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Embedded in access tokens; incremented to revoke all existing sessions (password change, sign-out-all).
    token_version: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(20), default=Role.PATIENT.value)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    memory_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    preferred_language: Mapped[str] = mapped_column(String(5), default="fr")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Archived accounts cannot sign in but keep all their data until restored or deleted.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    archived_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    @property
    def avatar_url(self) -> str | None:
        return f"/api/avatars/{self.avatar_key}" if self.avatar_key else None

    @property
    def status(self) -> str:
        return "archived" if self.archived_at is not None else ("active" if self.is_active else "inactive")

    @property
    def is_staff(self) -> bool:
        return self.role in (Role.STAFF.value, Role.ADMIN.value)

    @property
    def is_admin(self) -> bool:
        return self.role == Role.ADMIN.value
