from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.models import Notification, User
from app.models.base import utcnow
from app.schemas.notifications import NotificationOut, NotificationPage, UnreadCount

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _unread(db: Session, user_id: int) -> int:
    return db.scalar(
        select(func.count(Notification.id)).where(Notification.user_id == user_id, Notification.read_at.is_(None))
    ) or 0


@router.get("", response_model=NotificationPage)
def list_notifications(
    filter_: Literal["all", "unread", "read"] = Query(default="all", alias="filter"),
    type_: Literal["invitation", "account", "event", "system"] | None = Query(default=None, alias="type"),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> NotificationPage:
    query = select(Notification).where(Notification.user_id == user.id)
    if filter_ == "unread":
        query = query.where(Notification.read_at.is_(None))
    elif filter_ == "read":
        query = query.where(Notification.read_at.is_not(None))
    if type_:
        query = query.where(Notification.type == type_)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(Notification.created_at.desc(), Notification.id.desc()).limit(limit).offset(offset))
    return NotificationPage(
        items=[NotificationOut.model_validate(n) for n in items], total=total, unread=_unread(db, user.id)
    )


@router.get("/unread-count", response_model=UnreadCount)
def unread_count(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UnreadCount:
    return UnreadCount(unread=_unread(db, user.id))


@router.post("/read-all", response_model=UnreadCount)
def mark_all_read(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> UnreadCount:
    db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.read_at.is_(None))
        .values(read_at=utcnow())
    )
    db.commit()
    return UnreadCount(unread=0)


def _owned(db: Session, user: User, notification_id: int) -> Notification:
    notification = db.scalar(
        select(Notification).where(Notification.id == notification_id, Notification.user_id == user.id)
    )
    if notification is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    return notification


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = _owned(db, user, notification_id)
    if notification.read_at is None:
        notification.read_at = utcnow()
        db.commit()
    return notification


@router.post("/{notification_id}/unread", response_model=NotificationOut)
def mark_unread(notification_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notification = _owned(db, user, notification_id)
    notification.read_at = None
    db.commit()
    return notification
