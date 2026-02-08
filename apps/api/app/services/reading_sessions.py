from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.users import LibraryItem, ReadingSession


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


def list_reading_sessions(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    limit: int = 100,
) -> list[dict[str, Any]]:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    rows = session.execute(
        sa.select(ReadingSession)
        .where(
            ReadingSession.user_id == user_id,
            ReadingSession.library_item_id == library_item_id,
        )
        .order_by(ReadingSession.started_at.desc(), ReadingSession.id.desc())
        .limit(limit)
    ).scalars()
    return [
        {
            "id": str(row.id),
            "library_item_id": str(row.library_item_id),
            "started_at": row.started_at.isoformat(),
            "ended_at": row.ended_at.isoformat() if row.ended_at else None,
            "pages_read": row.pages_read,
            "progress_percent": (
                float(row.progress_percent)
                if row.progress_percent is not None
                else None
            ),
            "note": row.note,
        }
        for row in rows
    ]


def create_reading_session(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    started_at: dt.datetime,
    ended_at: dt.datetime | None,
    pages_read: int | None,
    progress_percent: float | None,
    note: str | None,
) -> ReadingSession:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    model = ReadingSession(
        user_id=user_id,
        library_item_id=library_item_id,
        started_at=started_at,
        ended_at=ended_at,
        pages_read=pages_read,
        progress_percent=progress_percent,
        note=note,
    )
    session.add(model)
    session.commit()
    return model


def update_reading_session(
    session: Session,
    *,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
    started_at: dt.datetime | None,
    ended_at: dt.datetime | None,
    pages_read: int | None,
    progress_percent: float | None,
    note: str | None,
) -> ReadingSession:
    model = session.scalar(
        sa.select(ReadingSession).where(
            ReadingSession.id == session_id,
            ReadingSession.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("session not found")

    if started_at is not None:
        model.started_at = started_at
    if ended_at is not None:
        model.ended_at = ended_at
    if pages_read is not None:
        model.pages_read = pages_read
    if progress_percent is not None:
        model.progress_percent = progress_percent
    if note is not None:
        model.note = note

    session.commit()
    return model


def delete_reading_session(
    session: Session, *, user_id: uuid.UUID, session_id: uuid.UUID
) -> None:
    model = session.scalar(
        sa.select(ReadingSession).where(
            ReadingSession.id == session_id,
            ReadingSession.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("session not found")
    session.delete(model)
    session.commit()
