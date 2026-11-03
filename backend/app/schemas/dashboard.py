from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

Scope = Literal["personal", "global"]
ArchitectureKey = Literal["rag", "cag", "mag", "hybrid", "llm"]
RequestStatus = Literal["success", "error", "unanswered"]


class Kpi(BaseModel):
    value: int | None
    # Percentage change vs the previous comparable period; None when the history does not cover it.
    change_pct: float | None = None
    previous: int | None = None
    comparison: str | None = None


class DashboardSummary(BaseModel):
    scope: Scope
    days: int
    generated_at: datetime
    total_conversations: Kpi
    new_conversations: Kpi
    requests_today: Kpi
    failed_today: int
    indexed_documents: Kpi
    avg_response_ms: Kpi
    p95_response_ms: int | None
    response_samples: int


class ActivityPoint(BaseModel):
    date: date
    new_conversations: int
    active_conversations: int
    requests: int


class ConversationActivity(BaseModel):
    scope: Scope
    days: int
    points: list[ActivityPoint]


class ArchitectureSlice(BaseModel):
    architecture: ArchitectureKey
    count: int
    percentage: float
    avg_response_ms: int | None


class ArchitectureDistribution(BaseModel):
    scope: Scope
    days: int
    total: int
    items: list[ArchitectureSlice]
    hybrid_combinations: dict[str, int]


class RecentActivityItem(BaseModel):
    created_at: datetime
    architecture: ArchitectureKey | None
    architectures: list[str]
    mode: str | None
    status: RequestStatus
    response_ms: int | None
    role: str | None = None


class RecentActivity(BaseModel):
    scope: Scope
    items: list[RecentActivityItem]
