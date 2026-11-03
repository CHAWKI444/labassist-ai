import hashlib
import logging
import threading
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import CagContext, KnowledgeBaseVersion, KnowledgeItem
from app.models.base import utcnow
from app.models.knowledge import KnowledgeStatus
from app.services.text import estimate_tokens, overlap_score

logger = logging.getLogger(__name__)

AUDIENCES = ("public", "staff")

KV_CACHE_EXPLANATION = (
    "Application-level reuse: LabAssist builds the approved-knowledge context once per knowledge-base "
    "version and audience, stores it (memory + PostgreSQL) and reuses the identical text for every query "
    "until approved content changes. Model KV-cache reuse is a separate, inference-engine concern: the "
    "prepared context is always placed first in the prompt so Ollama/llama.cpp *may* reuse the cached "
    "prefix when the same model instance is still loaded, but this is not guaranteed or controlled by "
    "LabAssist. The 'prompt_tokens_evaluated' value reported by Ollama is shown so the effect can be "
    "observed rather than assumed."
)


@dataclass
class CagItemRef:
    id: int
    title: str
    kind: str
    content: str
    outdated: bool


@dataclass
class PreparedContext:
    audience: str
    kb_version: int
    content_hash: str
    text: str
    token_estimate: int
    items: list[CagItemRef] = field(default_factory=list)
    excluded_item_ids: list[int] = field(default_factory=list)
    built_at: str = ""
    hits: int = 0

    @property
    def outdated_item_ids(self) -> list[int]:
        return [i.id for i in self.items if i.outdated]


@dataclass
class ContextLookup:
    context: PreparedContext
    reused: bool
    source: str  # memory | database | built


class CagService:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._cache: dict[str, PreparedContext] = {}

    # ---------- versions ----------
    @staticmethod
    def current_version(db: Session) -> int:
        return db.scalar(select(func.max(KnowledgeBaseVersion.version))) or 0

    def bump_version(self, db: Session, reason: str, user_id: int | None) -> int:
        """Record a new knowledge-base version and invalidate all prepared contexts."""
        new_version = self.current_version(db) + 1
        db.add(KnowledgeBaseVersion(version=new_version, reason=reason[:200], changed_by=user_id))
        db.query(CagContext).delete()
        db.commit()
        self.invalidate()
        logger.info("Knowledge base version bumped to %s (%s)", new_version, reason[:60])
        return new_version

    def invalidate(self) -> None:
        with self._lock:
            self._cache.clear()

    # ---------- budget ----------
    @property
    def effective_budget(self) -> int:
        """CAG budget, never larger than what the model window can hold next to RAG/MAG and the answer."""
        reserve_for_rest = 1500
        window_room = self.settings.ollama_num_ctx - self.settings.llm_max_answer_tokens - reserve_for_rest
        return max(0, min(self.settings.cag_max_context_tokens, window_room))

    # ---------- build / lookup ----------
    def get_context(self, db: Session, audience: str) -> ContextLookup:
        if audience not in AUDIENCES:
            raise ValueError(f"Unknown audience {audience}")
        version = self.current_version(db)
        with self._lock:
            cached = self._cache.get(audience)
            if cached and cached.kb_version == version:
                cached.hits += 1
                return ContextLookup(cached, reused=True, source="memory")

        row = db.scalar(select(CagContext).where(CagContext.audience == audience))
        if row and row.kb_version == version:
            context = self._from_row(db, row)
            row.hits += 1
            db.commit()
            source, reused = "database", True
        else:
            context = self._build(db, audience, version)
            self._persist(db, context)
            source, reused = "built", False
        with self._lock:
            self._cache[audience] = context
        return ContextLookup(context, reused=reused, source=source)

    def rebuild(self, db: Session) -> dict[str, PreparedContext]:
        self.invalidate()
        db.query(CagContext).delete()
        db.commit()
        return {a: self.get_context(db, a).context for a in AUDIENCES}

    def _approved_items(self, db: Session, audience: str) -> list[KnowledgeItem]:
        query = select(KnowledgeItem).where(KnowledgeItem.status == KnowledgeStatus.APPROVED)
        if audience == "public":
            query = query.where(KnowledgeItem.visibility == "public")
        return list(db.scalars(query.order_by(KnowledgeItem.priority, KnowledgeItem.id)))

    def _build(self, db: Session, audience: str, version: int) -> PreparedContext:
        today = date.today()
        budget = self.effective_budget
        header = (
            f"APPROVED LABORATORY KNOWLEDGE (knowledge-base version {version}, audience: {audience}).\n"
            "Each entry is identified as [KB<number>]. Entries marked REVIEW OVERDUE may be outdated.\n"
        )
        parts = [header]
        used = estimate_tokens(header)
        included: list[CagItemRef] = []
        excluded: list[int] = []
        for item in self._approved_items(db, audience):
            outdated = item.review_due is not None and item.review_due < today
            flag = " [REVIEW OVERDUE - may be outdated]" if outdated else ""
            block = f"\n[KB{item.id}] ({item.kind}, {item.language}){flag} {item.title}\n{item.content.strip()}\n"
            cost = estimate_tokens(block)
            if used + cost > budget:
                excluded.append(item.id)
                continue
            parts.append(block)
            used += cost
            included.append(CagItemRef(item.id, item.title, item.kind, item.content, outdated))
        text = "".join(parts) if included else ""
        if excluded:
            logger.warning("CAG context for %s excluded %s item(s) over the token budget", audience, len(excluded))
        return PreparedContext(
            audience=audience,
            kb_version=version,
            content_hash=hashlib.sha256(text.encode("utf-8")).hexdigest(),
            text=text,
            token_estimate=estimate_tokens(text) if text else 0,
            items=included,
            excluded_item_ids=excluded,
            built_at=utcnow().isoformat(),
        )

    def _persist(self, db: Session, context: PreparedContext) -> None:
        db.query(CagContext).filter(CagContext.audience == context.audience).delete()
        db.add(
            CagContext(
                audience=context.audience,
                kb_version=context.kb_version,
                content_hash=context.content_hash,
                context_text=context.text,
                token_estimate=context.token_estimate,
                included_item_ids=[i.id for i in context.items],
                excluded_item_ids=context.excluded_item_ids,
                outdated_item_ids=context.outdated_item_ids,
            )
        )
        db.commit()

    def _from_row(self, db: Session, row: CagContext) -> PreparedContext:
        ids = list(row.included_item_ids or [])
        items = {i.id: i for i in db.scalars(select(KnowledgeItem).where(KnowledgeItem.id.in_(ids)))} if ids else {}
        outdated = set(row.outdated_item_ids or [])
        refs = [
            CagItemRef(i, items[i].title, items[i].kind, items[i].content, i in outdated) for i in ids if i in items
        ]
        return PreparedContext(
            audience=row.audience,
            kb_version=row.kb_version,
            content_hash=row.content_hash,
            text=row.context_text,
            token_estimate=row.token_estimate,
            items=refs,
            excluded_item_ids=list(row.excluded_item_ids or []),
            built_at=row.built_at.isoformat(),
            hits=row.hits,
        )

    # ---------- relevance ----------
    @staticmethod
    def match_items(query: str, context: PreparedContext, threshold: float = 0.2) -> list[tuple[CagItemRef, float]]:
        scored = [(item, overlap_score(query, f"{item.title} {item.content}")) for item in context.items]
        return sorted([s for s in scored if s[1] >= threshold], key=lambda s: s[1], reverse=True)

    def status(self, db: Session) -> dict:
        version = self.current_version(db)
        rows = {r.audience: r for r in db.scalars(select(CagContext))}
        audiences = {}
        for audience in AUDIENCES:
            row = rows.get(audience)
            audiences[audience] = {
                "prepared": bool(row and row.kb_version == version),
                "kb_version": row.kb_version if row else None,
                "token_estimate": row.token_estimate if row else None,
                "included_items": len(row.included_item_ids or []) if row else 0,
                "excluded_item_ids": list(row.excluded_item_ids or []) if row else [],
                "outdated_item_ids": list(row.outdated_item_ids or []) if row else [],
                "built_at": row.built_at.isoformat() if row else None,
                "hits": row.hits if row else 0,
                "content_hash": row.content_hash[:12] if row else None,
            }
        with self._lock:
            for audience, cached in self._cache.items():
                if cached.kb_version == version:
                    audiences[audience]["hits"] = max(audiences[audience]["hits"], cached.hits)
                    audiences[audience]["in_memory"] = True
        return {"kb_version": version, "audiences": audiences, "effective_budget": self.effective_budget}
