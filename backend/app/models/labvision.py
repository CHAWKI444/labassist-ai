from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.base import utcnow


class ReviewStatus:
    PENDING = "pending"
    CONFIRMED = "confirmed"
    EXPECTED = "expected"
    FALSE_POSITIVE = "false_positive"
    ALL = (PENDING, CONFIRMED, EXPECTED, FALSE_POSITIVE)


class FindingCategory:
    DATA_QUALITY = "data_quality"
    STATISTICAL = "statistical_outlier"
    ALL = (DATA_QUALITY, STATISTICAL)


class LabVisionAnalysis(Base):
    """Computed results of one dataset analysis. The uploaded file itself is never stored."""

    __tablename__ = "labvision_analyses"
    __table_args__ = (Index("ix_labvision_analyses_user_created", "user_id", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    dataset_name: Mapped[str] = mapped_column(String(255))
    file_type: Mapped[str] = mapped_column(String(10))
    sheet_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    row_count: Mapped[int] = mapped_column(Integer)
    column_count: Mapped[int] = mapped_column(Integer)
    quality_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    finding_count: Mapped[int] = mapped_column(Integer, default=0)
    # Request parameters (columns, methods, thresholds, rules) exactly as validated.
    config: Mapped[dict] = mapped_column(JSON)
    # Column profiles, metrics, method reports, chart aggregates, recommendations and limitations.
    results: Mapped[dict] = mapped_column(JSON)
    # Optional language-model explanation of the structured results; never used as evidence.
    explanation: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class LabVisionFinding(Base):
    """One machine-generated finding. Review fields record the human decision separately."""

    __tablename__ = "labvision_findings"
    __table_args__ = (Index("ix_labvision_findings_analysis_review", "analysis_id", "review_status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    analysis_id: Mapped[int] = mapped_column(ForeignKey("labvision_analyses.id", ondelete="CASCADE"), index=True)
    category: Mapped[str] = mapped_column(String(30))
    issue_type: Mapped[str] = mapped_column(String(40))
    method: Mapped[str] = mapped_column(String(40))
    severity: Mapped[str] = mapped_column(String(10))
    column: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 1-based data row numbers (header excluded); several for duplicates or column-level findings.
    row_numbers: Mapped[list] = mapped_column(JSON, default=list)
    affected_count: Mapped[int] = mapped_column(Integer, default=0)
    record_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    observed_value: Mapped[str | None] = mapped_column(String(500), nullable=True)
    score: Mapped[float | None] = mapped_column(Float, nullable=True)
    threshold: Mapped[str | None] = mapped_column(String(255), nullable=True)
    explanation: Mapped[str] = mapped_column(Text)
    suggested_action: Mapped[str] = mapped_column(Text)
    review_status: Mapped[str] = mapped_column(String(20), default=ReviewStatus.PENDING)
    review_note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
