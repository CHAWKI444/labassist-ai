import logging
import re
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.models import Conversation, Message, RequestMetric, User
from app.models.base import utcnow
from app.schemas.chat import ChatRequest
from app.services.cag.service import CagService, ContextLookup
from app.services.embeddings import EmbeddingError
from app.services.llm import LLMClient, LLMError, LLMUsage
from app.services.mag.service import MagService
from app.services.orchestration.prompts import build_messages
from app.services.orchestration.router import asks_for_diagnosis, is_lab_topic, plan_sources
from app.services.rag.service import RagService, RetrievedChunk
from app.services.text import estimate_tokens, truncate

logger = logging.getLogger(__name__)

HISTORY_MESSAGES = 6
_REF_PATTERN = re.compile(r"\[(D\d+|KB\d+)\]")


@dataclass
class GatheredContext:
    rag_hits: list[RetrievedChunk] = field(default_factory=list)
    rag_considered: int = 0
    cag: ContextLookup | None = None
    cag_used: bool = False
    cag_matches: list = field(default_factory=list)
    memories: list = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    rag_top_score: float | None = None
    retrieval_ms: int | None = None
    cag_ms: int | None = None


def _elapsed_ms(since: float) -> int:
    return int((time.perf_counter() - since) * 1000)


class Orchestrator:
    """Single entry point coordinating RAG, CAG and MAG for every chat request."""

    def __init__(self, settings: Settings, rag: RagService, cag: CagService, mag: MagService, llm: LLMClient):
        self.settings = settings
        self.rag = rag
        self.cag = cag
        self.mag = mag
        self.llm = llm

    # ---------- conversation helpers ----------
    def _conversation(self, db: Session, user: User, request: ChatRequest) -> Conversation:
        if request.conversation_id is not None:
            conversation = db.scalar(
                select(Conversation).where(
                    Conversation.id == request.conversation_id, Conversation.user_id == user.id
                )
            )
            if conversation is None:
                raise LookupError("Conversation not found")
            return conversation
        conversation = Conversation(user_id=user.id, title=truncate(request.message, 60))
        db.add(conversation)
        db.commit()
        db.refresh(conversation)
        return conversation

    def _user_message(self, db: Session, conversation: Conversation, request: ChatRequest) -> Message:
        last = db.scalar(
            select(Message).where(Message.conversation_id == conversation.id).order_by(Message.id.desc()).limit(1)
        )
        if last is not None and last.role == "user" and last.content == request.message:
            return last  # retry after a failed generation: do not duplicate the question
        message = Message(
            conversation_id=conversation.id,
            role="user",
            content=request.message,
            language=request.language,
            mode_requested=request.mode,
        )
        db.add(message)
        conversation.updated_at = utcnow()
        db.commit()
        db.refresh(message)
        return message

    def _history(self, db: Session, conversation_id: int, before_id: int) -> list[dict]:
        rows = db.scalars(
            select(Message)
            .where(Message.conversation_id == conversation_id, Message.id < before_id, Message.error.is_(None))
            .order_by(Message.id.desc())
            .limit(HISTORY_MESSAGES)
        ).all()
        return [{"role": m.role, "content": truncate(m.content, 1200)} for m in reversed(rows)]

    # ---------- context gathering ----------
    async def _gather(self, db: Session, user: User, request: ChatRequest, plan) -> GatheredContext:
        ctx = GatheredContext()
        query = request.message

        if plan.consult_rag:
            stage = time.perf_counter()
            try:
                hits = await run_in_threadpool(self.rag.retrieve, db, query, user.is_staff)
                ctx.rag_considered = len(hits)
                ctx.rag_hits = [h for h in hits if h.score >= self.settings.rag_min_score]
                ctx.rag_top_score = round(float(max(h.score for h in hits)), 4) if hits else None
            except EmbeddingError as exc:
                ctx.warnings.append(f"Document retrieval unavailable: {exc}")
            ctx.retrieval_ms = _elapsed_ms(stage)

        if plan.consult_cag:
            stage = time.perf_counter()
            lookup = self.cag.get_context(db, "staff" if user.is_staff else "public")
            ctx.cag = lookup
            if lookup.context.items:
                ctx.cag_matches = self.cag.match_items(query, lookup.context)
                if request.mode in ("cag", "hybrid"):
                    ctx.cag_used = True
                else:
                    ctx.cag_used = bool(ctx.cag_matches) or is_lab_topic(query)
            ctx.cag_ms = _elapsed_ms(stage)

        if plan.consult_mag:
            ctx.memories = self.mag.relevant(db, user, query)
        return ctx

    # ---------- main flow ----------
    async def run(self, db: Session, user: User, request: ChatRequest) -> AsyncIterator[dict]:
        started = time.perf_counter()
        conversation = self._conversation(db, user, request)
        user_message = self._user_message(db, conversation, request)
        capture = self.mag.capture_from_message(db, user, request.message, conversation.id)

        has_knowledge = request.mode in ("auto", "hybrid", "cag")
        plan = plan_sources(
            request.mode,
            request.message,
            has_documents=self.rag.store.size > 0,
            has_knowledge=has_knowledge,
            memory_enabled=user.memory_enabled,
        )
        ctx = await self._gather(db, user, request, plan)

        architectures: list[str] = []
        sources: list[dict] = []
        rag_blocks: list[str] = []
        for i, hit in enumerate(ctx.rag_hits, start=1):
            ref = f"D{i}"
            page = f", page {hit.page}" if hit.page else ""
            rag_blocks.append(
                f"[{ref}] {hit.title} (document v{hit.document_version}, updated {hit.document_updated_at}{page})\n"
                f"{hit.text}"
            )
            sources.append(
                {
                    "type": "document",
                    "ref": ref,
                    "title": hit.title,
                    "document_id": hit.document_id,
                    "page": hit.page,
                    "excerpt": truncate(hit.text, 400),
                    "score": hit.score,
                    "cited": False,
                    "outdated": False,
                }
            )
        if rag_blocks:
            architectures.append("rag")

        cag_text = None
        if ctx.cag_used and ctx.cag:
            cag_text = ctx.cag.context.text
            architectures.append("cag")
            for item, score in ctx.cag_matches[:4]:
                sources.append(self._kb_source(item, score))

        memory_lines = [f"({m.category}) {m.content}" for m, _ in ctx.memories]
        if memory_lines:
            architectures.append("mag")

        notes = self._notes(request, plan, ctx, capture, bool(rag_blocks), bool(cag_text))
        signals = {
            "retrieval_ms": ctx.retrieval_ms,
            "cag_ms": ctx.cag_ms,
            "rag_top_score": ctx.rag_top_score,
            "rag_passages": len(ctx.rag_hits) if plan.consult_rag else None,
            # Only laboratory questions that consulted a knowledge source count toward the no-source rate.
            "no_source": (not rag_blocks and not cag_text)
            if (plan.consult_rag or plan.consult_cag) and is_lab_topic(request.message)
            else None,
            "cag_reused": ctx.cag.reused if ctx.cag_used and ctx.cag else None,
            "diagnosis_guard": asks_for_diagnosis(request.message),
            "memory_refused_sensitive": bool(capture and capture.sensitive),
        }
        messages = build_messages(
            language=request.language,
            cag_text=cag_text,
            rag_blocks=rag_blocks,
            memory_lines=memory_lines,
            history=self._history(db, conversation.id, user_message.id),
            question=request.message,
            notes=notes,
        )
        prompt_estimate = sum(estimate_tokens(m["content"]) for m in messages)

        context_info = {
            "plan": plan.reasons,
            "kb_version": ctx.cag.context.kb_version if ctx.cag else None,
            "cag": self._cag_info(ctx),
            "rag": {
                "consulted": plan.consult_rag,
                "candidates": ctx.rag_considered,
                "kept": len(ctx.rag_hits),
                "min_score": self.settings.rag_min_score,
            },
            "mag": {
                "consulted": plan.consult_mag,
                "memories_used": len(memory_lines),
                "memory_enabled": user.memory_enabled,
                "capture": capture.__dict__ if capture else None,
            },
            "prompt_tokens_estimated": prompt_estimate,
            "warnings": ctx.warnings,
        }
        if prompt_estimate > self.settings.ollama_num_ctx - self.settings.llm_max_answer_tokens:
            context_info["warnings"].append(
                "Prompt is close to the model context window; older history may be truncated by the model."
            )

        yield {
            "event": "meta",
            "data": {
                "conversation_id": conversation.id,
                "conversation_title": conversation.title,
                "user_message_id": user_message.id,
                "architectures_used": architectures or ["llm"],
                "sources": sources,
                "context_info": context_info,
            },
        }

        answer_parts: list[str] = []
        usage: LLMUsage | None = None
        generation_started = time.perf_counter()
        try:
            async for chunk in self.llm.stream_chat(messages):
                if chunk.text:
                    if not answer_parts:
                        signals["first_token_ms"] = _elapsed_ms(started)
                    answer_parts.append(chunk.text)
                    yield {"event": "token", "data": {"text": chunk.text}}
                if chunk.usage:
                    usage = chunk.usage
        except LLMError as exc:
            signals["generation_ms"] = _elapsed_ms(generation_started)
            self._record_metric(
                db, user, request, architectures, _elapsed_ms(started), 502, None, type(exc).__name__, signals
            )
            logger.warning("LLM failure: %s", str(exc)[:160])
            yield {"event": "error", "data": {"detail": str(exc), "retryable": True, "conversation_id": conversation.id}}
            return
        signals["generation_ms"] = _elapsed_ms(generation_started)

        answer = "".join(answer_parts).strip() or "(The model returned an empty answer.)"
        sources = self._finalise_sources(answer, sources, ctx)
        latency = _elapsed_ms(started)
        context_info["latency_ms"] = latency
        context_info["timings"] = {
            "first_token_ms": signals.get("first_token_ms"),
            "retrieval_ms": ctx.retrieval_ms,
            "cag_ms": ctx.cag_ms,
            "generation_ms": signals["generation_ms"],
        }
        if usage:
            context_info["usage"] = {
                "model": usage.model,
                "prompt_tokens_evaluated": usage.prompt_tokens,
                "completion_tokens": usage.completion_tokens,
                "prompt_eval_ms": usage.prompt_eval_ms,
                "eval_ms": usage.eval_ms,
                "total_ms": usage.total_ms,
            }

        assistant = Message(
            conversation_id=conversation.id,
            role="assistant",
            content=answer,
            language=request.language,
            mode_requested=request.mode,
            architectures_used=architectures or ["llm"],
            sources=sources,
            context_info=context_info,
        )
        db.add(assistant)
        conversation.updated_at = utcnow()
        db.commit()
        db.refresh(assistant)
        self._record_metric(db, user, request, architectures or ["llm"], latency, 200, usage, None, signals)

        yield {
            "event": "done",
            "data": {
                "message": {
                    "id": assistant.id,
                    "role": "assistant",
                    "content": answer,
                    "language": request.language,
                    "mode_requested": request.mode,
                    "architectures_used": assistant.architectures_used,
                    "sources": sources,
                    "context_info": context_info,
                    "error": None,
                    "created_at": assistant.created_at.isoformat(),
                    "feedback": None,
                },
                "conversation_id": conversation.id,
            },
        }

    # ---------- helpers ----------
    @staticmethod
    def _kb_source(item, score: float | None) -> dict:
        return {
            "type": "knowledge",
            "ref": f"KB{item.id}",
            "title": item.title,
            "knowledge_id": item.id,
            "page": None,
            "excerpt": truncate(item.content, 400),
            "score": round(score, 3) if score is not None else None,
            "cited": False,
            "outdated": item.outdated,
        }

    def _finalise_sources(self, answer: str, sources: list[dict], ctx: GatheredContext) -> list[dict]:
        cited = set(_REF_PATTERN.findall(answer))
        known = {s["ref"] for s in sources}
        if ctx.cag_used and ctx.cag:
            for item in ctx.cag.context.items:
                ref = f"KB{item.id}"
                if ref in cited and ref not in known:
                    sources.append(self._kb_source(item, None))
        for source in sources:
            source["cited"] = source["ref"] in cited
        return sources

    @staticmethod
    def _cag_info(ctx: GatheredContext) -> dict:
        if not ctx.cag:
            return {"consulted": False, "used": False}
        context = ctx.cag.context
        return {
            "consulted": True,
            "used": ctx.cag_used,
            "audience": context.audience,
            "application_context_reused": ctx.cag.reused,
            "context_source": ctx.cag.source,
            "content_hash": context.content_hash[:12],
            "token_estimate": context.token_estimate,
            "items_included": len(context.items),
            "items_excluded_by_budget": len(context.excluded_item_ids),
            "outdated_items": context.outdated_item_ids,
            "model_kv_cache": "not controlled by LabAssist; compare prompt_tokens_evaluated with the estimate",
        }

    def _notes(self, request, plan, ctx: GatheredContext, capture, used_rag: bool, used_cag: bool) -> list[str]:
        notes: list[str] = []
        lab_topic = is_lab_topic(request.message)
        if request.mode == "mag":
            notes.append(
                "Only user memories are available in this mode. Do not answer laboratory policy or medical "
                "questions from general knowledge; suggest switching to Auto, RAG, CAG or Hybrid mode."
            )
        elif (plan.consult_rag or plan.consult_cag) and not used_rag and not used_cag and lab_topic:
            notes.append(
                "No approved laboratory source matched this question. State that the information is not "
                "available in the approved sources. Do not guess."
            )
        elif not used_rag and not used_cag:
            notes.append(
                "No laboratory sources are provided for this answer. Do not state any laboratory policy, "
                "price, schedule or medical fact."
            )
        if request.mode == "rag" and not used_rag:
            notes.append("No sufficiently relevant document passage was found for this question.")
        if request.mode == "cag" and not used_cag:
            notes.append("The approved knowledge base is empty for your access level.")
        if used_cag and ctx.cag and ctx.cag.context.outdated_item_ids:
            notes.append("Some approved entries are marked REVIEW OVERDUE; mention this if you rely on them.")
        if asks_for_diagnosis(request.message):
            notes.append(
                "The user may be asking for a diagnosis or result interpretation. Do not provide one; explain "
                "that a physician must interpret results and recommend consulting one."
            )
        if capture is not None:
            if capture.stored:
                notes.append("The user asked you to remember something and it was saved. Confirm briefly.")
            else:
                notes.append(f"The user asked you to remember something but it was NOT saved: {capture.reason} "
                             "Tell the user politely.")
        return notes

    def _record_metric(self, db, user, request, architectures, latency, status, usage, error_type, signals) -> None:
        try:
            db.add(
                RequestMetric(
                    kind="chat",
                    path="/api/chat",
                    method="POST",
                    status_code=status,
                    latency_ms=latency,
                    user_role=user.role,
                    mode_requested=request.mode,
                    architectures_used=architectures,
                    model=getattr(self.llm, "model", None),
                    prompt_tokens=usage.prompt_tokens if usage else None,
                    completion_tokens=usage.completion_tokens if usage else None,
                    eval_ms=usage.eval_ms if usage else None,
                    error_type=error_type,
                    **signals,
                )
            )
            db.commit()
        except Exception:  # noqa: BLE001 - metrics must never break chat
            db.rollback()
            logger.exception("Could not record chat metric")
