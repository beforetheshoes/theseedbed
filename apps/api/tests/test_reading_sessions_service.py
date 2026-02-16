from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

import pytest
import sqlalchemy as sa

from app.db.models.users import ReadingProgressLog, ReadingSession
from app.services.reading_sessions import (
    _canonical_percent,
    _get_item_totals,
    create_progress_log,
    create_read_cycle,
    delete_progress_log,
    delete_read_cycle,
    get_or_create_import_cycle,
    list_progress_logs,
    list_read_cycles,
    update_progress_log,
    update_read_cycle,
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
        self.execute_values: list[Any] = []
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.committed = False
        self.flushed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def execute(self, _stmt: sa.Select[Any]) -> _ExecResult:
        rows = self.execute_values.pop(0)
        return _ExecResult(rows)

    def add(self, obj: Any) -> None:
        self.added.append(obj)
        if getattr(obj, "id", None) is None and hasattr(obj, "id"):
            obj.id = uuid.uuid4()

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    def flush(self) -> None:
        self.flushed = True

    def commit(self) -> None:
        self.committed = True


def test_cycle_crud_and_list() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [object()]
    session.execute_values = [
        [(320, 600)],
        [
            ReadingSession(
                id=cycle_id,
                user_id=user_id,
                library_item_id=item_id,
                started_at=started,
                ended_at=None,
                title=None,
                note=None,
                created_at=started,
                updated_at=started,
            )
        ],
    ]
    rows = list_read_cycles(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        limit=10,
    )
    assert rows[0]["id"] == str(cycle_id)
    assert rows[0]["conversion"]["can_convert_pages_minutes"] is True

    session = FakeSession()
    session.scalar_values = [object()]
    created = create_read_cycle(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        started_at=started,
        ended_at=None,
        title="Read #1",
        note="n",
    )
    assert session.committed is True
    assert created.id is not None

    session = FakeSession()
    model = ReadingSession(
        id=cycle_id,
        user_id=user_id,
        library_item_id=item_id,
        started_at=started,
        ended_at=None,
        title=None,
        note=None,
        created_at=started,
        updated_at=started,
    )
    session.scalar_values = [model]
    updated = update_read_cycle(
        cast(Any, session),
        user_id=user_id,
        cycle_id=cycle_id,
        started_at=None,
        ended_at=None,
        title="updated",
        note="ok",
    )
    assert updated.title == "updated"

    session = FakeSession()
    session.scalar_values = [model]
    delete_read_cycle(cast(Any, session), user_id=user_id, cycle_id=cycle_id)
    assert session.deleted
    assert session.committed is True


def test_progress_log_crud_and_list() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle_id = uuid.uuid4()
    log_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [
        ReadingSession(
            id=cycle_id,
            user_id=user_id,
            library_item_id=item_id,
            started_at=started,
            ended_at=None,
            title=None,
            note=None,
            created_at=started,
            updated_at=started,
        )
    ]
    session.execute_values = [
        [(200, 400)],
        [
            ReadingProgressLog(
                id=log_id,
                user_id=user_id,
                library_item_id=item_id,
                reading_session_id=cycle_id,
                logged_at=started,
                unit="percent_complete",
                value=10,
                canonical_percent=10,
                note=None,
                created_at=started,
                updated_at=started,
            )
        ],
    ]
    rows = list_progress_logs(
        cast(Any, session),
        user_id=user_id,
        cycle_id=cycle_id,
        limit=10,
    )
    assert rows[0]["canonical_percent"] == 10.0

    session = FakeSession()
    session.scalar_values = [
        ReadingSession(
            id=cycle_id,
            user_id=user_id,
            library_item_id=item_id,
            started_at=started,
            ended_at=None,
            title=None,
            note=None,
            created_at=started,
            updated_at=started,
        )
    ]
    session.execute_values = [[(100, 300)]]
    created = create_progress_log(
        cast(Any, session),
        user_id=user_id,
        cycle_id=cycle_id,
        unit="pages_read",
        value=30.0,
        logged_at=started,
        note="x",
    )
    assert session.committed is True
    assert created.canonical_percent == 30.0

    session = FakeSession()
    model = ReadingProgressLog(
        id=log_id,
        user_id=user_id,
        library_item_id=item_id,
        reading_session_id=cycle_id,
        logged_at=started,
        unit="minutes_listened",
        value=10,
        canonical_percent=5,
        note=None,
        created_at=started,
        updated_at=started,
    )
    session.scalar_values = [model]
    session.execute_values = [[(None, None)]]
    updated = update_progress_log(
        cast(Any, session),
        user_id=user_id,
        log_id=log_id,
        unit=None,
        value=40.0,
        logged_at=None,
        note="ok",
    )
    assert updated.canonical_percent is None

    session = FakeSession()
    session.scalar_values = [model]
    delete_progress_log(cast(Any, session), user_id=user_id, log_id=log_id)
    assert session.deleted
    assert session.committed is True


def test_import_cycle_helper_reuses_or_creates() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)
    marker = "goodreads:abc"

    session = FakeSession()
    existing = ReadingSession(
        id=cycle_id,
        user_id=user_id,
        library_item_id=item_id,
        started_at=started,
        ended_at=None,
        title=None,
        note=marker,
        created_at=started,
        updated_at=started,
    )
    session.scalar_values = [existing]
    model = get_or_create_import_cycle(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        marker=marker,
        started_at=started,
        ended_at=None,
    )
    assert model.id == cycle_id

    session = FakeSession()
    session.scalar_values = [None]
    model = get_or_create_import_cycle(
        cast(Any, session),
        user_id=user_id,
        library_item_id=item_id,
        marker=marker,
        started_at=started,
        ended_at=None,
    )
    assert model.id is not None
    assert session.flushed is True


def test_get_item_totals_prefers_preferred_then_fallback_then_none() -> None:
    item_id = uuid.uuid4()

    session = FakeSession()
    session.execute_values = [[(111, 222)]]
    assert _get_item_totals(cast(Any, session), library_item_id=item_id) == (111, 222)

    session = FakeSession()
    session.execute_values = [[], [(333, 444)]]
    assert _get_item_totals(cast(Any, session), library_item_id=item_id) == (333, 444)

    session = FakeSession()
    session.execute_values = [[], []]
    assert _get_item_totals(cast(Any, session), library_item_id=item_id) == (
        None,
        None,
    )


def test_canonical_percent_rules() -> None:
    assert (
        _canonical_percent(
            unit="percent_complete",
            value=25.0,
            total_pages=None,
            total_audio_minutes=None,
        )
        == 25.0
    )
    assert (
        _canonical_percent(
            unit="pages_read",
            value=50.0,
            total_pages=200,
            total_audio_minutes=None,
        )
        == 25.0
    )
    assert (
        _canonical_percent(
            unit="minutes_listened",
            value=30.0,
            total_pages=None,
            total_audio_minutes=120,
        )
        == 25.0
    )
    assert (
        _canonical_percent(
            unit="pages_read",
            value=10.0,
            total_pages=None,
            total_audio_minutes=None,
        )
        is None
    )
    assert (
        _canonical_percent(
            unit="minutes_listened",
            value=10.0,
            total_pages=None,
            total_audio_minutes=0,
        )
        is None
    )
    with pytest.raises(ValueError):
        _canonical_percent(
            unit="percent_complete",
            value=120.0,
            total_pages=None,
            total_audio_minutes=None,
        )


def test_service_error_paths() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    cycle_id = uuid.uuid4()
    log_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        list_read_cycles(
            cast(Any, session), user_id=user_id, library_item_id=item_id, limit=10
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        create_read_cycle(
            cast(Any, session),
            user_id=user_id,
            library_item_id=item_id,
            started_at=started,
            ended_at=None,
            title=None,
            note=None,
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        update_read_cycle(
            cast(Any, session),
            user_id=user_id,
            cycle_id=cycle_id,
            started_at=None,
            ended_at=None,
            title=None,
            note=None,
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        delete_read_cycle(cast(Any, session), user_id=user_id, cycle_id=cycle_id)

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        list_progress_logs(
            cast(Any, session), user_id=user_id, cycle_id=cycle_id, limit=10
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        create_progress_log(
            cast(Any, session),
            user_id=user_id,
            cycle_id=cycle_id,
            unit="percent_complete",
            value=10,
            logged_at=None,
            note=None,
        )

    session = FakeSession()
    session.scalar_values = [
        ReadingSession(
            id=cycle_id,
            user_id=user_id,
            library_item_id=item_id,
            started_at=started,
            ended_at=None,
            title=None,
            note=None,
            created_at=started,
            updated_at=started,
        )
    ]
    session.execute_values = [[(None, None)]]
    with pytest.raises(ValueError):
        create_progress_log(
            cast(Any, session),
            user_id=user_id,
            cycle_id=cycle_id,
            unit="percent_complete",
            value=101,
            logged_at=None,
            note=None,
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        update_progress_log(
            cast(Any, session),
            user_id=user_id,
            log_id=log_id,
            unit=None,
            value=None,
            logged_at=None,
            note=None,
        )

    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        delete_progress_log(cast(Any, session), user_id=user_id, log_id=log_id)
