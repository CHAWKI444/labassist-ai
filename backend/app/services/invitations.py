import hashlib
import html
import logging
import secrets
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.models import Invitation, User
from app.models.base import as_utc, utcnow
from app.models.invitation import InvitationStatus
from app.models.notification import NotificationType
from app.services.email import EmailResult, EmailSender
from app.services.notifications import notify

logger = logging.getLogger(__name__)

# Which roles each inviter role may grant. Patients cannot invite.
INVITABLE_ROLES: dict[str, tuple[str, ...]] = {
    "admin": ("patient", "staff", "admin"),
    "staff": ("patient",),
}

ROLE_LABELS = {"patient": ("patient", "patient"), "staff": ("membre du personnel", "staff member"),
               "admin": ("administrateur", "administrator")}


class InvitationError(Exception):
    status_code = 400


class InvitationForbidden(InvitationError):
    status_code = 403


class InvitationConflict(InvitationError):
    status_code = 409


class InvitationInvalid(InvitationError):
    """Generic error for unknown, used, cancelled or expired links (no detail leaks)."""

    status_code = 410

    def __init__(self):
        super().__init__("This invitation link is invalid or has expired.")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


class InvitationService:
    def __init__(self, settings: Settings, email: EmailSender):
        self.settings = settings
        self.email = email

    # ---------- helpers ----------
    def _new_token(self) -> tuple[str, str]:
        token = secrets.token_urlsafe(32)
        return token, hash_token(token)

    def _expiry(self):
        return utcnow() + timedelta(hours=self.settings.invitation_expire_hours)

    def link_for(self, token: str) -> str:
        # Token travels in the URL fragment, which browsers never send to servers (keeps it out of access logs).
        return f"{self.settings.frontend_base_url.rstrip('/')}/invite#token={token}"

    def refresh_status(self, db: Session, invitation: Invitation) -> Invitation:
        if invitation.status == InvitationStatus.PENDING and as_utc(invitation.expires_at) < utcnow():
            invitation.status = InvitationStatus.EXPIRED
            db.commit()
        return invitation

    def expire_stale(self, db: Session) -> None:
        db.execute(
            update(Invitation)
            .where(Invitation.status == InvitationStatus.PENDING, Invitation.expires_at < utcnow())
            .values(status=InvitationStatus.EXPIRED)
        )
        db.commit()

    @staticmethod
    def check_role_allowed(inviter: User, role: str) -> None:
        if role not in INVITABLE_ROLES.get(inviter.role, ()):
            raise InvitationForbidden(f"Your role cannot invite users with the '{role}' role.")

    def _ensure_invitable_email(self, db: Session, email: str, exclude_id: int | None = None) -> None:
        if db.scalar(select(User.id).where(User.email == email)):
            raise InvitationConflict("An account with this email already exists.")
        query = select(Invitation).where(Invitation.email == email, Invitation.status == InvitationStatus.PENDING)
        if exclude_id is not None:
            query = query.where(Invitation.id != exclude_id)
        if db.scalar(query):
            raise InvitationConflict("A pending invitation already exists for this email. Resend it instead.")

    # ---------- email ----------
    def _send(self, db: Session, invitation: Invitation, token: str, inviter: User) -> EmailResult:
        link = self.link_for(token)
        hours = self.settings.invitation_expire_hours
        role_fr, role_en = ROLE_LABELS.get(invitation.role, (invitation.role, invitation.role))
        inviter_name = inviter.full_name
        subject = "Invitation à LabAssist AI / Invitation to LabAssist AI"
        text = (
            f"Bonjour,\n\n{inviter_name} vous invite à rejoindre LabAssist AI en tant que {role_fr}.\n"
            f"Pour accepter l'invitation et créer votre compte, ouvrez ce lien (valable {hours} heures, usage unique) :\n"
            f"{link}\n\nSi vous n'attendiez pas cette invitation, ignorez ce message.\n\n"
            "---\n\n"
            f"Hello,\n\n{inviter_name} invited you to join LabAssist AI as a {role_en}.\n"
            f"To accept and create your account, open this link (valid for {hours} hours, single use):\n"
            f"{link}\n\nIf you were not expecting this invitation, you can ignore this email.\n"
        )
        safe_link = html.escape(link, quote=True)
        safe_name = html.escape(inviter_name)
        html_body = f"""<div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;margin:auto;color:#1e293b">
<h2 style="color:#0f766e">LabAssist AI</h2>
<p>{safe_name} vous invite à rejoindre LabAssist AI en tant que <b>{html.escape(role_fr)}</b>.</p>
<p><a href="{safe_link}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Accepter l'invitation</a></p>
<p style="font-size:13px;color:#64748b">Lien valable {hours} heures, à usage unique.</p>
<hr style="border:none;border-top:1px solid #e2e8f0">
<p>{safe_name} invited you to join LabAssist AI as a <b>{html.escape(role_en)}</b>.</p>
<p><a href="{safe_link}">Accept the invitation</a> — valid for {hours} hours, single use.</p>
<p style="font-size:12px;color:#94a3b8">If you were not expecting this invitation, ignore this email.</p>
</div>"""
        result = self.email.send(invitation.email, subject, text, html_body)
        invitation.send_count += 1
        invitation.last_sent_at = utcnow()
        invitation.email_status = result.status
        invitation.email_error = result.error
        db.commit()
        logger.info("Invitation id=%s delivery status=%s", invitation.id, result.status)
        return result

    # ---------- lifecycle ----------
    def create(self, db: Session, inviter: User, email: str, role: str) -> Invitation:
        self.check_role_allowed(inviter, role)
        self.expire_stale(db)
        self._ensure_invitable_email(db, email)
        token, token_hash = self._new_token()
        invitation = Invitation(
            email=email, role=role, token_hash=token_hash, expires_at=self._expiry(), invited_by=inviter.id
        )
        db.add(invitation)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise InvitationConflict("A pending invitation already exists for this email.") from exc
        db.refresh(invitation)
        self._send(db, invitation, token, inviter)
        return invitation

    def resend(self, db: Session, inviter: User, invitation: Invitation) -> Invitation:
        self.refresh_status(db, invitation)
        if invitation.status not in (InvitationStatus.PENDING, InvitationStatus.EXPIRED):
            raise InvitationConflict(f"An invitation that is {invitation.status} cannot be resent.")
        self.check_role_allowed(inviter, invitation.role)
        self._ensure_invitable_email(db, invitation.email, exclude_id=invitation.id)
        token, token_hash = self._new_token()  # the previous link stops working immediately
        invitation.token_hash = token_hash
        invitation.expires_at = self._expiry()
        invitation.status = InvitationStatus.PENDING
        db.commit()
        self._send(db, invitation, token, inviter)
        return invitation

    def cancel(self, db: Session, invitation: Invitation) -> Invitation:
        self.refresh_status(db, invitation)
        if invitation.status != InvitationStatus.PENDING:
            raise InvitationConflict(f"Only pending invitations can be cancelled (this one is {invitation.status}).")
        invitation.status = InvitationStatus.CANCELLED
        invitation.cancelled_at = utcnow()
        db.commit()
        return invitation

    def verify(self, db: Session, token: str) -> Invitation:
        invitation = db.scalar(select(Invitation).where(Invitation.token_hash == hash_token(token)))
        if invitation is None:
            raise InvitationInvalid()
        self.refresh_status(db, invitation)
        if invitation.status != InvitationStatus.PENDING:
            raise InvitationInvalid()
        return invitation

    def decline(self, db: Session, token: str) -> None:
        invitation = self.verify(db, token)
        invitation.status = InvitationStatus.CANCELLED
        invitation.cancelled_at = utcnow()
        if invitation.invited_by:
            notify(db, invitation.invited_by, NotificationType.INVITATION, "Invitation declined",
                   f"{invitation.email} declined your invitation.", "/invitations", commit=False)
        db.commit()

    def accept(
        self, db: Session, token: str, full_name: str, password: str, language: str, job_title: str | None = None
    ) -> User:
        invitation = self.verify(db, token)
        if db.scalar(select(User.id).where(User.email == invitation.email)):
            raise InvitationConflict("An account with this email already exists. Sign in instead.")
        claimed = db.execute(
            update(Invitation)
            .where(Invitation.id == invitation.id, Invitation.status == InvitationStatus.PENDING)
            .values(status=InvitationStatus.ACCEPTED, accepted_at=utcnow())
        )
        if claimed.rowcount != 1:  # lost a race with another acceptance or a cancellation
            db.rollback()
            raise InvitationInvalid()
        user = User(
            email=invitation.email,
            full_name=full_name.strip(),
            job_title=(job_title or "").strip() or None,
            hashed_password=hash_password(password),
            role=invitation.role,
            preferred_language=language,
        )
        db.add(user)
        db.flush()
        invitation.accepted_user_id = user.id
        notify(db, user.id, NotificationType.ACCOUNT, "Welcome to LabAssist AI",
               f"Your {invitation.role} account was created from an invitation.", commit=False)
        if invitation.invited_by:
            notify(db, invitation.invited_by, NotificationType.INVITATION, "Invitation accepted",
                   f"{user.full_name} ({user.email}) accepted your invitation and joined as {invitation.role}.",
                   "/invitations", commit=False)
        db.commit()
        db.refresh(user)
        return user
