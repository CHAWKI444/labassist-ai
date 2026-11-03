from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.auth import check_throttle, record_failure, throttle_key
from app.api.deps import get_db, get_services, require_staff
from app.core.security import create_access_token
from app.models import Invitation, User
from app.schemas.auth import TokenResponse, UserOut
from app.schemas.invitations import (
    InvitationAccept,
    InvitationCreate,
    InvitationOptions,
    InvitationOut,
    InvitationPreview,
    TokenBody,
)
from app.services.container import Services
from app.services.invitations import INVITABLE_ROLES, InvitationError, InvitationInvalid

router = APIRouter(prefix="/invitations", tags=["invitations"])


def _http(exc: InvitationError) -> HTTPException:
    return HTTPException(exc.status_code, str(exc))


def _out(db: Session, invitation: Invitation) -> InvitationOut:
    inviter = db.get(User, invitation.invited_by) if invitation.invited_by else None
    return InvitationOut.model_validate(invitation).model_copy(
        update={"invited_by_name": inviter.full_name if inviter else None}
    )


def _manageable(db: Session, user: User, invitation_id: int) -> Invitation:
    invitation = db.get(Invitation, invitation_id)
    # Staff only see and manage the invitations they sent; admins manage all of them.
    if invitation is None or (not user.is_admin and invitation.invited_by != user.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    return invitation


# ---------- authenticated (staff / admin) ----------
@router.get("/options", response_model=InvitationOptions)
def invitation_options(user: User = Depends(require_staff), services: Services = Depends(get_services)):
    return InvitationOptions(
        allowed_roles=list(INVITABLE_ROLES.get(user.role, ())),
        expire_hours=services.settings.invitation_expire_hours,
        email_backend=services.settings.email_backend,
    )


@router.get("", response_model=list[InvitationOut])
def list_invitations(
    status_filter: Literal["pending", "accepted", "expired", "cancelled"] | None = Query(default=None, alias="status"),
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    services.invitations.expire_stale(db)
    query = select(Invitation)
    if not user.is_admin:
        query = query.where(Invitation.invited_by == user.id)
    if status_filter:
        query = query.where(Invitation.status == status_filter)
    rows = db.scalars(query.order_by(Invitation.created_at.desc(), Invitation.id.desc()).limit(500)).all()
    return [_out(db, i) for i in rows]


@router.post("", response_model=InvitationOut, status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: InvitationCreate,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    try:
        invitation = services.invitations.create(db, user, payload.email, payload.role)
    except InvitationError as exc:
        raise _http(exc) from exc
    return _out(db, invitation)


@router.post("/{invitation_id}/resend", response_model=InvitationOut)
def resend_invitation(
    invitation_id: int,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    invitation = _manageable(db, user, invitation_id)
    try:
        services.invitations.resend(db, user, invitation)
    except InvitationError as exc:
        raise _http(exc) from exc
    return _out(db, invitation)


@router.post("/{invitation_id}/cancel", response_model=InvitationOut)
def cancel_invitation(
    invitation_id: int,
    user: User = Depends(require_staff),
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    invitation = _manageable(db, user, invitation_id)
    try:
        services.invitations.cancel(db, invitation)
    except InvitationError as exc:
        raise _http(exc) from exc
    return _out(db, invitation)


# ---------- public (token holder) ----------
# Tokens are sent in the request body, never in the URL, so they cannot appear in access logs.
@router.post("/verify", response_model=InvitationPreview)
def verify_invitation(
    payload: TokenBody, request: Request, db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    key = throttle_key(request, "invitation")
    check_throttle(key)
    try:
        invitation = services.invitations.verify(db, payload.token)
    except InvitationInvalid as exc:
        record_failure(key)
        raise _http(exc) from exc
    inviter = db.get(User, invitation.invited_by) if invitation.invited_by else None
    return InvitationPreview(
        id=invitation.id,
        email=invitation.email,
        role=invitation.role,
        expires_at=invitation.expires_at,
        invited_by_name=inviter.full_name if inviter else None,
        invited_by_role=inviter.role if inviter else None,
    )


@router.post("/decline", status_code=status.HTTP_204_NO_CONTENT)
def decline_invitation(
    payload: TokenBody, request: Request, db: Session = Depends(get_db), services: Services = Depends(get_services)
):
    key = throttle_key(request, "invitation")
    check_throttle(key)
    try:
        services.invitations.decline(db, payload.token)
    except InvitationInvalid as exc:
        record_failure(key)
        raise _http(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/accept", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def accept_invitation(
    payload: InvitationAccept,
    request: Request,
    db: Session = Depends(get_db),
    services: Services = Depends(get_services),
):
    if not payload.accept_terms:
        raise HTTPException(422, "You must accept the acceptable-use policy to create your account.")
    key = throttle_key(request, "invitation")
    check_throttle(key)
    try:
        user = services.invitations.accept(
            db, payload.token, payload.full_name, payload.password, payload.preferred_language, payload.job_title
        )
    except InvitationInvalid as exc:
        record_failure(key)
        raise _http(exc) from exc
    except InvitationError as exc:
        raise _http(exc) from exc
    return TokenResponse(access_token=create_access_token(user.id, user.role, user.token_version), user=UserOut.model_validate(user))
