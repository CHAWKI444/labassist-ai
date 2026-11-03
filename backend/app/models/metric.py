from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class RequestMetric(Base):
    """Minimal operational metadata. Never stores message content or identifiers beyond role."""

    __tablename__ = "request_metrics"
    __table_args__ = (Index("ix_request_metrics_kind_created_at", "kind", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    kind: Mapped[str] = mapped_column(String(20))  # chat | http
    path: Mapped[str] = mapped_column(String(120))
    method: Mapped[str] = mapped_column(String(10))
    status_code: Mapped[int] = mapped_column(Integer)
    latency_ms: Mapped[int] = mapped_column(Integer)
    user_role: Mapped[str | None] = mapped_column(String(20), nullable=True)
    mode_requested: Mapped[str | None] = mapped_column(String(10), nullable=True)
    architectures_used: Mapped[list | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    # Chat stage timings (ms). Null when the stage did not run.
    first_token_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    retrieval_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cag_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    generation_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)  # Ollama eval_duration

    # Answer quality and safety signals (chat only).
    rag_top_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    rag_passages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    no_source: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    cag_reused: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    diagnosis_guard: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    memory_refused_sensitive: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
