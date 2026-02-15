from __future__ import annotations

from collections.abc import Awaitable, Callable
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.core.audit import write_api_audit_log
from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.schema_guard import run_schema_guard
from app.routers import (
    authors,
    books,
    editions,
    health,
    highlights,
    library,
    library_search,
    me,
    notes,
    protected,
    reviews,
    sessions,
    storygraph_imports,
    version,
    works,
)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="The Seedbed API",
        description="API for The Seedbed book tracking application",
        version=settings.api_version,
    )

    @app.on_event("startup")
    def _schema_guard_startup() -> None:
        run_schema_guard()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_allowed_origins),
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_exception_handlers(app)

    @app.middleware("http")
    async def rate_limit_audit_log_middleware(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        start = perf_counter()
        response = await call_next(request)
        event = getattr(request.state, "rate_limit_event", None)
        if event:
            latency_ms = int((perf_counter() - start) * 1000)
            write_api_audit_log(
                client_id=event["client_id"],
                user_id=event["user_id"],
                method=event["method"],
                path=event["path"],
                status=event["status"],
                latency_ms=max(latency_ms, event["latency_ms"]),
                ip=event["ip"],
            )
        return response

    app.include_router(health.router)
    app.include_router(version.router)
    app.include_router(protected.router)
    app.include_router(books.router)
    app.include_router(authors.router)
    app.include_router(editions.router)
    app.include_router(me.router)
    app.include_router(library.router)
    app.include_router(library_search.router)
    app.include_router(sessions.router)
    app.include_router(storygraph_imports.router)
    app.include_router(notes.router)
    app.include_router(highlights.router)
    app.include_router(reviews.public_router)
    app.include_router(reviews.router)
    app.include_router(works.router)
    return app
