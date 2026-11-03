import threading
import time

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db, get_services
from app.core.security import create_access_token, hash_password, verify_password
from app.models import Invitation, Role, User
from app.models.base import utcnow
from app.models.invitation import InvitationStatus
from app.models.notification import NotificationType
from app.services.notifications import notify
from app.schemas.auth import LoginRequest, RegisterRequest, TokenResponse, UserOut, UserPreferencesUpdate
from app.services.container import Services

router = APIRouter(prefix="/auth", tags=["auth"])

_MAX_FAILURES = 5
_WINDOW_SECONDS = 300
_failures: dict[str, list[float]] = {}
_failures_lock = threading.Lock()


def throttle_key(request: Request, subject: str) -> str:
    client = request.client.host if request.client else "unknown"
    return f"{client}|{subject}"


def check_throttle(key: str) -> None:
    now = time.monotonic()
    with _failures_lock:
        recent = [t for t in _failures.get(key, []) if now - t < _WINDOW_SECONDS]
        _failures[key] = recent
        if len(recent) >= _MAX_FAILURES:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.")


def record_failure(key: str) -> int:
    """Record a failed attempt and return how many attempts remain before lockout."""
    with _failures_lock:
        attempts = _failures.setdefault(key, [])
        attempts.append(time.monotonic())
        return max(0, _MAX_FAILURES - len(attempts))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    key = throttle_key(request, payload.email)
    check_throttle(key)
    user = db.scalar(select(User).where(User.email == payload.email))
    if user is None or not verify_password(payload.password, user.hashed_password):
        remaining = record_failure(key)
        detail = "Invalid email or password."
        if remaining <= 3:
            detail += f" {remaining} attempt(s) remaining before a {_WINDOW_SECONDS // 60}-minute lockout."
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail)
    if user.archived_at is not None or not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account is archived. Contact an administrator.")
    with _failures_lock:
        _failures.pop(key, None)
    user.last_login_at = utcnow()
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest, db: Session = Depends(get_db), services: Services = Depends(get_services)
) -> TokenResponse:
    if not services.settings.allow_self_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Self-registration is disabled")
    if db.scalar(select(User).where(User.email == payload.email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(
        email=payload.email,
        full_name=payload.full_name.strip(),
        hashed_password=hash_password(payload.password),
        role=Role.PATIENT.value,  # self-registered accounts are always patients
        preferred_language=payload.preferred_language,
    )
    db.add(user)
    db.flush()
    # A pending invitation for this address can no longer be used once the account exists.
    db.execute(
        update(Invitation)
        .where(Invitation.email == payload.email, Invitation.status == InvitationStatus.PENDING)
        .values(status=InvitationStatus.CANCELLED, cancelled_at=utcnow())
    )
    notify(db, user.id, NotificationType.ACCOUNT, "Welcome to LabAssist AI",
           "Your patient account is ready. You can enable memory on the My memory page.", "/memory", commit=False)
    db.commit()
    db.refresh(user)
    return TokenResponse(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(payload: UserPreferencesUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user = db.merge(user)
    if payload.memory_enabled is not None:
        user.memory_enabled = payload.memory_enabled
    if payload.preferred_language is not None:
        user.preferred_language = payload.preferred_language
    db.commit()
    db.refresh(user)
    return user
