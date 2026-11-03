from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import User
from app.schemas.dashboard import (
    ArchitectureDistribution,
    ConversationActivity,
    DashboardSummary,
    RecentActivity,
    Scope,
)
from app.services.analytics import DashboardAnalytics

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def get_analytics(
    scope: Scope = Query(default="personal"),
    tz_offset_minutes: int = Query(default=0, ge=-14 * 60, le=14 * 60, description="Client offset east of UTC"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> DashboardAnalytics:
    if scope == "global" and not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Global statistics are restricted to administrators")
    return DashboardAnalytics(db, user, scope, tz_offset_minutes)


Days = Query(default=30, ge=1, le=90)


@router.get("/summary", response_model=DashboardSummary)
def summary(days: int = Days, analytics: DashboardAnalytics = Depends(get_analytics)) -> DashboardSummary:
    return analytics.summary(days)


@router.get("/activity", response_model=ConversationActivity)
def activity(days: int = Days, analytics: DashboardAnalytics = Depends(get_analytics)) -> ConversationActivity:
    return analytics.activity(days)


@router.get("/architectures", response_model=ArchitectureDistribution)
def architectures(days: int = Days, analytics: DashboardAnalytics = Depends(get_analytics)) -> ArchitectureDistribution:
    return analytics.architectures(days)


@router.get("/recent", response_model=RecentActivity)
def recent(
    limit: int = Query(default=10, ge=1, le=50), analytics: DashboardAnalytics = Depends(get_analytics)
) -> RecentActivity:
    return analytics.recent(limit)
