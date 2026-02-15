from __future__ import annotations

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient
from app.services.storage import StorageNotConfiguredError
from app.services.user_library import get_or_create_profile
from app.services.work_covers import (
    list_googlebooks_cover_candidates,
    list_openlibrary_cover_candidates,
    select_cover_from_url,
    select_openlibrary_cover,
)
from app.services.work_metadata_enrichment import (
    apply_enrichment_selections,
    get_enrichment_candidates,
)
from app.services.works import (
    get_work_detail,
    list_related_works,
    list_work_editions,
    refresh_work_if_stale,
)

router = APIRouter(tags=["works"])


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


def get_google_books_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleBooksClient:
    return GoogleBooksClient(api_key=settings.google_books_api_key)


def _google_books_enabled_for_user(
    *,
    auth: AuthContext,
    session: Session,
    settings: Settings,
) -> bool:
    if not settings.book_provider_google_enabled:
        return False
    if not settings.google_books_api_key:
        return False
    profile = get_or_create_profile(session, user_id=auth.user_id)
    return bool(profile.enable_google_books)


@router.get("/api/v1/works/{work_id}")
async def get_work(
    work_id: uuid.UUID,
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
) -> dict[str, object]:
    try:
        await refresh_work_if_stale(session, work_id=work_id, open_library=open_library)
        detail = get_work_detail(session, work_id=work_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError:
        # Best-effort refresh; continue with existing local data.
        detail = get_work_detail(session, work_id=work_id)
    return ok(detail)


@router.get("/api/v1/works/{work_id}/editions")
def list_editions(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict[str, object]:
    try:
        items = list_work_editions(session, work_id=work_id, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": items})


@router.get("/api/v1/works/{work_id}/covers")
async def list_work_covers(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        items = await list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=open_library
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc

    if _google_books_enabled_for_user(auth=auth, session=session, settings=settings):
        try:
            items.extend(
                await list_googlebooks_cover_candidates(
                    session,
                    work_id=work_id,
                    google_books=google_books,
                )
            )
        except httpx.HTTPError:
            # Open Library remains the baseline provider. Ignore Google failures.
            pass
    return ok({"items": items})


@router.get("/api/v1/works/{work_id}/related")
async def related_works(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    limit: Annotated[int, Query(ge=1, le=24)] = 12,
) -> dict[str, object]:
    try:
        items = await list_related_works(
            session,
            work_id=work_id,
            open_library=open_library,
            limit=limit,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    return ok({"items": items})


class SelectCoverRequest(BaseModel):
    cover_id: int | None = Field(default=None, ge=1)
    source_url: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _validate_one_selector(self) -> SelectCoverRequest:
        has_cover_id = self.cover_id is not None
        has_source_url = bool(self.source_url and self.source_url.strip())
        if has_cover_id == has_source_url:
            raise ValueError("Provide exactly one of cover_id or source_url.")
        return self


class ApplyEnrichmentRequest(BaseModel):
    edition_id: uuid.UUID | None = None
    selections: list[dict[str, object]] = Field(default_factory=list)


@router.post("/api/v1/works/{work_id}/covers/select")
async def select_cover(
    work_id: uuid.UUID,
    payload: SelectCoverRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        if payload.cover_id is not None:
            result = await select_openlibrary_cover(
                session,
                settings=settings,
                user_id=auth.user_id,
                work_id=work_id,
                cover_id=payload.cover_id,
            )
        else:
            result = await select_cover_from_url(
                session,
                settings=settings,
                user_id=auth.user_id,
                work_id=work_id,
                source_url=(payload.source_url or "").strip(),
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "cover_cache_failed",
                "message": "Unable to cache cover image right now. Please try again shortly.",
            },
        ) from exc
    except StorageNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "cover_upload_unavailable",
                "message": "Cover uploads are temporarily unavailable. Please try again later.",
            },
        ) from exc

    return ok(result)


@router.get("/api/v1/works/{work_id}/enrichment/candidates")
async def list_enrichment_candidates(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await get_enrichment_candidates(
            session,
            user_id=auth.user_id,
            work_id=work_id,
            open_library=open_library,
            google_books=google_books,
            # Enrichment should always attempt Google as a best-effort fallback
            # when Open Library data is sparse.
            google_enabled=True,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ok(result)


@router.post("/api/v1/works/{work_id}/enrichment/apply")
async def apply_enrichment(
    work_id: uuid.UUID,
    payload: ApplyEnrichmentRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await apply_enrichment_selections(
            session,
            user_id=auth.user_id,
            work_id=work_id,
            selections=payload.selections,
            edition_id=payload.edition_id,
            open_library=open_library,
            google_books=google_books,
            google_enabled=True,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ok(result)
