from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.auto_enrichment import enqueue_tasks_for_user_items, process_due_tasks
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient
from app.services.user_library import search_library_items

router = APIRouter(
    prefix="/api/v1/library",
    tags=["library"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


def get_google_books_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleBooksClient:
    return GoogleBooksClient(api_key=settings.google_books_api_key)


@router.get("/search")
async def search(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    query: Annotated[str, Query(min_length=2, max_length=200)],
    limit: Annotated[int, Query(ge=1, le=25)] = 10,
) -> dict[str, object]:
    await process_due_tasks(
        session,
        user_id=auth.user_id,
        limit=settings.enrichment_opportunistic_batch_size,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
    )
    items = search_library_items(
        session,
        user_id=auth.user_id,
        query=query,
        limit=limit,
    )
    if settings.enrichment_auto_enabled and items:  # pragma: no cover
        item_ids = [
            uuid.UUID(str(item["id"]))
            for item in items
            if isinstance(item, dict) and item.get("id")
        ]
        if item_ids:
            enqueue_tasks_for_user_items(
                session,
                user_id=auth.user_id,
                library_item_ids=item_ids,
                trigger_source="lazy",
                priority=130,
                lazy_cooldown_hours=settings.enrichment_lazy_cooldown_hours,
            )
    return ok({"items": items})
