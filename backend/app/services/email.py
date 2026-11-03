import logging
import smtplib
import ssl
import uuid
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import make_msgid
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger(__name__)


@dataclass
class EmailResult:
    status: str  # sent | saved_to_outbox | failed
    error: str | None = None


class EmailSender(Protocol):
    def send(self, to: str, subject: str, text: str, html: str | None = None) -> EmailResult: ...


def _build(
    settings: Settings, to: str, subject: str, text: str, html: str | None, cte: str | None = None
) -> EmailMessage:
    message = EmailMessage()
    message["From"] = settings.smtp_from
    message["To"] = to
    message["Subject"] = subject
    message["Message-ID"] = make_msgid(domain="labassist.local")
    message.set_content(text, cte=cte)
    if html:
        message.add_alternative(html, subtype="html", cte=cte)
    return message


class SmtpEmailSender:
    def __init__(self, settings: Settings):
        self.settings = settings

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> EmailResult:
        s = self.settings
        if not s.smtp_host:
            return EmailResult("failed", "SMTP_HOST is not configured")
        message = _build(s, to, subject, text, html)
        try:
            if s.smtp_ssl:
                server = smtplib.SMTP_SSL(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds,
                                          context=ssl.create_default_context())
            else:
                server = smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=s.smtp_timeout_seconds)
            with server:
                if s.smtp_starttls and not s.smtp_ssl:
                    server.starttls(context=ssl.create_default_context())
                if s.smtp_username:
                    server.login(s.smtp_username, s.smtp_password)
                server.send_message(message)
        except (smtplib.SMTPException, OSError) as exc:
            # Only the exception type is logged: SMTP errors can echo addresses or credentials.
            logger.warning("SMTP delivery failed: %s", type(exc).__name__)
            return EmailResult("failed", f"SMTP delivery failed ({type(exc).__name__})")
        logger.info("Email sent (subject=%r)", subject)
        return EmailResult("sent")


class OutboxEmailSender:
    """Development backend: writes the message to DATA_DIR/outbox instead of sending it."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def send(self, to: str, subject: str, text: str, html: str | None = None) -> EmailResult:
        outbox = self.settings.outbox_dir
        outbox.mkdir(parents=True, exist_ok=True)
        path = outbox / f"{uuid.uuid4().hex}.eml"
        # 8-bit keeps the invitation link readable when the .eml file is opened in a text editor.
        path.write_bytes(bytes(_build(self.settings, to, subject, text, html, cte="8bit")))
        logger.info("Email saved to outbox file %s", path.name)
        return EmailResult("saved_to_outbox")


def build_email_sender(settings: Settings) -> EmailSender:
    return SmtpEmailSender(settings) if settings.email_backend == "smtp" else OutboxEmailSender(settings)
