import logging
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Memory, User
from app.models.base import as_utc, utcnow
from app.models.memory import MemoryCategory
from app.services.mag.extraction import extract_explicit_memory
from app.services.mag.sensitive import detect_sensitive
from app.services.text import overlap_score

logger = logging.getLogger(__name__)


class MemoryRejected(ValueError):
    pass


class SensitiveMemoryRejected(MemoryRejected):
    pass


@dataclass
class CaptureResult:
    stored: bool
    memory_id: int | None = None
    reason: str | None = None
    sensitive: bool = False


_PERSONAL_CUES = [
    "my ", "i prefer", "remember", "last time", "as usual", "for me", "mon ", "ma ", "mes ", "je préfère",
    "je prefere", "comme d'habitude", "pour moi", "la dernière fois", "souviens", "أفضل", "تذكر", "لي ", "عادتي",
]


def has_personal_cue(query: str) -> bool:
    lowered = f"{query.lower()} "
    return any(cue in lowered for cue in _PERSONAL_CUES)


class MagService:
    """User-scoped memory store. Every query is filtered by user_id."""

    def __init__(self, settings: Settings):
        self.settings = settings

    def _expiry(self):
        return utcnow() + timedelta(days=self.settings.memory_retention_days)

    def purge_expired(self, db: Session) -> int:
        result = db.execute(delete(Memory).where(Memory.expires_at < utcnow()))
        db.commit()
        if result.rowcount:
            logger.info("Purged %s expired memories", result.rowcount)
        return result.rowcount or 0

    def list_for_user(self, db: Session, user_id: int) -> list[Memory]:
        return list(
            db.scalars(
                select(Memory)
                .where(Memory.user_id == user_id, Memory.expires_at >= utcnow())
                .order_by(Memory.updated_at.desc())
            )
        )

    def get_for_user(self, db: Session, user_id: int, memory_id: int) -> Memory | None:
        return db.scalar(select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id))

    def count_for_user(self, db: Session, user_id: int) -> int:
        return db.scalar(select(func.count(Memory.id)).where(Memory.user_id == user_id)) or 0

    def validate(self, content: str) -> str:
        content = " ".join(content.split())
        if not content:
            raise MemoryRejected("Memory content is empty.")
        if len(content) > self.settings.memory_max_chars:
            raise MemoryRejected(f"Memories are limited to {self.settings.memory_max_chars} characters.")
        reason = detect_sensitive(content)
        if reason:
            raise SensitiveMemoryRejected(f"Not stored: contains {reason}. Memories are limited to non-sensitive preferences.")
        return content

    def create(
        self,
        db: Session,
        user: User,
        category: str,
        content: str,
        source: str,
        conversation_id: int | None = None,
    ) -> Memory:
        if category not in MemoryCategory.ALL:
            raise MemoryRejected("Unknown memory category.")
        content = self.validate(content)
        existing = db.scalar(
            select(Memory).where(Memory.user_id == user.id, func.lower(Memory.content) == content.lower())
        )
        if existing:
            existing.expires_at = self._expiry()
            existing.updated_at = utcnow()
            db.commit()
            return existing
        if category == MemoryCategory.LANGUAGE:
            db.execute(delete(Memory).where(Memory.user_id == user.id, Memory.category == MemoryCategory.LANGUAGE))
        if self.count_for_user(db, user.id) >= self.settings.memory_max_per_user:
            raise MemoryRejected(f"Memory limit reached ({self.settings.memory_max_per_user}). Delete old memories first.")
        memory = Memory(
            user_id=user.id,
            category=category,
            content=content,
            source=source,
            conversation_id=conversation_id,
            expires_at=self._expiry(),
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return memory

    def update(self, db: Session, memory: Memory, category: str | None, content: str | None) -> Memory:
        if content is not None:
            memory.content = self.validate(content)
        if category is not None:
            if category not in MemoryCategory.ALL:
                raise MemoryRejected("Unknown memory category.")
            memory.category = category
        memory.updated_at = utcnow()
        memory.expires_at = self._expiry()
        db.commit()
        db.refresh(memory)
        return memory

    def capture_from_message(self, db: Session, user: User, message: str, conversation_id: int) -> CaptureResult | None:
        """Store a memory only when the user explicitly asks and has enabled memory."""
        candidate = extract_explicit_memory(message, self.settings.memory_max_chars)
        if candidate is None:
            return None
        if not user.memory_enabled:
            return CaptureResult(stored=False, reason="Memory is disabled in your settings.")
        try:
            memory = self.create(db, user, candidate.category, candidate.content, "explicit_request", conversation_id)
        except MemoryRejected as exc:
            return CaptureResult(stored=False, reason=str(exc), sensitive=isinstance(exc, SensitiveMemoryRejected))
        return CaptureResult(stored=True, memory_id=memory.id)

    def relevant(self, db: Session, user: User, query: str, limit: int = 6) -> list[tuple[Memory, float]]:
        if not user.memory_enabled:
            return []
        memories = self.list_for_user(db, user.id)
        scored: list[tuple[Memory, float]] = []
        for memory in memories:
            score = overlap_score(query, memory.content)
            if memory.category in (MemoryCategory.LANGUAGE, MemoryCategory.STYLE):
                score = max(score, 0.5)
            if score > 0:
                scored.append((memory, round(score, 3)))
        scored.sort(key=lambda s: (s[1], as_utc(s[0].updated_at)), reverse=True)
        selected = scored[:limit]
        if selected:
            now = utcnow()
            for memory, _ in selected:
                memory.last_used_at = now
            db.commit()
        return selected
