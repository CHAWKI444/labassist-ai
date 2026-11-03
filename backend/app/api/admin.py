from collections import Counter
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_services, require_admin
from app.models import Conversation, Document, Invitation, KnowledgeItem, Memory, Message, RequestMetric, User
from app.models.base import utcnow
from app.models.knowledge import KnowledgeStatus
from app.models.notification import NotificationType
from app.schemas.notifications import BroadcastRequest, BroadcastResult
from app.services.analytics import classify_architecture
from app.services.container import Services
from app.services.notifications import active_user_ids, notify_users

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


# ---------- system notifications ----------
@router.post("/notifications/broadcast", response_model=BroadcastResult)
def broadcast(payload: BroadcastRequest, db: Session = Depends(get_db)) -> BroadcastResult:
    """Send a system-update notification to every active user (optionally limited to some roles)."""
    recipients = active_user_ids(db, payload.roles)
    notify_users(db, recipients, NotificationType.SYSTEM, payload.title.strip(), payload.body.strip())
    return BroadcastResult(recipients=len(recipients))


# ---------- dashboard ----------
def _percentile(values: list[int], pct: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct / 100 * (len(ordered) - 1))))
    return ordered[index]


def _avg(values: list[float]) -> int | None:
    return round(sum(values) / len(values)) if values else None


def _rate(numerator: int, denominator: int) -> float | None:
    return round(numerator / denominator * 100, 1) if denominator else None


def _present(rows: list[RequestMetric], attribute: str) -> list:
    return [value for value in (getattr(r, attribute) for r in rows) if value is not None]


def _stages(chat_ok: list[RequestMetric]) -> dict:
    first_tokens = _present(chat_ok, "first_token_ms")
    with_speed = [r for r in chat_ok if r.completion_tokens and r.eval_ms]
    evaluated_ms = sum(r.eval_ms for r in with_speed)
    return {
        "first_token_ms_avg": _avg(first_tokens),
        "first_token_ms_p95": _percentile(first_tokens, 95),
        "retrieval_ms_avg": _avg(_present(chat_ok, "retrieval_ms")),
        "cag_ms_avg": _avg(_present(chat_ok, "cag_ms")),
        "generation_ms_avg": _avg(_present(chat_ok, "generation_ms")),
        "tokens_per_second": round(sum(r.completion_tokens for r in with_speed) / evaluated_ms * 1000, 1)
        if evaluated_ms
        else None,
    }


def _quality(chat_ok: list[RequestMetric]) -> dict:
    no_source = _present(chat_ok, "no_source")
    passages = _present(chat_ok, "rag_passages")
    top_scores = _present(chat_ok, "rag_top_score")
    cag_reused = _present(chat_ok, "cag_reused")
    return {
        "lab_questions": len(no_source),
        "no_source": sum(no_source),
        "no_source_rate_pct": _rate(sum(no_source), len(no_source)),
        "rag_requests": len(passages),
        "rag_hit_rate_pct": _rate(sum(1 for p in passages if p > 0), len(passages)),
        "rag_passages_avg": round(sum(passages) / len(passages), 1) if passages else None,
        "rag_top_score_avg": round(sum(top_scores) / len(top_scores), 3) if top_scores else None,
        "cag_requests": len(cag_reused),
        "cag_reuse_rate_pct": _rate(sum(cag_reused), len(cag_reused)),
    }


def _feedback(db: Session, since) -> dict:
    rows = db.execute(
        select(Message.feedback, Message.architectures_used).where(
            Message.role == "assistant", Message.feedback.is_not(None), Message.feedback_at >= since
        )
    ).all()
    by_architecture: dict[str, dict[str, int]] = {}
    for rating, architectures in rows:
        bucket = by_architecture.setdefault(classify_architecture(architectures), {"up": 0, "down": 0})
        bucket["up" if rating > 0 else "down"] += 1
    up = sum(1 for rating, _ in rows if rating > 0)
    return {
        "up": up,
        "down": len(rows) - up,
        "satisfaction_pct": _rate(up, len(rows)),
        "by_architecture": by_architecture,
    }


def _alerts(settings, chat: list[RequestMetric], p95: int | None, quality: dict) -> list[dict]:
    if len(chat) < settings.alert_min_requests:
        return []
    alerts = []
    error_rate = _rate(sum(1 for r in chat if r.status_code >= 400), len(chat)) or 0.0
    if error_rate > settings.alert_error_rate_pct:
        alerts.append({
            "level": "critical",
            "code": "error_rate",
            "message": f"{error_rate}% of chat requests failed (threshold {settings.alert_error_rate_pct}%).",
        })
    if p95 is not None and p95 > settings.alert_p95_ms:
        alerts.append({
            "level": "warning",
            "code": "slow_p95",
            "message": f"Chat p95 latency is {p95 / 1000:.1f} s (threshold {settings.alert_p95_ms / 1000:.0f} s).",
        })
    no_source_rate = quality["no_source_rate_pct"]
    if no_source_rate is not None and no_source_rate > settings.alert_no_source_rate_pct:
        alerts.append({
            "level": "warning",
            "code": "no_source_rate",
            "message": f"{no_source_rate}% of laboratory questions found no approved source "
            f"(threshold {settings.alert_no_source_rate_pct}%): documents or knowledge entries may be missing.",
        })
    return alerts


@router.get("/metrics")
def metrics(
    hours: int = Query(default=24, ge=1, le=24 * 90),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
) -> dict:
    since = utcnow() - timedelta(hours=hours)
    rows = db.scalars(
        select(RequestMetric).where(RequestMetric.created_at >= since).order_by(RequestMetric.id.desc()).limit(10000)
    ).all()
    chat = [r for r in rows if r.kind == "chat"]
    http = [r for r in rows if r.kind == "http"]
    chat_ok = [r for r in chat if r.status_code < 400]
    by_architecture = Counter("+".join(r.architectures_used or ["none"]) for r in chat_ok)
    by_mode = Counter(r.mode_requested or "unknown" for r in chat)
    errors = Counter(r.error_type or f"HTTP {r.status_code}" for r in rows if r.status_code >= 500)
    prompt_tokens = [r.prompt_tokens for r in chat_ok if r.prompt_tokens is not None]
    completion_tokens = [r.completion_tokens for r in chat_ok if r.completion_tokens is not None]
    chat_latencies = [r.latency_ms for r in chat_ok]
    http_latencies = [r.latency_ms for r in http]
    chat_p95 = _percentile(chat_latencies, 95)
    quality = _quality(chat_ok)
    return {
        "window_hours": hours,
        "retention_days": services.settings.metrics_retention_days,
        "alerts": _alerts(services.settings, chat, chat_p95, quality),
        "stages": _stages(chat_ok),
        "quality": quality,
        "safety": {
            "diagnosis_guard": sum(1 for r in chat if r.diagnosis_guard),
            "memory_refused_sensitive": sum(1 for r in chat if r.memory_refused_sensitive),
        },
        "feedback": _feedback(db, since),
        "chat": {
            "requests": len(chat),
            "errors": len(chat) - len(chat_ok),
            "latency_ms_avg": round(sum(chat_latencies) / len(chat_latencies)) if chat_latencies else None,
            "latency_ms_p95": chat_p95,
            "by_architecture": dict(by_architecture),
            "by_mode": dict(by_mode),
            "tokens": {
                "prompt_total": sum(prompt_tokens),
                "completion_total": sum(completion_tokens),
                "requests_with_usage": len(prompt_tokens),
                "note": "Token counts are those reported by Ollama (prompt_eval_count / eval_count).",
            },
        },
        "http": {
            "requests": len(http),
            "errors_5xx": sum(1 for r in http if r.status_code >= 500),
            "errors_4xx": sum(1 for r in http if 400 <= r.status_code < 500),
            "latency_ms_avg": round(sum(http_latencies) / len(http_latencies)) if http_latencies else None,
            "latency_ms_p95": _percentile(http_latencies, 95),
        },
        "errors_by_type": dict(errors),
        "recent_chat": [
            {
                "created_at": r.created_at,
                "mode": r.mode_requested,
                "architectures": r.architectures_used,
                "latency_ms": r.latency_ms,
                "first_token_ms": r.first_token_ms,
                "status": r.status_code,
                "prompt_tokens": r.prompt_tokens,
                "completion_tokens": r.completion_tokens,
                "role": r.user_role,
                "error": r.error_type,
            }
            for r in chat[:20]
        ],
    }


@router.get("/overview")
def overview(db: Session = Depends(get_db), services: Services = Depends(get_services)) -> dict:
    def count(model, *where) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    roles = dict(db.execute(select(User.role, func.count()).group_by(User.role)).all())
    doc_status = dict(db.execute(select(Document.status, func.count()).group_by(Document.status)).all())
    kb_status = dict(db.execute(select(KnowledgeItem.status, func.count()).group_by(KnowledgeItem.status)).all())
    return {
        "users": {"total": count(User), "by_role": roles, "archived": count(User, User.archived_at.is_not(None))},
        "invitations": {"pending": count(Invitation, Invitation.status == "pending", Invitation.expires_at >= utcnow())},
        "documents": {"total": count(Document), "by_status": doc_status, "vectors": services.store.size},
        "knowledge": {
            "total": count(KnowledgeItem),
            "approved": kb_status.get(KnowledgeStatus.APPROVED, 0),
            "by_status": kb_status,
            "kb_version": services.cag.current_version(db),
        },
        "conversations": count(Conversation),
        "memories": count(Memory),
        "index_consistent": services.rag.index_consistent(db),
        "llm_model": services.settings.ollama_model,
        "embedder": services.embedder.name,
    }
