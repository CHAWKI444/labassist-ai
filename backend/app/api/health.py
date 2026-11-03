from fastapi import APIRouter, Depends
from sqlalchemy import text

from app.api.deps import get_services
from app.services.container import Services

router = APIRouter(tags=["health"])


@router.get("/health")
async def health(services: Services = Depends(get_services)) -> dict:
    """Public liveness/readiness probe. Reports component status only, no data."""
    database = {"ok": True}
    try:
        with services.sessions() as db:
            db.execute(text("SELECT 1"))
            db.execute(text("SELECT 1 FROM users LIMIT 1"))
    except Exception as exc:  # noqa: BLE001
        database = {"ok": False, "error": type(exc).__name__}

    ollama = await services.llm.health()
    overall = "ok" if database["ok"] and ollama.get("reachable") else "degraded"
    return {
        "status": overall,
        "app": services.settings.app_name,
        "database": database,
        "ollama": ollama,
        "vector_index": {
            "vectors": services.store.size,
            "embedder": services.embedder.name,
            "needs_rebuild": services.store.needs_rebuild,
        },
    }
