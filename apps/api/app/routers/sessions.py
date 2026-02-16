from __future__ import annotations

import datetime as dt
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.reading_sessions import (
    create_progress_log,
    create_read_cycle,
    delete_progress_log,
    delete_read_cycle,
    list_progress_logs,
    list_read_cycles,
    update_progress_log,
    update_read_cycle,
)

ProgressUnit = Literal["pages_read", "percent_complete", "minutes_listened"]


class CreateReadCycleRequest(BaseModel):
    started_at: dt.datetime
    ended_at: dt.datetime | None = None
    title: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=5000)


class UpdateReadCycleRequest(BaseModel):
    started_at: dt.datetime | None = None
    ended_at: dt.datetime | None = None
    title: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=5000)


class CreateProgressLogRequest(BaseModel):
    unit: ProgressUnit
    value: float = Field(ge=0.0)
    logged_at: dt.datetime | None = None
    note: str | None = Field(default=None, max_length=5000)


class UpdateProgressLogRequest(BaseModel):
    unit: ProgressUnit | None = None
    value: float | None = Field(default=None, ge=0.0)
    logged_at: dt.datetime | None = None
    note: str | None = Field(default=None, max_length=5000)


router = APIRouter(
    tags=["sessions"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/api/v1/library/items/{library_item_id}/read-cycles")
def list_cycles(
    library_item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict[str, object]:
    try:
        rows = list_read_cycles(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            limit=limit,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": rows})


@router.post("/api/v1/library/items/{library_item_id}/read-cycles")
def create_cycle(
    library_item_id: uuid.UUID,
    payload: CreateReadCycleRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = create_read_cycle(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            title=payload.title,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.patch("/api/v1/read-cycles/{cycle_id}")
def patch_cycle(
    cycle_id: uuid.UUID,
    payload: UpdateReadCycleRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = update_read_cycle(
            session,
            user_id=auth.user_id,
            cycle_id=cycle_id,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            title=payload.title,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.delete("/api/v1/read-cycles/{cycle_id}")
def remove_cycle(
    cycle_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_read_cycle(session, user_id=auth.user_id, cycle_id=cycle_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})


@router.get("/api/v1/read-cycles/{cycle_id}/progress-logs")
def list_logs(
    cycle_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> dict[str, object]:
    try:
        rows = list_progress_logs(
            session,
            user_id=auth.user_id,
            cycle_id=cycle_id,
            limit=limit,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": rows})


@router.post("/api/v1/read-cycles/{cycle_id}/progress-logs")
def create_log(
    cycle_id: uuid.UUID,
    payload: CreateProgressLogRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = create_progress_log(
            session,
            user_id=auth.user_id,
            cycle_id=cycle_id,
            unit=payload.unit,
            value=payload.value,
            logged_at=payload.logged_at,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.patch("/api/v1/progress-logs/{log_id}")
def patch_log(
    log_id: uuid.UUID,
    payload: UpdateProgressLogRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        model = update_progress_log(
            session,
            user_id=auth.user_id,
            log_id=log_id,
            unit=payload.unit,
            value=payload.value,
            logged_at=payload.logged_at,
            note=payload.note,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(model.id)})


@router.delete("/api/v1/progress-logs/{log_id}")
def remove_log(
    log_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_progress_log(session, user_id=auth.user_id, log_id=log_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})
