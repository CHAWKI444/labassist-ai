from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import Conversation, Message, User
from app.models.base import utcnow
from app.schemas.chat import (
    ConversationDetail,
    ConversationOut,
    ConversationRename,
    ConversationSummary,
    FeedbackIn,
    FeedbackOut,
)
from app.services.text import truncate

router = APIRouter(prefix="/conversations", tags=["conversations"])


def _owned(db: Session, user: User, conversation_id: int) -> Conversation:
    """Every conversation endpoint is scoped to its owner; other users (admins included) get 404."""
    conversation = db.scalar(
        select(Conversation).where(Conversation.id == conversation_id, Conversation.user_id == user.id)
    )
    if conversation is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conversation not found")
    return conversation


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _excerpt(text: str, term: str, width: int = 140) -> str:
    index = text.lower().find(term.lower())
    if index < 0:
        return truncate(text, width)
    start = max(0, index - width // 3)
    snippet = text[start : start + width]
    return ("…" if start else "") + " ".join(snippet.split()) + ("…" if start + width < len(text) else "")


@router.get("", response_model=list[ConversationSummary])
def list_conversations(
    q: str | None = Query(default=None, max_length=200, description="Search titles and message text"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    counts = (
        select(Message.conversation_id, func.count(Message.id).label("n"), func.max(Message.id).label("last_id"))
        .group_by(Message.conversation_id)
        .subquery()
    )
    query = (
        select(Conversation, func.coalesce(counts.c.n, 0), counts.c.last_id)
        .outerjoin(counts, counts.c.conversation_id == Conversation.id)
        .where(Conversation.user_id == user.id)
    )
    term = (q or "").strip()
    if term:
        pattern = f"%{_escape_like(term.lower())}%"
        matching = select(Message.conversation_id).where(func.lower(Message.content).like(pattern, escape="\\"))
        query = query.where(
            or_(func.lower(Conversation.title).like(pattern, escape="\\"), Conversation.id.in_(matching))
        )
    rows = db.execute(query.order_by(Conversation.updated_at.desc()).limit(limit).offset(offset)).all()

    last_ids = [last_id for _, _, last_id in rows if last_id]
    previews = (
        {m.conversation_id: m.content for m in db.scalars(select(Message).where(Message.id.in_(last_ids)))}
        if last_ids
        else {}
    )
    matches: dict[int, str] = {}
    if term and rows:
        pattern = f"%{_escape_like(term.lower())}%"
        for message in db.scalars(
            select(Message)
            .where(
                Message.conversation_id.in_([c.id for c, _, _ in rows]),
                func.lower(Message.content).like(pattern, escape="\\"),
            )
            .order_by(Message.id)
        ):
            matches.setdefault(message.conversation_id, _excerpt(message.content, term))

    return [
        ConversationSummary(
            **ConversationOut.model_validate(conversation).model_dump(),
            message_count=count,
            last_message_preview=truncate(previews[conversation.id], 120) if conversation.id in previews else None,
            match_excerpt=matches.get(conversation.id),
        )
        for conversation, count, _ in rows
    ]


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _owned(db, user, conversation_id)


@router.patch("/{conversation_id}", response_model=ConversationOut)
def rename_conversation(
    conversation_id: int,
    payload: ConversationRename,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = _owned(db, user, conversation_id)
    conversation.title = payload.title.strip()
    db.commit()
    db.refresh(conversation)
    return conversation


@router.put("/{conversation_id}/messages/{message_id}/feedback", response_model=FeedbackOut)
def set_feedback(
    conversation_id: int,
    message_id: int,
    payload: FeedbackIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conversation = _owned(db, user, conversation_id)
    message = db.scalar(
        select(Message).where(
            Message.id == message_id,
            Message.conversation_id == conversation.id,
            Message.role == "assistant",
            Message.error.is_(None),
        )
    )
    if message is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Answer not found")
    message.feedback = payload.rating
    message.feedback_at = utcnow() if payload.rating is not None else None
    db.commit()
    return FeedbackOut(message_id=message.id, rating=message.feedback)


@router.delete("/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversation(conversation_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    db.delete(_owned(db, user, conversation_id))
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
