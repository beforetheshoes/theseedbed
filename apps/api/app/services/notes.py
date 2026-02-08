from __future__ import annotations

import base64
import datetime as dt
import json
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.content import Note
from app.db.models.users import LibraryItem

NOTE_VISIBILITIES = {"private", "unlisted", "public"}


def _ensure_library_item_owned(
    session: Session, *, user_id: uuid.UUID, library_item_id: uuid.UUID
) -> None:
    exists = session.scalar(
        sa.select(LibraryItem.id).where(
            LibraryItem.id == library_item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if exists is None:
        raise LookupError("library item not found")


def _encode_cursor(created_at: dt.datetime, note_id: uuid.UUID) -> str:
    payload = {"created_at": created_at.isoformat(), "id": str(note_id)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[dt.datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        payload = json.loads(raw)
        return dt.datetime.fromisoformat(payload["created_at"]), uuid.UUID(
            payload["id"]
        )
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise ValueError("invalid cursor") from exc


def list_notes(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    limit: int,
    cursor: str | None,
) -> dict[str, Any]:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )

    stmt = (
        sa.select(Note)
        .where(
            Note.user_id == user_id,
            Note.library_item_id == library_item_id,
        )
        .order_by(Note.created_at.desc(), Note.id.desc())
    )

    if cursor:
        cursor_created, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            sa.or_(
                Note.created_at < cursor_created,
                sa.and_(Note.created_at == cursor_created, Note.id < cursor_id),
            )
        )

    rows = session.execute(stmt.limit(limit + 1)).scalars().all()
    has_next = len(rows) > limit
    selected = rows[:limit]

    items = [
        {
            "id": str(note.id),
            "library_item_id": str(note.library_item_id),
            "title": note.title,
            "body": note.body,
            "visibility": note.visibility,
            "created_at": note.created_at.isoformat(),
            "updated_at": note.updated_at.isoformat(),
        }
        for note in selected
    ]

    next_cursor = None
    if has_next and selected:
        last = selected[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    return {"items": items, "next_cursor": next_cursor}


def create_note(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    title: str | None,
    body: str,
    visibility: str,
) -> Note:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    normalized_visibility = visibility.strip().lower()
    if normalized_visibility not in NOTE_VISIBILITIES:
        raise ValueError("invalid visibility")

    model = Note(
        user_id=user_id,
        library_item_id=library_item_id,
        title=title.strip() if title else None,
        body=body,
        visibility=normalized_visibility,
        created_at=dt.datetime.now(tz=dt.UTC),
        updated_at=dt.datetime.now(tz=dt.UTC),
    )
    session.add(model)
    session.commit()
    return model


def update_note(
    session: Session,
    *,
    user_id: uuid.UUID,
    note_id: uuid.UUID,
    title: str | None,
    body: str | None,
    visibility: str | None,
) -> Note:
    model = session.scalar(
        sa.select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    if model is None:
        raise LookupError("note not found")

    if title is not None:
        model.title = title.strip() or None
    if body is not None:
        model.body = body
    if visibility is not None:
        normalized_visibility = visibility.strip().lower()
        if normalized_visibility not in NOTE_VISIBILITIES:
            raise ValueError("invalid visibility")
        model.visibility = normalized_visibility

    model.updated_at = dt.datetime.now(tz=dt.UTC)
    session.commit()
    return model


def delete_note(session: Session, *, user_id: uuid.UUID, note_id: uuid.UUID) -> None:
    model = session.scalar(
        sa.select(Note).where(Note.id == note_id, Note.user_id == user_id)
    )
    if model is None:
        raise LookupError("note not found")
    session.delete(model)
    session.commit()
