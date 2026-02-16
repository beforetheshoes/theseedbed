from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Edition
from app.db.models.users import LibraryItem, ReadingProgressLog, ReadingSession

ProgressUnit = Literal["pages_read", "percent_complete", "minutes_listened"]


@dataclass(frozen=True)
class _ResolvedLog:
    model: ReadingProgressLog
    canonical_percent: float | None
    local_date: dt.date


def _as_aware_utc(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=dt.UTC)
    return value.astimezone(dt.UTC)


def _to_float(value: Decimal | float | int | None) -> float | None:
    if value is None:
        return None
    return float(value)


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


def _canonical_from_log(
    log: ReadingProgressLog,
    *,
    total_pages: int | None,
    total_audio_minutes: int | None,
) -> float | None:
    stored = _to_float(log.canonical_percent)
    if stored is not None:
        return min(100.0, max(0.0, stored))

    value = float(log.value)
    if log.unit == "percent_complete":
        return min(100.0, max(0.0, value))
    if log.unit == "pages_read":
        if not total_pages or total_pages <= 0:
            return None
        return min(100.0, max(0.0, (value / total_pages) * 100.0))
    if log.unit == "minutes_listened":
        if not total_audio_minutes or total_audio_minutes <= 0:
            return None
        return min(100.0, max(0.0, (value / total_audio_minutes) * 100.0))
    return None


def _from_canonical(
    *,
    unit: ProgressUnit,
    canonical_percent: float,
    total_pages: int | None,
    total_audio_minutes: int | None,
    clamp: bool = True,
) -> float | None:
    canonical = min(100.0, max(0.0, canonical_percent)) if clamp else canonical_percent
    if unit == "percent_complete":
        return canonical
    if unit == "pages_read":
        if not total_pages or total_pages <= 0:
            return None
        return (canonical / 100.0) * float(total_pages)
    if unit == "minutes_listened":
        if not total_audio_minutes or total_audio_minutes <= 0:
            return None
        return (canonical / 100.0) * float(total_audio_minutes)
    return None


def _round_number(value: float | None) -> float | None:
    if value is None:
        return None
    return round(value, 3)


def _to_local_date(value: dt.datetime, *, zone: ZoneInfo) -> dt.date:
    return _as_aware_utc(value).astimezone(zone).date()


def _is_import_cycle(cycle: ReadingSession) -> bool:
    note = (cycle.note or "").lower()
    return note.startswith("goodreads:") or note.startswith("storygraph:")


def get_library_item_statistics(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    tz: str = "UTC",
    days: int = 90,
) -> dict[str, Any]:
    if days < 7 or days > 365:
        raise ValueError("days must be between 7 and 365")
    try:
        zone = ZoneInfo(tz)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("invalid timezone") from exc

    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.id == library_item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if item is None:
        raise LookupError("library item not found")

    total_pages, total_audio_minutes = _get_item_totals(
        session, library_item_id=library_item_id
    )

    cycles = list(
        session.execute(
            sa.select(ReadingSession)
            .where(
                ReadingSession.user_id == user_id,
                ReadingSession.library_item_id == library_item_id,
            )
            .order_by(ReadingSession.started_at.asc(), ReadingSession.id.asc())
        ).scalars()
    )
    logs = list(
        session.execute(
            sa.select(ReadingProgressLog)
            .where(
                ReadingProgressLog.user_id == user_id,
                ReadingProgressLog.library_item_id == library_item_id,
            )
            .order_by(ReadingProgressLog.logged_at.asc(), ReadingProgressLog.id.asc())
        ).scalars()
    )

    resolved_logs: list[_ResolvedLog] = []
    unresolved_log_ids: list[str] = []
    for log in logs:
        canonical = _canonical_from_log(
            log,
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
        if canonical is None:
            unresolved_log_ids.append(str(log.id))
        resolved_logs.append(
            _ResolvedLog(
                model=log,
                canonical_percent=canonical,
                local_date=_to_local_date(log.logged_at, zone=zone),
            )
        )

    total_cycles = len(cycles)
    completed_cycles = sum(1 for cycle in cycles if cycle.ended_at is not None)
    imported_cycles = sum(1 for cycle in cycles if _is_import_cycle(cycle))
    completed_reads = completed_cycles
    if completed_reads == 0 and item.status == "completed":
        completed_reads = 1

    latest_resolved = next(
        (row for row in reversed(resolved_logs) if row.canonical_percent is not None),
        None,
    )
    current_canonical = (
        latest_resolved.canonical_percent
        if latest_resolved is not None and latest_resolved.canonical_percent is not None
        else 0.0
    )
    latest_logged_at = logs[-1].logged_at.isoformat() if logs else None

    today = dt.datetime.now(dt.UTC).astimezone(zone).date()
    start_date = today - dt.timedelta(days=days - 1)

    latest_by_day: dict[dt.date, float] = {}
    for row in resolved_logs:
        if row.canonical_percent is None:
            continue
        if row.local_date < start_date or row.local_date > today:
            continue
        latest_by_day[row.local_date] = row.canonical_percent

    ordered_progress_points: list[tuple[dt.date, float]] = sorted(
        latest_by_day.items(), key=lambda entry: entry[0]
    )
    progress_points = [
        {
            "date": day.isoformat(),
            "canonical_percent": _round_number(canonical) or 0.0,
            "pages_read": _round_number(
                _from_canonical(
                    unit="pages_read",
                    canonical_percent=canonical,
                    total_pages=total_pages,
                    total_audio_minutes=total_audio_minutes,
                )
            ),
            "minutes_listened": _round_number(
                _from_canonical(
                    unit="minutes_listened",
                    canonical_percent=canonical,
                    total_pages=total_pages,
                    total_audio_minutes=total_audio_minutes,
                )
            ),
        }
        for day, canonical in ordered_progress_points
    ]

    daily_delta_points: list[dict[str, Any]] = []
    previous_canonical = 0.0
    for _day, current in ordered_progress_points:
        canonical_delta = current - previous_canonical
        daily_delta_points.append(
            {
                "date": _day.isoformat(),
                "canonical_percent_delta": _round_number(canonical_delta) or 0.0,
                "pages_read_delta": _round_number(
                    _from_canonical(
                        unit="pages_read",
                        canonical_percent=canonical_delta,
                        total_pages=total_pages,
                        total_audio_minutes=total_audio_minutes,
                        clamp=False,
                    )
                ),
                "minutes_listened_delta": _round_number(
                    _from_canonical(
                        unit="minutes_listened",
                        canonical_percent=canonical_delta,
                        total_pages=total_pages,
                        total_audio_minutes=total_audio_minutes,
                        clamp=False,
                    )
                ),
            }
        )
        previous_canonical = current

    non_zero_days = sorted(
        {
            row.local_date
            for row in resolved_logs
            if row.canonical_percent is not None and row.canonical_percent > 0
        },
        reverse=True,
    )
    streak = 0
    if non_zero_days:
        streak = 1
        previous_day = non_zero_days[0]
        for candidate in non_zero_days[1:]:
            if previous_day - candidate == dt.timedelta(days=1):
                streak += 1
                previous_day = candidate
            else:
                break

    timeline_rows: list[dict[str, Any]] = []
    previous_canonical_for_timeline = 0.0
    for row in resolved_logs:
        current_for_timeline = (
            row.canonical_percent if row.canonical_percent is not None else 0.0
        )
        start_value = _from_canonical(
            unit=row.model.unit,  # type: ignore[arg-type]
            canonical_percent=previous_canonical_for_timeline,
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
        end_value = _from_canonical(
            unit=row.model.unit,  # type: ignore[arg-type]
            canonical_percent=current_for_timeline,
            total_pages=total_pages,
            total_audio_minutes=total_audio_minutes,
        )
        start_safe = start_value or 0.0
        end_safe = end_value or 0.0
        timeline_rows.append(
            {
                "log_id": str(row.model.id),
                "logged_at": row.model.logged_at.isoformat(),
                "date": row.local_date.isoformat(),
                "unit": row.model.unit,
                "value": _round_number(float(row.model.value)) or 0.0,
                "note": row.model.note,
                "start_value": _round_number(start_safe) or 0.0,
                "end_value": _round_number(end_safe) or 0.0,
                "session_delta": _round_number(end_safe - start_safe) or 0.0,
            }
        )
        previous_canonical_for_timeline = current_for_timeline

    return {
        "library_item_id": str(library_item_id),
        "window": {
            "days": days,
            "tz": tz,
            "start_date": start_date.isoformat(),
            "end_date": today.isoformat(),
        },
        "totals": {
            "total_pages": total_pages,
            "total_audio_minutes": total_audio_minutes,
        },
        "counts": {
            "total_cycles": total_cycles,
            "completed_cycles": completed_cycles,
            "imported_cycles": imported_cycles,
            "completed_reads": completed_reads,
            "total_logs": len(logs),
            "logs_with_canonical": len(logs) - len(unresolved_log_ids),
            "logs_missing_canonical": len(unresolved_log_ids),
        },
        "current": {
            "latest_logged_at": latest_logged_at,
            "canonical_percent": _round_number(current_canonical) or 0.0,
            "pages_read": _round_number(
                _from_canonical(
                    unit="pages_read",
                    canonical_percent=current_canonical,
                    total_pages=total_pages,
                    total_audio_minutes=total_audio_minutes,
                )
            ),
            "minutes_listened": _round_number(
                _from_canonical(
                    unit="minutes_listened",
                    canonical_percent=current_canonical,
                    total_pages=total_pages,
                    total_audio_minutes=total_audio_minutes,
                )
            ),
        },
        "streak": {
            "non_zero_days": streak,
            "last_non_zero_date": (
                non_zero_days[0].isoformat() if non_zero_days else None
            ),
        },
        "series": {
            "progress_over_time": progress_points,
            "daily_delta": daily_delta_points,
        },
        "timeline": list(reversed(timeline_rows)),
        "data_quality": {
            "has_missing_totals": total_pages is None or total_audio_minutes is None,
            "unresolved_logs_exist": bool(unresolved_log_ids),
            "unresolved_log_ids": unresolved_log_ids,
        },
    }
