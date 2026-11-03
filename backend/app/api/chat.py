import json
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse

from app.api.deps import get_current_user, get_services
from app.models import User
from app.schemas.chat import ChatRequest
from app.services.container import Services

router = APIRouter(prefix="/chat", tags=["chat"])


async def _events(services: Services, user_id: int, request: ChatRequest) -> AsyncIterator[dict]:
    # The stream outlives the request dependencies, so it owns its own session.
    with services.sessions() as db:
        user = db.get(User, user_id)
        try:
            async for event in services.orchestrator.run(db, user, request):
                yield event
        except LookupError as exc:
            yield {"event": "error", "data": {"detail": str(exc), "retryable": False}}


def _sse(event: dict) -> str:
    return f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False, default=str)}\n\n"


@router.post("/stream")
async def chat_stream(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    services: Services = Depends(get_services),
) -> StreamingResponse:
    async def body() -> AsyncIterator[str]:
        async for event in _events(services, user.id, request):
            yield _sse(event)

    return StreamingResponse(
        body(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("")
async def chat(
    request: ChatRequest,
    user: User = Depends(get_current_user),
    services: Services = Depends(get_services),
) -> dict:
    """Non-streaming variant returning the final assistant message."""
    meta: dict = {}
    async for event in _events(services, user.id, request):
        if event["event"] == "meta":
            meta = event["data"]
        elif event["event"] == "error":
            code = status.HTTP_404_NOT_FOUND if not event["data"].get("retryable") else status.HTTP_502_BAD_GATEWAY
            raise HTTPException(code, event["data"]["detail"])
        elif event["event"] == "done":
            return {**event["data"], "conversation_title": meta.get("conversation_title")}
    raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "No answer produced")
