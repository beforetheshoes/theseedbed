from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.auto_enrichment import (
    approve_needs_review_task,
    dismiss_task,
    enqueue_tasks_for_user_items,
    get_enrichment_summary,
    list_enrichment_tasks,
    list_recent_results,
    process_due_tasks,
    reset_skipped_and_failed_tasks,
    retry_and_process_now,
    retry_task,
    trigger_all_missing_for_user,
)
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient

router = APIRouter(
    prefix="/api/v1/library/enrichment",
    tags=["library"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


def get_open_library_client() -> OpenLibraryClient:  # pragma: no cover
    return OpenLibraryClient()


def get_google_books_client(  # pragma: no cover
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleBooksClient:
    return GoogleBooksClient(api_key=settings.google_books_api_key)


class TriggerRequest(BaseModel):
    library_item_ids: list[uuid.UUID] = Field(default_factory=list, max_length=500)


class ApproveRequest(BaseModel):
    selections: list[dict[str, Any]] | None = None


class ProcessRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=100)


@router.get("/summary")
async def summary(  # pragma: no cover
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
) -> dict[str, object]:
    await process_due_tasks(
        session,
        user_id=auth.user_id,
        limit=settings.enrichment_opportunistic_batch_size,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
        allow_when_disabled=True,
    )
    counts = get_enrichment_summary(session, user_id=auth.user_id)
    return ok(
        {
            **counts,
            "processing_enabled": settings.enrichment_processing_enabled,
            "auto_enabled": settings.enrichment_auto_enabled,
        }
    )


@router.get("/tasks")
def list_tasks(  # pragma: no cover
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    status: str | None = Query(default=None),
    limit: int = Query(default=25, ge=1, le=100),
    cursor: str | None = Query(default=None),
) -> dict[str, object]:
    parsed_cursor: dt.datetime | None = None
    if cursor:
        try:
            parsed_cursor = dt.datetime.fromisoformat(cursor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid cursor") from exc
    items, next_cursor = list_enrichment_tasks(
        session,
        user_id=auth.user_id,
        status=status,
        limit=limit,
        cursor=parsed_cursor,
    )
    return ok({"items": items, "next_cursor": next_cursor})


@router.post("/trigger")
def trigger(  # pragma: no cover
    payload: TriggerRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    if payload.library_item_ids:
        created = enqueue_tasks_for_user_items(
            session,
            user_id=auth.user_id,
            library_item_ids=payload.library_item_ids,
            trigger_source="manual_bulk",
            priority=50,
            lazy_cooldown_hours=settings.enrichment_lazy_cooldown_hours,
        )
    else:
        created = trigger_all_missing_for_user(
            session,
            user_id=auth.user_id,
            priority=60,
            lazy_cooldown_hours=settings.enrichment_lazy_cooldown_hours,
        )
    return ok({"enrichment_queued": created})


@router.post("/process")
async def process_batch(  # pragma: no cover
    payload: ProcessRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
) -> dict[str, object]:
    requested_limit = payload.limit or settings.enrichment_opportunistic_batch_size
    safe_limit = max(1, min(requested_limit, settings.enrichment_max_batch_size))
    results = await process_due_tasks(
        session,
        user_id=auth.user_id,
        limit=safe_limit,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
        allow_when_disabled=True,
    )
    return ok({**results, "limit": safe_limit})


class EnrichRequest(BaseModel):
    limit: int | None = Field(default=None, ge=1, le=100)


@router.post("/enrich")
async def enrich(  # pragma: no cover
    payload: EnrichRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
) -> dict[str, object]:
    # Reset any previously skipped/failed tasks so they get retried
    retrying = reset_skipped_and_failed_tasks(session, user_id=auth.user_id)
    queued = trigger_all_missing_for_user(
        session,
        user_id=auth.user_id,
        priority=60,
        lazy_cooldown_hours=settings.enrichment_lazy_cooldown_hours,
    )
    requested_limit = payload.limit or settings.enrichment_opportunistic_batch_size
    safe_limit = max(1, min(requested_limit, settings.enrichment_max_batch_size))
    results = await process_due_tasks(
        session,
        user_id=auth.user_id,
        limit=safe_limit,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
        allow_when_disabled=True,
    )
    return ok({"queued": queued + retrying, "results": results})


@router.get("/recent-results")
def recent_results(  # pragma: no cover
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: int = Query(default=50, ge=1, le=100),
) -> dict[str, object]:
    items = list_recent_results(session, user_id=auth.user_id, limit=limit)
    return ok({"items": items})


@router.post("/{task_id}/retry")
def retry(  # pragma: no cover
    task_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        item = retry_task(session, user_id=auth.user_id, task_id=task_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(item)


@router.post("/{task_id}/retry-now")
async def retry_now(  # pragma: no cover
    task_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
) -> dict[str, object]:
    """Reset a task, clear its no-match caches, process it immediately,
    and return the outcome so the UI can show the result inline."""
    try:
        item = await retry_and_process_now(
            session,
            user_id=auth.user_id,
            task_id=task_id,
            settings=settings,
            open_library=open_library,
            google_books=google_books,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(item)


@router.post("/{task_id}/dismiss")
def dismiss(  # pragma: no cover
    task_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        item = dismiss_task(session, user_id=auth.user_id, task_id=task_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(item)


@router.post("/{task_id}/approve")
async def approve(  # pragma: no cover
    task_id: uuid.UUID,
    payload: ApproveRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
) -> dict[str, object]:
    try:
        item = await approve_needs_review_task(
            session,
            user_id=auth.user_id,
            task_id=task_id,
            selections=payload.selections,
            settings=settings,
            open_library=open_library,
            google_books=google_books,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok(item)
