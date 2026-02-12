from __future__ import annotations

import json
import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.catalog import import_openlibrary_bundle
from app.services.covers import cache_edition_cover_from_url
from app.services.manual_books import create_manual_book
from app.services.open_library import OpenLibraryClient
from app.services.storage import StorageNotConfiguredError


class ImportBookRequest(BaseModel):
    work_key: str = Field(min_length=3)
    edition_key: str | None = None


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


router = APIRouter(
    prefix="/api/v1/books",
    tags=["books"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/search")
async def search_books(
    query: Annotated[str, Query(min_length=1)],
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    limit: Annotated[int, Query(ge=1, le=50)] = 10,
    page: Annotated[int, Query(ge=1)] = 1,
) -> dict[str, object]:
    try:
        response = await open_library.search_books(query=query, limit=limit, page=page)
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    return ok(
        {
            "items": [
                {
                    "work_key": item.work_key,
                    "title": item.title,
                    "author_names": item.author_names,
                    "first_publish_year": item.first_publish_year,
                    "cover_url": item.cover_url,
                }
                for item in response.items
            ],
            "cache_hit": response.cache_hit,
        }
    )


@router.post("/import")
async def import_book(
    payload: ImportBookRequest,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        bundle = await open_library.fetch_work_bundle(
            work_key=payload.work_key,
            edition_key=payload.edition_key,
        )
        result = import_openlibrary_bundle(session, bundle=bundle)

        # Best-effort cover caching; do not block imports.
        edition = result.get("edition")
        if isinstance(edition, dict):
            edition_id = edition.get("id")
            if isinstance(edition_id, str) and bundle.cover_url:
                try:
                    cached = await cache_edition_cover_from_url(
                        session,
                        settings=settings,
                        edition_id=uuid.UUID(edition_id),
                        source_url=bundle.cover_url,
                    )
                    if cached.cover_url:
                        edition["cover_url"] = cached.cover_url
                except Exception:
                    pass
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
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ok(result)


@router.post("/manual")
async def create_manual(
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    title: Annotated[str, Form(min_length=1, max_length=512)],
    authors_json: Annotated[str, Form(min_length=2)],
    isbn: Annotated[str | None, Form()] = None,
    cover: Annotated[UploadFile | None, File()] = None,
) -> dict[str, object]:
    try:
        raw_authors = json.loads(authors_json)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="authors_json must be valid JSON"
        ) from exc

    if not isinstance(raw_authors, list) or not all(
        isinstance(a, str) and a.strip() for a in raw_authors
    ):
        raise HTTPException(
            status_code=400,
            detail="authors_json must be a JSON list of non-empty strings",
        )

    cover_bytes: bytes | None = None
    cover_content_type: str | None = None
    if cover is not None:
        cover_bytes = await cover.read()
        cover_content_type = cover.content_type or "application/octet-stream"

    try:
        result = await create_manual_book(
            session,
            settings=settings,
            title=title,
            authors=[a.strip() for a in raw_authors],
            isbn=isbn,
            cover_bytes=cover_bytes,
            cover_content_type=cover_content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except StorageNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "cover_upload_unavailable",
                "message": "Cover uploads are temporarily unavailable. Please try again later.",
            },
        ) from exc

    return ok(result)
