import csv
import io
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_db, get_services, require_admin
from app.core.security import hash_password
from app.models import Conversation, Invitation, Memory, Notification, Role, User
from app.models.base import utcnow
from app.models.invitation import InvitationStatus
from app.models.notification import NotificationType
from app.schemas.auth import (
    AdminUserCreate,
    AdminUserUpdate,
    BulkResult,
    BulkUserAction,
    UserDetail,
    UserOut,
    UserPage,
    UserStats,
)
from app.services import avatars
from app.services.container import Services
from app.services.notifications import notify

router = APIRouter(prefix="/admin/users", tags=["users"], dependencies=[Depends(require_admin)])


def _get(db: Session, user_id: int) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _active_admin_count(db: Session, excluding: int | None = None) -> int:
    query = select(func.count(User.id)).where(
        User.role == Role.ADMIN.value, User.is_active.is_(True), User.archived_at.is_(None)
    )
    if excluding is not None:
        query = query.where(User.id != excluding)
    return db.scalar(query) or 0


def _guard_last_admin(db: Session, user: User, action: str) -> None:
    if user.role == Role.ADMIN.value and user.archived_at is None and _active_admin_count(db, user.id) == 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Cannot {action} the last active administrator.")


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _filtered(search, role, status_filter, department, created_within_days):
    query = select(User)
    if search and search.strip():
        pattern = f"%{_escape_like(search.strip().lower())}%"
        query = query.where(
            or_(
                func.lower(User.email).like(pattern, escape="\\"),
                func.lower(User.full_name).like(pattern, escape="\\"),
                func.lower(func.coalesce(User.job_title, "")).like(pattern, escape="\\"),
            )
        )
    if role:
        query = query.where(User.role == role)
    if department:
        query = query.where(User.department == department)
    if status_filter == "active":
        query = query.where(User.archived_at.is_(None), User.is_active.is_(True))
    elif status_filter == "archived":
        query = query.where(or_(User.archived_at.is_not(None), User.is_active.is_(False)))
    if created_within_days:
        query = query.where(User.created_at >= utcnow() - timedelta(days=created_within_days))
    return query


@router.get("", response_model=UserPage)
def list_users(
    search: str | None = Query(default=None, max_length=100),
    role: Literal["patient", "staff", "admin"] | None = None,
    status_filter: Literal["active", "archived"] | None = Query(default=None, alias="status"),
    department: str | None = Query(default=None, max_length=120),
    created_within_days: int | None = Query(default=None, ge=1, le=3650),
    limit: int = Query(default=25, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> UserPage:
    query = _filtered(search, role, status_filter, department, created_within_days)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(User.created_at.desc(), User.id.desc()).limit(limit).offset(offset)).all()
    return UserPage(items=[UserOut.model_validate(u) for u in items], total=total)


@router.get("/stats", response_model=UserStats)
def user_stats(db: Session = Depends(get_db)) -> UserStats:
    def count(*where) -> int:
        return db.scalar(select(func.count(User.id)).where(*where)) or 0

    now = utcnow()
    month_ago = now - timedelta(days=30)
    pending = (Invitation.status == InvitationStatus.PENDING, Invitation.expires_at >= now)
    departments = db.scalars(
        select(User.department).where(User.department.is_not(None)).distinct().order_by(User.department)
    ).all()
    return UserStats(
        total=count(),
        active=count(User.archived_at.is_(None), User.is_active.is_(True)),
        archived=count(or_(User.archived_at.is_not(None), User.is_active.is_(False))),
        pending_invitations=db.scalar(select(func.count(Invitation.id)).where(*pending)) or 0,
        expiring_invitations_48h=db.scalar(
            select(func.count(Invitation.id)).where(*pending, Invitation.expires_at < now + timedelta(hours=48))
        ) or 0,
        new_last_30_days=count(User.created_at >= month_ago),
        signed_in_last_30_days=count(User.last_login_at >= month_ago),
        departments=[d for d in departments if d],
    )


@router.get("/export.csv")
def export_users(
    search: str | None = Query(default=None, max_length=100),
    role: Literal["patient", "staff", "admin"] | None = None,
    status_filter: Literal["active", "archived"] | None = Query(default=None, alias="status"),
    department: str | None = Query(default=None, max_length=120),
    created_within_days: int | None = Query(default=None, ge=1, le=3650),
    db: Session = Depends(get_db),
) -> Response:
    """Account metadata only. Passwords, conversations and memories are never exported."""
    rows = db.scalars(
        _filtered(search, role, status_filter, department, created_within_days).order_by(User.id)
    ).all()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["id", "email", "full_name", "job_title", "department", "role", "status", "created_at",
                     "last_login_at", "archived_at"])
    for u in rows:
        writer.writerow([u.id, u.email, u.full_name, u.job_title or "", u.department or "", u.role, u.status,
                         u.created_at.isoformat(), u.last_login_at.isoformat() if u.last_login_at else "",
                         u.archived_at.isoformat() if u.archived_at else ""])
    return Response(
        content="\ufeff" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="labassist-users.csv"'},
    )


@router.post("/bulk", response_model=BulkResult)
def bulk_action(payload: BulkUserAction, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    updated: list[int] = []
    skipped: dict[int, str] = {}
    for user_id in dict.fromkeys(payload.ids):
        try:
            if payload.action == "archive":
                archive_user(user_id, db, current)
            else:
                restore_user(user_id, db)
            updated.append(user_id)
        except HTTPException as exc:
            skipped[user_id] = str(exc.detail)
    return BulkResult(updated=updated, skipped=skipped)


@router.get("/{user_id}", response_model=UserDetail)
def get_user(user_id: int, db: Session = Depends(get_db)) -> UserDetail:
    user = _get(db, user_id)

    def count(model, *where) -> int:
        return db.scalar(select(func.count()).select_from(model).where(*where)) or 0

    return UserDetail(
        **UserOut.model_validate(user).model_dump(),
        updated_at=user.updated_at,
        conversation_count=count(Conversation, Conversation.user_id == user.id),
        memory_count=count(Memory, Memory.user_id == user.id),
        unread_notifications=count(Notification, Notification.user_id == user.id, Notification.read_at.is_(None)),
        invitations_sent=count(Invitation, Invitation.invited_by == user.id),
    )


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: AdminUserCreate, db: Session = Depends(get_db)):
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        email=payload.email,
        full_name=payload.full_name.strip(),
        job_title=(payload.job_title or "").strip() or None,
        department=(payload.department or "").strip() or None,
        hashed_password=hash_password(payload.password),
        role=payload.role,
        preferred_language=payload.preferred_language,
    )
    db.add(user)
    db.flush()
    notify(db, user.id, NotificationType.ACCOUNT, "Welcome to LabAssist AI",
           f"An administrator created your {user.role} account.", commit=False)
    db.commit()
    db.refresh(user)
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    payload: AdminUserUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
):
    user = _get(db, user_id)
    if payload.role is not None and payload.role != user.role:
        if user.id == current.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot change your own role.")
        if user.role == Role.ADMIN.value:
            _guard_last_admin(db, user, "demote")
        previous = user.role
        user.role = payload.role
        notify(db, user.id, NotificationType.ACCOUNT, "Your role was changed",
               f"An administrator changed your role from {previous} to {payload.role}.", commit=False)
    if payload.full_name is not None:
        user.full_name = payload.full_name.strip()
    if payload.job_title is not None:
        user.job_title = payload.job_title.strip() or None
    if payload.department is not None:
        user.department = payload.department.strip() or None
    if payload.password:
        user.hashed_password = hash_password(payload.password)
        user.token_version = (user.token_version or 0) + 1
        notify(db, user.id, NotificationType.ACCOUNT, "Your password was reset",
               "An administrator set a new password for your account. Contact them if this was unexpected.",
               commit=False)
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/archive", response_model=UserOut)
def archive_user(user_id: int, db: Session = Depends(get_db), current: User = Depends(require_admin)):
    """Temporarily disable an account. Data is kept; the user cannot sign in until restored."""
    user = _get(db, user_id)
    if user.id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot archive your own account.")
    if user.archived_at is not None:
        return user
    _guard_last_admin(db, user, "archive")
    user.archived_at = utcnow()
    user.archived_by = current.id
    user.is_active = False
    db.commit()
    db.refresh(user)
    return user


@router.post("/{user_id}/restore", response_model=UserOut)
def restore_user(user_id: int, db: Session = Depends(get_db)):
    user = _get(db, user_id)
    if user.archived_at is None and user.is_active:
        return user
    user.archived_at = None
    user.archived_by = None
    user.is_active = True
    notify(db, user.id, NotificationType.ACCOUNT, "Your account was restored",
           "Your account was reactivated by an administrator.", commit=False)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(require_admin),
    services: Services = Depends(get_services),
):
    """Permanently delete an account and its personal data (conversations, memories, notifications)."""
    user = _get(db, user_id)
    if user.id == current.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot delete your own account.")
    _guard_last_admin(db, user, "delete")
    avatar_key = user.avatar_key
    db.delete(user)
    db.commit()
    avatars.remove(services.settings.avatar_dir, avatar_key)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
