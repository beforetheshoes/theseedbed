from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.notes import create_note, delete_note, list_notes, update_note

NoteVisibility = Literal["private", "unlisted", "public"]


class CreateNoteRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: str = Field(min_length=1)
    visibility: NoteVisibility = "private"


class UpdateNoteRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)
    body: str | None = None
    visibility: NoteVisibility | None = None


router = APIRouter(
    tags=["notes"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


@router.get("/api/v1/library/items/{library_item_id}/notes")
def list_item_notes(
    library_item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    cursor: str | None = None,
) -> dict[str, object]:
    try:
        result = list_notes(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            limit=limit,
            cursor=cursor,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok(result)


@router.post("/api/v1/library/items/{library_item_id}/notes")
def create_item_note(
    library_item_id: uuid.UUID,
    payload: CreateNoteRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        note = create_note(
            session,
            user_id=auth.user_id,
            library_item_id=library_item_id,
            title=payload.title,
            body=payload.body,
            visibility=payload.visibility,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(note.id)})


@router.patch("/api/v1/notes/{note_id}")
def patch_note(
    note_id: uuid.UUID,
    payload: UpdateNoteRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        note = update_note(
            session,
            user_id=auth.user_id,
            note_id=note_id,
            title=payload.title,
            body=payload.body,
            visibility=payload.visibility,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok({"id": str(note.id)})


@router.delete("/api/v1/notes/{note_id}")
def delete_item_note(
    note_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_note(session, user_id=auth.user_id, note_id=note_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"deleted": True})
