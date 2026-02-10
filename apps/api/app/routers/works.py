from __future__ import annotations

import uuid
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.open_library import OpenLibraryClient
from app.services.storage import StorageNotConfiguredError
from app.services.work_covers import (
    list_openlibrary_cover_candidates,
    select_openlibrary_cover,
)
from app.services.works import get_work_detail, list_work_editions

router = APIRouter(tags=["works"])


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


@router.get("/api/v1/works/{work_id}")
def get_work(
    work_id: uuid.UUID,
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        detail = get_work_detail(session, work_id=work_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
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
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
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
    return ok({"items": items})


class SelectCoverRequest(BaseModel):
    cover_id: int = Field(ge=1)


@router.post("/api/v1/works/{work_id}/covers/select")
async def select_cover(
    work_id: uuid.UUID,
    payload: SelectCoverRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await select_openlibrary_cover(
            session,
            settings=settings,
            user_id=auth.user_id,
            work_id=work_id,
            cover_id=payload.cover_id,
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
