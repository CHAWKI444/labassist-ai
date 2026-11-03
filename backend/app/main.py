import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import get_settings
from app.core.database import session_factory
from app.core.logging import configure_logging
from app.models import RequestMetric
from app.services.container import Services, build_services
from app.services.metrics import purge_expired_metrics

logger = logging.getLogger("labassist")

_UNMETERED_PREFIXES = ("/api/health", "/api/chat", "/api/notifications/unread-count")


def _purge_expired(services: Services) -> None:
    with services.sessions() as db:
        services.mag.purge_expired(db)
        purge_expired_metrics(db, services.settings.metrics_retention_days)
        services.labvision.purge_expired(db)


async def _retention_loop(services: Services, interval_seconds: int = 3600) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        try:
            await run_in_threadpool(_purge_expired, services)
        except Exception:  # noqa: BLE001
            logger.exception("Retention job failed")


def _startup_checks(services: Services) -> None:
    try:
        _purge_expired(services)
        with services.sessions() as db:
            if not services.rag.index_consistent(db):
                logger.warning(
                    "FAISS index (%s vectors) does not match the database; rebuild it from the admin dashboard.",
                    services.store.size,
                )
    except Exception as exc:  # noqa: BLE001 - the app should still start so /api/health can report it
        logger.error("Startup checks failed (is the database migrated?): %s", type(exc).__name__)


def create_app(services: Services | None = None) -> FastAPI:
    configure_logging()
    settings = services.settings if services else get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if getattr(app.state, "services", None) is None:
            app.state.services = build_services(settings, session_factory())
        _startup_checks(app.state.services)
        task = asyncio.create_task(_retention_loop(app.state.services))
        logger.info("LabAssist AI started (model=%s)", settings.ollama_model)
        yield
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task

    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
    app.state.services = services
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def metrics_and_headers(request: Request, call_next):
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        path = request.url.path
        if path.startswith("/api") and not path.startswith(_UNMETERED_PREFIXES) and request.method != "OPTIONS":
            latency = int((time.perf_counter() - started) * 1000)
            route = request.scope.get("route")
            await run_in_threadpool(
                _record_http_metric,
                request.app.state.services,
                getattr(route, "path", path)[:120],
                request.method,
                response.status_code,
                latency,
                getattr(request.state, "user_role", None),
            )
        return response

    app.include_router(api_router)
    return app


def _record_http_metric(services: Services, path: str, method: str, status: int, latency: int, role) -> None:
    try:
        with services.sessions() as db:
            db.add(
                RequestMetric(
                    kind="http", path=path, method=method, status_code=status, latency_ms=latency, user_role=role
                )
            )
            db.commit()
    except Exception:  # noqa: BLE001 - metrics must never break requests
        logger.debug("Could not record HTTP metric")


app = create_app()
