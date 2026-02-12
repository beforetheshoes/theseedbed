from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.reading_sessions import (
    create_reading_session,
    delete_reading_session,
    list_reading_sessions,
    update_reading_session,
)


class CreateReadingSessionRequest(BaseModel):
    started_at: dt.datetime
    ended_at: dt.datetime | None = None
    pages_read: int | None = Field(default=None, ge=0)
    progress_percent: float | None = Field(default=None, ge=0.0, le=100.0)
    note: str | None = Field(default=None, max_length=5000)


class UpdateReadingSessionRequest(BaseModel):
    started_at: dt.datetime | None = None
    ended_at: dt.datetime | None = None
    pages_read: int | None = Field(default=None, ge=0)
    progress_percent: float | None = Field(default=None, ge=0.0, le=100.0)
    note: str | None = Field(default=None, max_length=5000)


router = APIRouter(
    tags=["sessions"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/api/v1/library/items/{library_item_id}/sessions")
def list_sessions(
    library_item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict[str, object]:
    try:
        rows = list_reading_sessions(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            limit=limit,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": rows})


@router.post("/api/v1/library/items/{library_item_id}/sessions")
def create_session(
    library_item_id: uuid.UUID,
    payload: CreateReadingSessionRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = create_reading_session(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            pages_read=payload.pages_read,
            progress_percent=payload.progress_percent,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.patch("/api/v1/sessions/{session_id}")
def patch_session(
    session_id: uuid.UUID,
    payload: UpdateReadingSessionRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = update_reading_session(
            session,
            user_id=auth.user_id,
            session_id=session_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            pages_read=payload.pages_read,
            progress_percent=payload.progress_percent,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.delete("/api/v1/sessions/{session_id}")
def delete_session(
    session_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_reading_session(session, user_id=auth.user_id, session_id=session_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})
