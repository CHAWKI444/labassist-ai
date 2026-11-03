from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class KnowledgeStatus:
    DRAFT = "draft"
    APPROVED = "approved"
    ARCHIVED = "archived"
    ALL = (DRAFT, APPROVED, ARCHIVED)


class KnowledgeKind:
    FAQ = "faq"
    PROCEDURE = "procedure"
    POLICY = "policy"
    ALL = (FAQ, PROCEDURE, POLICY)


class KnowledgeItem(Base):
    """Approved, stable laboratory information used to build the CAG context."""

    __tablename__ = "knowledge_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), default=KnowledgeKind.FAQ)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    language: Mapped[str] = mapped_column(String(5), default="fr")
    visibility: Mapped[str] = mapped_column(String(10), default="public")
    status: Mapped[str] = mapped_column(String(20), default=KnowledgeStatus.DRAFT)
    priority: Mapped[int] = mapped_column(Integer, default=100)
    review_due: Mapped[date | None] = mapped_column(Date, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class KnowledgeBaseVersion(Base):
    """Monotonic version counter bumped whenever approved knowledge changes."""

    __tablename__ = "knowledge_base_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    version: Mapped[int] = mapped_column(Integer, unique=True)
    reason: Mapped[str] = mapped_column(String(200))
    changed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CagContext(Base):
    """Prepared CAG context per audience, valid for one knowledge-base version."""

    __tablename__ = "cag_contexts"
    __table_args__ = (UniqueConstraint("audience", name="uq_cag_contexts_audience"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    audience: Mapped[str] = mapped_column(String(10))  # public | staff
    kb_version: Mapped[int] = mapped_column(Integer)
    content_hash: Mapped[str] = mapped_column(String(64))
    context_text: Mapped[str] = mapped_column(Text)
    token_estimate: Mapped[int] = mapped_column(Integer)
    included_item_ids: Mapped[list] = mapped_column(JSON, default=list)
    excluded_item_ids: Mapped[list] = mapped_column(JSON, default=list)
    outdated_item_ids: Mapped[list] = mapped_column(JSON, default=list)
    built_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    hits: Mapped[int] = mapped_column(Integer, default=0)
