from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa

from app.db.models.users import ReadingSession
from app.services.reading_sessions import (
    create_reading_session,
    delete_reading_session,
    list_reading_sessions,
    update_reading_session,
)


class _ScalarIter:
    def __init__(self, rows: list[ReadingSession]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return iter(self._rows)


class _ExecResult:
    def __init__(self, rows: list[ReadingSession]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarIter:
        return _ScalarIter(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.committed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def execute(self, _stmt: sa.Select[Any]) -> _ExecResult:
        rows = self.scalar_values.pop(0)
        return _ExecResult(rows)

    def add(self, obj: Any) -> None:
        self.added.append(obj)
        if getattr(obj, "id", None) is None and hasattr(obj, "id"):
            obj.id = uuid.uuid4()

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)

    def commit(self) -> None:
        self.committed = True


def test_list_create_update_delete_reading_sessions() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    sess_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    # list: ownership check returns item id, then execute returns one session
    session = FakeSession()
    session.scalar_values = [
        item_id,
        [
            ReadingSession(
                id=sess_id,
                user_id=user_id,
                library_item_id=item_id,
                started_at=started,
                ended_at=None,
                pages_read=1,
                progress_percent=None,
                note=None,
                created_at=started,
                updated_at=started,
            )
        ],
    ]
    rows = list_reading_sessions(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        limit=10,
    )
    assert rows[0]["id"] == str(sess_id)

    # create: ownership check returns item id
    session = FakeSession()
    session.scalar_values = [item_id]
    created = create_reading_session(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        started_at=started,
        ended_at=None,
        pages_read=2,
        progress_percent=10.0,
        note="n",
    )
    assert session.committed is True
    assert created.id is not None

    # update: scalar returns model
    session = FakeSession()
    model = ReadingSession(
        id=sess_id,
        user_id=user_id,
        library_item_id=item_id,
        started_at=started,
        ended_at=None,
        pages_read=None,
        progress_percent=None,
        note=None,
        created_at=started,
        updated_at=started,
    )
    session.scalar_values = [model]
    updated = update_reading_session(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        session_id=sess_id,
        started_at=None,
        ended_at=None,
        pages_read=5,
        progress_percent=None,
        note="ok",
    )
    assert updated.pages_read == 5

    # delete: scalar returns model
    session = FakeSession()
    session.scalar_values = [model]
    delete_reading_session(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        session_id=sess_id,
    )
    assert session.deleted
    assert session.committed is True


def test_reading_session_errors() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    sess_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)

    session = FakeSession()
    session.scalar_values = [None]
    try:
        list_reading_sessions(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            limit=10,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError for missing library item")

    session = FakeSession()
    session.scalar_values = [None]
    try:
        update_reading_session(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            session_id=sess_id,
            started_at=started,
            ended_at=None,
            pages_read=None,
            progress_percent=None,
            note=None,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError for missing session")

    session = FakeSession()
    session.scalar_values = [None]
    try:
        delete_reading_session(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            session_id=sess_id,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError for missing session")
