from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.auth import check_throttle, record_failure, throttle_key
from app.api.deps import get_current_user, get_db, get_services
from app.core.security import create_access_token, hash_password, verify_password
from app.models import User
from app.models.notification import NotificationType
from app.schemas.account import PasswordChange, ProfileUpdate
from app.schemas.auth import TokenResponse, UserOut
from app.services import avatars
from app.services.container import Services
from app.services.notifications import notify

router = APIRouter(tags=["account"])


def _fresh_token(db: Session, user: User) -> TokenResponse:
    """Revoke every existing session and return a token for the current one."""
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)
    return TokenResponse(
        access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user)
    )


@router.get("/account", response_model=UserOut)
def get_account(user: User = Depends(get_current_user)):
    return user


@router.patch("/account/profile", response_model=UserOut)
def update_profile(payload: ProfileUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    changes = payload.model_dump(exclude_unset=True)
    if "full_name" in changes and changes["full_name"] is not None:
        user.full_name = changes["full_name"].strip()
    for field in ("phone", "job_title", "department"):
        if field in changes:
            value = (changes[field] or "").strip()
            setattr(user, field, value or None)
    if changes.get("preferred_language"):
        user.preferred_language = changes["preferred_language"]
    db.commit()
    db.refresh(user)
    return user


@router.post("/account/password", response_model=TokenResponse)
def change_password(
    payload: PasswordChange,
    request: Request,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Requires the current password. All other sessions are signed out; a new token is returned."""
    key = throttle_key(request, f"password-change:{user.id}")
    check_throttle(key)
    if not verify_password(payload.current_password, user.hashed_password):
        record_failure(key)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The current password is incorrect.")
    if verify_password(payload.new_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "The new password must be different from the current one.")
    user.hashed_password = hash_password(payload.new_password)
    notify(db, user.id, NotificationType.ACCOUNT, "Password changed",
           "Your password was changed and your other sessions were signed out. "
           "Contact an administrator if this was not you.", "/settings", commit=False)
    return _fresh_token(db, user)


@router.post("/account/sessions/revoke", response_model=TokenResponse)
def revoke_other_sessions(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    notify(db, user.id, NotificationType.ACCOUNT, "Signed out of other sessions",
           "All other browsers and devices were signed out of your account.", "/settings", commit=False)
    return _fresh_token(db, user)


@router.put("/account/avatar", response_model=UserOut)
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    data = await file.read(avatars.MAX_AVATAR_BYTES + 1)
    try:
        clean, kind = avatars.sanitise(data)
    except avatars.AvatarError as exc:
        raise HTTPException(422, str(exc)) from exc
    directory = services.settings.avatar_dir
    previous = user.avatar_key
    user.avatar_key = avatars.store(directory, clean, kind)
    db.commit()
    db.refresh(user)
    avatars.remove(directory, previous)
    return user


@router.delete("/account/avatar", response_model=UserOut)
def delete_avatar(
    user: User = Depends(get_current_user), db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    avatars.remove(services.settings.avatar_dir, user.avatar_key)
    user.avatar_key = None
    db.commit()
    db.refresh(user)
    return user


@router.get("/avatars/{key}", include_in_schema=False)
def serve_avatar(key: str, db: Session = Depends(get_db), services: Services = Depends(get_services)):
    """Profile photos are addressed by an unguessable random key (images cannot send auth headers)."""
    name = Path(key).name
    extension = name.rsplit(".", 1)[-1] if "." in name else ""
    path = services.settings.avatar_dir / name
    if name != key or extension not in avatars.MEDIA_TYPES or not path.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    if db.query(User.id).filter(User.avatar_key == name).first() is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return FileResponse(
        path,
        media_type=avatars.MEDIA_TYPES[extension],
        headers={"Cache-Control": "private, max-age=86400", "Content-Disposition": "inline"},
    )
