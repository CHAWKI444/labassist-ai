"""Dashboard analytics computed from persisted data only.

Two scopes:
- ``global`` (administrators): chat requests come from ``request_metrics`` (role only, no user id, no content);
  conversations and documents are counted across the whole application.
- ``personal`` (everyone): chat requests are derived from the user's own messages; each user message is one
  request and the assistant message that follows it carries the architectures used and the measured latency.

No message content is ever selected: only timestamps, ids, roles, architectures and latencies.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Conversation, Document, Message, RequestMetric, User
from app.models.base import as_utc, utcnow
from app.models.document import DocumentStatus, Visibility
from app.schemas.dashboard import (
    ActivityPoint,
    ArchitectureDistribution,
    ArchitectureSlice,
    ConversationActivity,
    DashboardSummary,
    Kpi,
    RecentActivity,
    RecentActivityItem,
    Scope,
)

KNOWLEDGE_ARCHITECTURES = ("rag", "cag", "mag")
ARCHITECTURE_ORDER = ("rag", "cag", "mag", "hybrid", "llm")


def classify_architecture(architectures: list[str] | None) -> str:
    """One request maps to exactly one category: a single source, ``hybrid`` for several, ``llm`` for none."""
    used = [a for a in KNOWLEDGE_ARCHITECTURES if a in (architectures or [])]
    if not used:
        return "llm"
    return used[0] if len(used) == 1 else "hybrid"


def percent_change(current: float | None, previous: float | None) -> float | None:
    if current is None or previous is None or previous == 0:
        return None
    return round((current - previous) / previous * 100, 1)


def percentile(values: list[int], pct: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct / 100 * (len(ordered) - 1))))
    return ordered[index]


def _mean(values: list[int]) -> int | None:
    return round(sum(values) / len(values)) if values else None


@dataclass(frozen=True)
class RequestEvent:
    id: int
    created_at: datetime
    status: str  # success | error | unanswered
    architectures: list[str]
    response_ms: int | None
    mode: str | None
    conversation_id: int | None = None
    role: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "success"


class DashboardAnalytics:
    def __init__(self, db: Session, user: User, scope: Scope, tz_offset_minutes: int = 0, now: datetime | None = None):
        self.db = db
        self.user = user
        self.scope = scope
        self.tz = timezone(timedelta(minutes=tz_offset_minutes))
        self.now = now or utcnow()

    # ---------- time helpers ----------
    def _local_date(self, value: datetime) -> date:
        return as_utc(value).astimezone(self.tz).date()

    def _local_midnight_utc(self, day: date) -> datetime:
        return datetime(day.year, day.month, day.day, tzinfo=self.tz).astimezone(timezone.utc)

    @property
    def _today(self) -> date:
        return self.now.astimezone(self.tz).date()

    # ---------- scoped queries ----------
    def _conversation_filters(self) -> list:
        return [] if self.scope == "global" else [Conversation.user_id == self.user.id]

    def _count_conversations(self, *where) -> int:
        stmt = select(func.count()).select_from(Conversation).where(*self._conversation_filters(), *where)
        return self.db.scalar(stmt) or 0

    def _earliest_conversation(self) -> datetime | None:
        return as_utc(self.db.scalar(select(func.min(Conversation.created_at)).where(*self._conversation_filters())))

    def _earliest_request(self) -> datetime | None:
        if self.scope == "global":
            stmt = select(func.min(RequestMetric.created_at)).where(RequestMetric.kind == "chat")
        else:
            stmt = (
                select(func.min(Message.created_at))
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.user_id == self.user.id, Message.role == "user")
            )
        return as_utc(self.db.scalar(stmt))

    def _metric_events(self, *where, limit: int | None = None) -> list[RequestEvent]:
        stmt = (
            select(
                RequestMetric.id,
                RequestMetric.created_at,
                RequestMetric.status_code,
                RequestMetric.latency_ms,
                RequestMetric.architectures_used,
                RequestMetric.mode_requested,
                RequestMetric.user_role,
            )
            .where(RequestMetric.kind == "chat", *where)
            .order_by(RequestMetric.id.desc())
        )
        if limit:
            stmt = stmt.limit(limit)
        events = []
        for row in self.db.execute(stmt):
            ok = row.status_code < 400
            events.append(
                RequestEvent(
                    id=row.id,
                    created_at=as_utc(row.created_at),
                    status="success" if ok else "error",
                    architectures=list(row.architectures_used or []),
                    response_ms=max(0, row.latency_ms) if ok and row.latency_ms is not None else None,
                    mode=row.mode_requested,
                    role=row.user_role,
                )
            )
        return events

    def _message_events(self, *where) -> list[RequestEvent]:
        """Pairs each of the user's questions with the assistant reply that immediately follows it."""
        latency = Message.context_info["latency_ms"].as_integer()
        stmt = (
            select(
                Message.id,
                Message.conversation_id,
                Message.role,
                Message.created_at,
                Message.mode_requested,
                Message.architectures_used,
                Message.error.is_not(None).label("failed"),
                latency.label("latency_ms"),
            )
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(Conversation.user_id == self.user.id, *where)
            .order_by(Message.conversation_id, Message.id)
        )
        rows = self.db.execute(stmt).all()
        events = []
        for index, row in enumerate(rows):
            if row.role != "user":
                continue
            following = rows[index + 1] if index + 1 < len(rows) else None
            reply = (
                following
                if following is not None
                and following.conversation_id == row.conversation_id
                and following.role == "assistant"
                else None
            )
            if reply is None:
                status = "unanswered"
            else:
                status = "error" if reply.failed else "success"
            response_ms = reply.latency_ms if reply is not None and status == "success" else None
            events.append(
                RequestEvent(
                    id=row.id,
                    created_at=as_utc(row.created_at),
                    status=status,
                    architectures=list(reply.architectures_used or []) if reply is not None else [],
                    response_ms=max(0, response_ms) if response_ms is not None else None,
                    mode=row.mode_requested,
                    conversation_id=row.conversation_id,
                )
            )
        return events

    def _events_since(self, since: datetime) -> list[RequestEvent]:
        if self.scope == "global":
            return self._metric_events(RequestMetric.created_at >= since)
        return self._message_events(Message.created_at >= since)

    # ---------- endpoints ----------
    def summary(self, days: int) -> DashboardSummary:
        window_start = self.now - timedelta(days=days)
        previous_start = window_start - timedelta(days=days)
        today_start = self._local_midnight_utc(self._today)
        yesterday_start = today_start - timedelta(days=1)
        events = self._events_since(min(previous_start, yesterday_start))
        earliest_request = self._earliest_request()
        earliest_conversation = self._earliest_conversation()

        # Conversations: total now vs the total that already existed when the window started.
        total = self._count_conversations()
        total_at_start = self._count_conversations(Conversation.created_at < window_start)
        new_current = total - total_at_start
        new_previous = self._count_conversations(
            Conversation.created_at >= previous_start, Conversation.created_at < window_start
        )
        conversations_covered = earliest_conversation is not None and earliest_conversation <= previous_start

        # Requests today vs the same part of yesterday (only if history reaches back to yesterday's start).
        today = [e for e in events if e.created_at >= today_start]
        yesterday = [e for e in events if yesterday_start <= e.created_at < self.now - timedelta(days=1)]
        requests_covered = earliest_request is not None and earliest_request <= yesterday_start

        # Response time: successful requests with a measured latency, current window vs previous window.
        current_latencies = [
            e.response_ms for e in events if e.ok and e.response_ms is not None and e.created_at >= window_start
        ]
        previous_latencies = [
            e.response_ms
            for e in events
            if e.ok and e.response_ms is not None and previous_start <= e.created_at < window_start
        ]
        latency_covered = earliest_request is not None and earliest_request <= previous_start
        avg_current = _mean(current_latencies)
        avg_previous = _mean(previous_latencies) if latency_covered else None

        period = f"previous {days} days"
        return DashboardSummary(
            scope=self.scope,
            days=days,
            generated_at=self.now,
            total_conversations=Kpi(
                value=total,
                previous=total_at_start,
                change_pct=percent_change(total, total_at_start),
                comparison=f"vs {days} days ago",
            ),
            new_conversations=Kpi(
                value=new_current,
                previous=new_previous if conversations_covered else None,
                change_pct=percent_change(new_current, new_previous) if conversations_covered else None,
                comparison=f"vs {period}",
            ),
            requests_today=Kpi(
                value=len(today),
                previous=len(yesterday) if requests_covered else None,
                change_pct=percent_change(len(today), len(yesterday)) if requests_covered else None,
                comparison="vs same time yesterday",
            ),
            failed_today=sum(1 for e in today if not e.ok),
            indexed_documents=Kpi(value=self._indexed_documents()),
            avg_response_ms=Kpi(
                value=avg_current,
                previous=avg_previous,
                change_pct=percent_change(avg_current, avg_previous),
                comparison=f"vs {period}",
            ),
            p95_response_ms=percentile(current_latencies, 95),
            response_samples=len(current_latencies),
        )

    def _indexed_documents(self) -> int:
        where = [Document.status == DocumentStatus.INDEXED]
        if self.scope == "personal" and not self.user.is_staff:
            where.append(Document.visibility == Visibility.PUBLIC)  # patients can only be answered from public documents
        return self.db.scalar(select(func.count()).select_from(Document).where(*where)) or 0

    def activity(self, days: int) -> ConversationActivity:
        first_day = self._today - timedelta(days=days - 1)
        since = self._local_midnight_utc(first_day)
        buckets = {first_day + timedelta(days=i): {"new": 0, "active": set(), "requests": 0} for i in range(days)}

        created = self.db.scalars(
            select(Conversation.created_at).where(*self._conversation_filters(), Conversation.created_at >= since)
        )
        for value in created:
            bucket = buckets.get(self._local_date(value))
            if bucket is not None:
                bucket["new"] += 1

        questions = self.db.execute(
            select(Message.conversation_id, Message.created_at)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(*self._conversation_filters(), Message.role == "user", Message.created_at >= since)
        )
        for conversation_id, value in questions:
            bucket = buckets.get(self._local_date(value))
            if bucket is not None:
                bucket["active"].add(conversation_id)

        for event in self._events_since(since):
            bucket = buckets.get(self._local_date(event.created_at))
            if bucket is not None:
                bucket["requests"] += 1

        return ConversationActivity(
            scope=self.scope,
            days=days,
            points=[
                ActivityPoint(
                    date=day,
                    new_conversations=b["new"],
                    active_conversations=len(b["active"]),
                    requests=b["requests"],
                )
                for day, b in sorted(buckets.items())
            ],
        )

    def architectures(self, days: int) -> ArchitectureDistribution:
        events = [e for e in self._events_since(self.now - timedelta(days=days)) if e.ok]
        counts: Counter[str] = Counter()
        latencies: dict[str, list[int]] = {key: [] for key in ARCHITECTURE_ORDER}
        combinations: Counter[str] = Counter()
        for event in events:
            category = classify_architecture(event.architectures)
            counts[category] += 1
            if event.response_ms is not None:
                latencies[category].append(event.response_ms)
            if category == "hybrid":
                combinations["+".join(a for a in KNOWLEDGE_ARCHITECTURES if a in event.architectures)] += 1
        total = len(events)
        return ArchitectureDistribution(
            scope=self.scope,
            days=days,
            total=total,
            items=[
                ArchitectureSlice(
                    architecture=key,
                    count=counts[key],
                    percentage=round(counts[key] / total * 100, 1) if total else 0.0,
                    avg_response_ms=_mean(latencies[key]),
                )
                for key in ARCHITECTURE_ORDER
            ],
            hybrid_combinations=dict(combinations),
        )

    def recent(self, limit: int) -> RecentActivity:
        if self.scope == "global":
            events = self._metric_events(limit=limit)
        else:
            latest = self.db.execute(
                select(Message.id, Message.conversation_id)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .where(Conversation.user_id == self.user.id, Message.role == "user")
                .order_by(Message.id.desc())
                .limit(limit)
            ).all()
            wanted = {row.id for row in latest}
            events = []
            if latest:
                paired = self._message_events(
                    Message.conversation_id.in_({row.conversation_id for row in latest}),
                    Message.id >= min(wanted),
                )
                events = sorted((e for e in paired if e.id in wanted), key=lambda e: e.id, reverse=True)
        return RecentActivity(
            scope=self.scope,
            items=[
                RecentActivityItem(
                    created_at=e.created_at,
                    architecture=classify_architecture(e.architectures) if e.ok or e.architectures else None,
                    architectures=e.architectures,
                    mode=e.mode,
                    status=e.status,
                    response_ms=e.response_ms,
                    role=e.role if self.scope == "global" else None,
                )
                for e in events
            ],
        )
