from __future__ import annotations

import datetime as dt
import uuid
from decimal import Decimal
from typing import Any, cast

import pytest
import sqlalchemy as sa

from app.db.models.users import LibraryItem, ReadingProgressLog, ReadingSession
from app.services.reading_statistics import (
    _as_aware_utc,
    _canonical_from_log,
    _from_canonical,
    _get_item_totals,
    get_library_item_statistics,
)


class _ScalarIter:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return iter(self._rows)


class _ExecResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarIter:
        return _ScalarIter(self._rows)

    def first(self) -> Any:
        if not self._rows:
            return None
        return self._rows[0]


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.execute_values: list[list[Any]] = []

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def execute(self, _stmt: sa.Select[Any]) -> _ExecResult:
        rows = self.execute_values.pop(0)
        return _ExecResult(rows)


def _item(*, item_id: uuid.UUID, user_id: uuid.UUID, status: str) -> LibraryItem:
    now = dt.datetime(2026, 2, 10, tzinfo=dt.UTC)
    return LibraryItem(
        id=item_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        preferred_edition_id=None,
        status=status,
        visibility="private",
        rating=None,
        tags=[],
        created_at=now,
        updated_at=now,
    )


def _cycle(
    *,
    cycle_id: uuid.UUID,
    user_id: uuid.UUID,
    item_id: uuid.UUID,
    started_at: dt.datetime,
    ended_at: dt.datetime | None,
    note: str | None = None,
) -> ReadingSession:
    return ReadingSession(
        id=cycle_id,
        user_id=user_id,
        library_item_id=item_id,
        started_at=started_at,
        ended_at=ended_at,
        title=None,
        note=note,
        created_at=started_at,
        updated_at=started_at,
    )


def _log(
    *,
    log_id: uuid.UUID,
    user_id: uuid.UUID,
    item_id: uuid.UUID,
    cycle_id: uuid.UUID,
    logged_at: dt.datetime,
    unit: str,
    value: float,
    canonical_percent: float | None,
    note: str | None = None,
) -> ReadingProgressLog:
    return ReadingProgressLog(
        id=log_id,
        user_id=user_id,
        library_item_id=item_id,
        reading_session_id=cycle_id,
        logged_at=logged_at,
        unit=unit,
        value=Decimal(str(value)),
        canonical_percent=(
            Decimal(str(canonical_percent)) if canonical_percent is not None else None
        ),
        note=note,
        created_at=logged_at,
        updated_at=logged_at,
    )


def test_statistics_aggregates_mixed_units_multi_reads() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle1 = uuid.uuid4()
    cycle2 = uuid.uuid4()
    t1 = dt.datetime(2026, 2, 8, 4, tzinfo=dt.UTC)
    t2 = dt.datetime(2026, 2, 9, 4, tzinfo=dt.UTC)
    t3 = dt.datetime(2026, 2, 10, 4, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [_item(item_id=item_id, user_id=user_id, status="reading")]
    session.execute_values = [
        [(200, 600)],
        [
            _cycle(
                cycle_id=cycle1,
                user_id=user_id,
                item_id=item_id,
                started_at=t1,
                ended_at=t2,
                note=None,
            ),
            _cycle(
                cycle_id=cycle2,
                user_id=user_id,
                item_id=item_id,
                started_at=t2,
                ended_at=None,
                note="goodreads:abc",
            ),
        ],
        [
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle1,
                logged_at=t1,
                unit="pages_read",
                value=50,
                canonical_percent=25,
            ),
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle1,
                logged_at=t2,
                unit="minutes_listened",
                value=150,
                canonical_percent=25,
            ),
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle2,
                logged_at=t3,
                unit="percent_complete",
                value=60,
                canonical_percent=None,
            ),
        ],
    ]

    data = get_library_item_statistics(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        tz="America/Los_Angeles",
        days=30,
    )

    assert data["counts"]["total_cycles"] == 2
    assert data["counts"]["completed_cycles"] == 1
    assert data["counts"]["imported_cycles"] == 1
    assert data["counts"]["completed_reads"] == 1
    assert data["counts"]["total_logs"] == 3
    assert data["counts"]["logs_with_canonical"] == 3
    assert data["current"]["canonical_percent"] == 60.0
    assert data["current"]["pages_read"] == 120.0
    assert data["current"]["minutes_listened"] == 360.0
    assert len(data["series"]["progress_over_time"]) == 3
    assert len(data["timeline"]) == 3


def test_statistics_imported_without_logs_and_completion_fallback() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [
        _item(item_id=item_id, user_id=user_id, status="completed")
    ]
    session.execute_values = [
        [(None, None), (None, None)],
        [
            _cycle(
                cycle_id=cycle,
                user_id=user_id,
                item_id=item_id,
                started_at=started,
                ended_at=None,
                note="storygraph:123",
            )
        ],
        [],
    ]

    data = get_library_item_statistics(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
    )

    assert data["counts"]["imported_cycles"] == 1
    assert data["counts"]["completed_cycles"] == 0
    assert data["counts"]["completed_reads"] == 1
    assert data["counts"]["total_logs"] == 0
    assert data["current"]["canonical_percent"] == 0.0
    assert data["series"]["daily_delta"] == []


def test_statistics_flags_unresolved_and_keeps_negative_delta() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle = uuid.uuid4()
    t1 = dt.datetime(2026, 2, 8, 9, tzinfo=dt.UTC)
    t2 = dt.datetime(2026, 2, 9, 9, tzinfo=dt.UTC)
    t3 = dt.datetime(2026, 2, 10, 9, tzinfo=dt.UTC)
    unresolved_id = uuid.uuid4()

    session = FakeSession()
    session.scalar_values = [_item(item_id=item_id, user_id=user_id, status="reading")]
    session.execute_values = [
        [(None, 120)],
        [
            _cycle(
                cycle_id=cycle,
                user_id=user_id,
                item_id=item_id,
                started_at=t1,
                ended_at=t3,
                note=None,
            )
        ],
        [
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=t1,
                unit="percent_complete",
                value=50,
                canonical_percent=50,
            ),
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=t2,
                unit="percent_complete",
                value=30,
                canonical_percent=30,
            ),
            _log(
                log_id=unresolved_id,
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=t3,
                unit="pages_read",
                value=10,
                canonical_percent=None,
            ),
        ],
    ]

    data = get_library_item_statistics(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        days=90,
    )

    assert data["counts"]["logs_missing_canonical"] == 1
    assert data["data_quality"]["unresolved_logs_exist"] is True
    assert data["data_quality"]["unresolved_log_ids"] == [str(unresolved_id)]
    deltas = data["series"]["daily_delta"]
    assert deltas[1]["canonical_percent_delta"] == -20.0
    assert any(entry["session_delta"] == -20.0 for entry in data["timeline"])


def test_statistics_timezone_and_streak_non_zero_only() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle = uuid.uuid4()
    # Same UTC day, different local day in America/Los_Angeles.
    t1 = dt.datetime(2026, 2, 9, 7, 30, tzinfo=dt.UTC)
    t2 = dt.datetime(2026, 2, 10, 7, 30, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [_item(item_id=item_id, user_id=user_id, status="reading")]
    session.execute_values = [
        [(100, 300)],
        [
            _cycle(
                cycle_id=cycle,
                user_id=user_id,
                item_id=item_id,
                started_at=t1,
                ended_at=None,
            )
        ],
        [
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=t1,
                unit="percent_complete",
                value=0,
                canonical_percent=0,
            ),
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=t2,
                unit="percent_complete",
                value=10,
                canonical_percent=10,
            ),
        ],
    ]

    data = get_library_item_statistics(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        tz="America/Los_Angeles",
    )

    assert data["streak"]["non_zero_days"] == 1
    assert data["streak"]["last_non_zero_date"] is not None
    assert data["series"]["progress_over_time"][-1]["canonical_percent"] == 10.0


def test_statistics_error_paths() -> None:
    session = FakeSession()
    with pytest.raises(ValueError):
        get_library_item_statistics(
            cast(Any, session),
            user_id=uuid.uuid4(),
            library_item_id=uuid.uuid4(),
            days=2,
        )
    with pytest.raises(ValueError):
        get_library_item_statistics(
            cast(Any, session),
            user_id=uuid.uuid4(),
            library_item_id=uuid.uuid4(),
            tz="Mars/OlympusMons",
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        get_library_item_statistics(
            cast(Any, session),
            user_id=uuid.uuid4(),
            library_item_id=uuid.uuid4(),
        )


def test_statistics_helper_branches() -> None:
    naive = dt.datetime(2026, 2, 10, 12, 0, 0)
    aware = _as_aware_utc(naive)
    assert aware.tzinfo is dt.UTC

    session = FakeSession()
    session.execute_values = [[], []]
    assert _get_item_totals(cast(Any, session), library_item_id=uuid.uuid4()) == (
        None,
        None,
    )
    session = FakeSession()
    session.execute_values = [[], [(111, 222)]]
    assert _get_item_totals(cast(Any, session), library_item_id=uuid.uuid4()) == (
        111,
        222,
    )

    log = _log(
        log_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        item_id=uuid.uuid4(),
        cycle_id=uuid.uuid4(),
        logged_at=dt.datetime(2026, 2, 10, tzinfo=dt.UTC),
        unit="pages_read",
        value=20,
        canonical_percent=None,
    )
    assert _canonical_from_log(log, total_pages=100, total_audio_minutes=None) == 20.0
    log.unit = "minutes_listened"
    assert _canonical_from_log(log, total_pages=None, total_audio_minutes=40) == 50.0
    assert _canonical_from_log(log, total_pages=None, total_audio_minutes=None) is None
    log.unit = cast(Any, "unsupported")
    assert _canonical_from_log(log, total_pages=100, total_audio_minutes=100) is None
    assert (
        _from_canonical(
            unit=cast(Any, "unknown_unit"),
            canonical_percent=10,
            total_pages=100,
            total_audio_minutes=100,
        )
        is None
    )


def test_statistics_window_excludes_old_days_and_streak_breaks() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle = uuid.uuid4()
    now = dt.datetime.now(dt.UTC)
    older = now - dt.timedelta(days=30)
    recent = now - dt.timedelta(days=1)

    session = FakeSession()
    session.scalar_values = [_item(item_id=item_id, user_id=user_id, status="reading")]
    session.execute_values = [
        [(100, 200)],
        [
            _cycle(
                cycle_id=cycle,
                user_id=user_id,
                item_id=item_id,
                started_at=older,
                ended_at=None,
            )
        ],
        [
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=older,
                unit="percent_complete",
                value=20,
                canonical_percent=20,
            ),
            _log(
                log_id=uuid.uuid4(),
                user_id=user_id,
                item_id=item_id,
                cycle_id=cycle,
                logged_at=recent,
                unit="percent_complete",
                value=40,
                canonical_percent=40,
            ),
        ],
    ]

    data = get_library_item_statistics(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        days=7,
    )

    assert len(data["series"]["progress_over_time"]) == 1
    assert data["streak"]["non_zero_days"] == 1
