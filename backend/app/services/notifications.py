from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Notification, User


def notify(
    db: Session, user_id: int, type_: str, title: str, body: str = "", link: str | None = None, commit: bool = True
) -> Notification:
    notification = Notification(user_id=user_id, type=type_, title=title[:200], body=body[:1000], link=link)
    db.add(notification)
    if commit:
        db.commit()
    return notification


def notify_users(
    db: Session, user_ids: Iterable[int], type_: str, title: str, body: str = "", link: str | None = None
) -> int:
    count = 0
    for user_id in set(user_ids):
        notify(db, user_id, type_, title, body, link, commit=False)
        count += 1
    db.commit()
    return count


def active_user_ids(db: Session, roles: Iterable[str] | None = None) -> list[int]:
    query = select(User.id).where(User.is_active.is_(True), User.archived_at.is_(None))
    if roles:
        query = query.where(User.role.in_(list(roles)))
    return list(db.scalars(query))
