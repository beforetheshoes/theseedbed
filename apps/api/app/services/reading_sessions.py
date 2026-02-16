from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any, Literal

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Edition
from app.db.models.users import LibraryItem, ReadingProgressLog, ReadingSession

ProgressUnit = Literal["pages_read", "percent_complete", "minutes_listened"]


def _ensure_library_item_owned(
    session: Session, *, user_id: uuid.UUID, library_item_id: uuid.UUID
) -> LibraryItem:
    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.id == library_item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if item is None:
        raise LookupError("library item not found")
    return item


def _get_cycle(
    session: Session, *, user_id: uuid.UUID, cycle_id: uuid.UUID
) -> ReadingSession:
    cycle = session.scalar(
        sa.select(ReadingSession).where(
            ReadingSession.id == cycle_id,
            ReadingSession.user_id == user_id,
        )
    )
    if cycle is None:
        raise LookupError("read cycle not found")
    return cycle


def _get_item_totals(
    session: Session, *, library_item_id: uuid.UUID
) -> tuple[int | None, int | None]:
    preferred = session.execute(
        sa.select(Edition.total_pages, Edition.total_audio_minutes)
        .join(LibraryItem, LibraryItem.preferred_edition_id == Edition.id)
        .where(LibraryItem.id == library_item_id)
        .limit(1)
    ).first()
    if preferred is not None:
        return preferred[0], preferred[1]

    fallback = session.execute(
        sa.select(Edition.total_pages, Edition.total_audio_minutes)
        .join(LibraryItem, LibraryItem.work_id == Edition.work_id)
        .where(LibraryItem.id == library_item_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(1)
    ).first()
    if fallback is not None:
        return fallback[0], fallback[1]

    return None, None


def _conversion_metadata(
    *, total_pages: int | None, total_audio_minutes: int | None
) -> dict[str, Any]:
    return {
        "total_pages": total_pages,
        "total_audio_minutes": total_audio_minutes,
        "can_convert_pages_percent": total_pages is not None,
        "can_convert_minutes_percent": total_audio_minutes is not None,
        "can_convert_pages_minutes": (
            total_pages is not None and total_audio_minutes is not None
        ),
    }


def _to_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _canonical_percent(
    *,
    unit: ProgressUnit,
    value: float,
    total_pages: int | None,
    total_audio_minutes: int | None,
) -> float | None:
    if unit == "percent_complete":
        if value < 0 or value > 100:
            raise ValueError("percent_complete must be between 0 and 100")
        return value
    if unit == "pages_read":
        if total_pages is None:
            return None
        if total_pages <= 0:
            return None
        return min(100.0, max(0.0, (value / total_pages) * 100.0))
    if unit == "minutes_listened":
        if total_audio_minutes is None:
            return None
        if total_audio_minutes <= 0:
            return None
        return min(100.0, max(0.0, (value / total_audio_minutes) * 100.0))
    raise ValueError("unsupported progress unit")


def _serialize_cycle(
    cycle: ReadingSession, *, total_pages: int | None, total_audio_minutes: int | None
) -> dict[str, Any]:
    return {
        "id": str(cycle.id),
        "library_item_id": str(cycle.library_item_id),
        "started_at": cycle.started_at.isoformat(),
        "ended_at": cycle.ended_at.isoformat() if cycle.ended_at else None,
        "title": cycle.title,
        "note": cycle.note,
        "conversion": _conversion_metadata(
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        ),
    }


def _serialize_log(
    log: ReadingProgressLog, *, total_pages: int | None, total_audio_minutes: int | None
) -> dict[str, Any]:
    return {
        "id": str(log.id),
        "library_item_id": str(log.library_item_id),
        "reading_session_id": str(log.reading_session_id),
        "logged_at": log.logged_at.isoformat(),
        "unit": log.unit,
        "value": _to_float(log.value),
        "canonical_percent": _to_float(log.canonical_percent),
        "note": log.note,
        "conversion": _conversion_metadata(
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        ),
    }


def list_read_cycles(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    limit: int = 100,
) -> list[dict[str, Any]]:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    total_pages, total_audio_minutes = _get_item_totals(
        session, library_item_id=library_item_id
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
        _serialize_cycle(
            row,
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
        for row in rows
    ]


def create_read_cycle(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    started_at: dt.datetime,
    ended_at: dt.datetime | None,
    title: str | None,
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
        title=title,
        note=note,
    )
    session.add(model)
    session.commit()
    return model


def update_read_cycle(
    session: Session,
    *,
    user_id: uuid.UUID,
    cycle_id: uuid.UUID,
    started_at: dt.datetime | None,
    ended_at: dt.datetime | None,
    title: str | None,
    note: str | None,
) -> ReadingSession:
    model = _get_cycle(session, user_id=user_id, cycle_id=cycle_id)
    if started_at is not None:
        model.started_at = started_at
    if ended_at is not None:
        model.ended_at = ended_at
    if title is not None:
        model.title = title
    if note is not None:
        model.note = note
    session.commit()
    return model


def delete_read_cycle(
    session: Session, *, user_id: uuid.UUID, cycle_id: uuid.UUID
) -> None:
    model = _get_cycle(session, user_id=user_id, cycle_id=cycle_id)
    session.delete(model)
    session.commit()


def list_progress_logs(
    session: Session,
    *,
    user_id: uuid.UUID,
    cycle_id: uuid.UUID,
    limit: int = 200,
) -> list[dict[str, Any]]:
    cycle = _get_cycle(session, user_id=user_id, cycle_id=cycle_id)
    total_pages, total_audio_minutes = _get_item_totals(
        session, library_item_id=cycle.library_item_id
    )
    rows = session.execute(
        sa.select(ReadingProgressLog)
        .where(
            ReadingProgressLog.user_id == user_id,
            ReadingProgressLog.reading_session_id == cycle_id,
        )
        .order_by(ReadingProgressLog.logged_at.desc(), ReadingProgressLog.id.desc())
        .limit(limit)
    ).scalars()
    return [
        _serialize_log(
            row,
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
        for row in rows
    ]


def create_progress_log(
    session: Session,
    *,
    user_id: uuid.UUID,
    cycle_id: uuid.UUID,
    unit: ProgressUnit,
    value: float,
    logged_at: dt.datetime | None,
    note: str | None,
) -> ReadingProgressLog:
    cycle = _get_cycle(session, user_id=user_id, cycle_id=cycle_id)
    total_pages, total_audio_minutes = _get_item_totals(
        session, library_item_id=cycle.library_item_id
    )
    canonical_percent = _canonical_percent(
        unit=unit,
        value=value,
        total_pages=total_pages,
        total_audio_minutes=total_audio_minutes,
    )
    model = ReadingProgressLog(
        user_id=user_id,
        library_item_id=cycle.library_item_id,
        reading_session_id=cycle.id,
        logged_at=logged_at or dt.datetime.now(tz=dt.UTC),
        unit=unit,
        value=value,
        canonical_percent=canonical_percent,
        note=note,
    )
    session.add(model)
    session.commit()
    return model


def update_progress_log(
    session: Session,
    *,
    user_id: uuid.UUID,
    log_id: uuid.UUID,
    unit: ProgressUnit | None,
    value: float | None,
    logged_at: dt.datetime | None,
    note: str | None,
) -> ReadingProgressLog:
    model = session.scalar(
        sa.select(ReadingProgressLog).where(
            ReadingProgressLog.id == log_id,
            ReadingProgressLog.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("progress log not found")

    if logged_at is not None:
        model.logged_at = logged_at
    if note is not None:
        model.note = note

    if unit is not None:
        model.unit = unit
    if value is not None:
        model.value = value

    if unit is not None or value is not None:
        total_pages, total_audio_minutes = _get_item_totals(
            session, library_item_id=model.library_item_id
        )
        model.canonical_percent = _canonical_percent(
            unit=model.unit,  # type: ignore[arg-type]
            value=float(model.value),
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
    session.commit()
    return model


def delete_progress_log(
    session: Session, *, user_id: uuid.UUID, log_id: uuid.UUID
) -> None:
    model = session.scalar(
        sa.select(ReadingProgressLog).where(
            ReadingProgressLog.id == log_id,
            ReadingProgressLog.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("progress log not found")
    session.delete(model)
    session.commit()


def get_or_create_import_cycle(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    marker: str,
    started_at: dt.datetime,
    ended_at: dt.datetime | None,
) -> ReadingSession:
    existing = session.scalar(
        sa.select(ReadingSession).where(
            ReadingSession.user_id == user_id,
            ReadingSession.library_item_id == library_item_id,
            ReadingSession.note == marker,
        )
    )
    if existing is not None:
        return existing

    model = ReadingSession(
        user_id=user_id,
        library_item_id=library_item_id,
        started_at=started_at,
        ended_at=ended_at,
        note=marker,
    )
    session.add(model)
    session.flush()
    return model
