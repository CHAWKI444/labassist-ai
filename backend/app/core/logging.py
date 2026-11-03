import logging
import re

_SECRET_PATTERNS = [
    re.compile(r"(?i)(authorization|password|token|secret)(['\"]?\s*[:=]\s*['\"]?)([^\s,'\"}]+)"),
    re.compile(r"(?i)bearer\s+[a-z0-9\-_.]+"),
]


class RedactingFilter(logging.Filter):
    """Masks credentials if they ever end up in a log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        redacted = message
        for pattern in _SECRET_PATTERNS:
            redacted = pattern.sub(
                lambda m: f"{m.group(1)}{m.group(2)}***" if m.lastindex and m.lastindex >= 3 else "Bearer ***",
                redacted,
            )
        if redacted != message:
            record.msg = redacted
            record.args = ()
        return True


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
    handler.addFilter(RedactingFilter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)
    for noisy in ("httpx", "httpcore", "multipart", "faiss"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
