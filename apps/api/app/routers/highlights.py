from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.highlights import (
    create_highlight,
    delete_highlight,
    list_highlights,
    update_highlight,
)

HighlightVisibility = Literal["private", "unlisted", "public"]


class HighlightLocation(BaseModel):
    type: Literal["page", "percent", "location", "cfi"]
    value: float | int | str


class CreateHighlightRequest(BaseModel):
    quote: str = Field(min_length=1)
    visibility: HighlightVisibility = "private"
    location: HighlightLocation | None = None
    location_sort: float | None = None


class UpdateHighlightRequest(BaseModel):
    quote: str | None = None
    visibility: HighlightVisibility | None = None
    location: HighlightLocation | None = None
    location_sort: float | None = None


router = APIRouter(
    tags=["highlights"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


def _location_payload(
    loc: HighlightLocation | None,
) -> tuple[dict[str, object] | None, str | None]:
    if loc is None:
        return None, None
    return {"type": loc.type, "value": loc.value}, loc.type


@router.get("/api/v1/library/items/{library_item_id}/highlights")
def list_item_highlights(
    library_item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: Annotated[int, Query(ge=1, le=200)] = 100,
) -> dict[str, object]:
    try:
        rows = list_highlights(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            limit=limit,
            max_public_chars=settings.public_highlight_max_chars,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": rows})


@router.post("/api/v1/library/items/{library_item_id}/highlights")
def create_item_highlight(
    library_item_id: uuid.UUID,
    payload: CreateHighlightRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    location, location_type = _location_payload(payload.location)
    try:
        highlight = create_highlight(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            quote=payload.quote,
            visibility=payload.visibility,
            location=location,
            location_type=location_type,
            location_sort=payload.location_sort,
            max_public_chars=settings.public_highlight_max_chars,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(highlight.id)})


@router.patch("/api/v1/highlights/{highlight_id}")
def patch_highlight(
    highlight_id: uuid.UUID,
    payload: UpdateHighlightRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    location, location_type = _location_payload(payload.location)
    try:
        highlight = update_highlight(
            session,
            user_id=auth.user_id,
            highlight_id=highlight_id,
            quote=payload.quote,
            visibility=payload.visibility,
            location=location,
            location_type=location_type,
            location_sort=payload.location_sort,
            max_public_chars=settings.public_highlight_max_chars,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(highlight.id)})


@router.delete("/api/v1/highlights/{highlight_id}")
def delete_item_highlight(
    highlight_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_highlight(session, user_id=auth.user_id, highlight_id=highlight_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})
