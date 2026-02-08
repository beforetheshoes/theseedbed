from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa

from app.db.models.content import Note
from app.services.notes import create_note, delete_note, list_notes, update_note


class _ScalarResult:
    def __init__(self, rows: list[Note]) -> None:
        self._rows = rows

    def all(self) -> list[Note]:
        return self._rows


class _ExecResult:
    def __init__(self, rows: list[Note]) -> None:
        self._rows = rows

    def scalars(self) -> _ScalarResult:
        return _ScalarResult(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.executed: list[Any] = []
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.committed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def execute(self, stmt: sa.Select[Any]) -> _ExecResult:
        self.executed.append(stmt)
        # Injected via scalar_values for simplicity.
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


def test_list_notes_returns_next_cursor() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    n1 = Note(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item_id,
        title=None,
        body="a",
        visibility="private",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    n2 = Note(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item_id,
        title=None,
        body="b",
        visibility="private",
        created_at=dt.datetime(2026, 2, 7, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 7, tzinfo=dt.UTC),
    )
    session = FakeSession()
    # library item exists, then execute returns notes
    session.scalar_values = [item_id, [n1, n2]]

    result = list_notes(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        limit=1,
        cursor=None,
    )
    assert len(result["items"]) == 1
    assert result["next_cursor"] is not None


def test_create_note_rejects_invalid_visibility() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [item_id]
    try:
        create_note(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            title=None,
            body="x",
            visibility="nope",
        )
    except ValueError as exc:
        assert "visibility" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_update_and_delete_note() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    note_id = uuid.uuid4()
    note = Note(
        id=note_id,
        user_id=user_id,
        library_item_id=item_id,
        title=None,
        body="a",
        visibility="private",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.scalar_values = [note]
    updated = update_note(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        note_id=note_id,
        title="T",
        body=None,
        visibility="public",
    )
    assert updated.title == "T"
    assert updated.visibility == "public"

    session = FakeSession()
    session.scalar_values = [note]
    delete_note(session, user_id=user_id, note_id=note_id)  # type: ignore[arg-type]
    assert session.committed is True


def test_list_notes_invalid_cursor_returns_value_error() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [item_id]
    try:
        list_notes(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            limit=10,
            cursor="not-base64",
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")


def test_update_note_raises_when_missing() -> None:
    user_id = uuid.uuid4()
    note_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [None]
    try:
        update_note(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            note_id=note_id,
            title=None,
            body=None,
            visibility=None,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")


def test_list_notes_with_cursor_decodes_and_filters() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    n1 = Note(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item_id,
        title=None,
        body="a",
        visibility="private",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    n2 = Note(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item_id,
        title=None,
        body="b",
        visibility="private",
        created_at=dt.datetime(2026, 2, 7, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 7, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.scalar_values = [item_id, [n1, n2]]
    first = list_notes(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        limit=1,
        cursor=None,
    )
    cursor = first["next_cursor"]
    assert cursor is not None

    session = FakeSession()
    session.scalar_values = [item_id, [n2]]
    second = list_notes(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        limit=10,
        cursor=cursor,
    )
    assert second["items"][0]["id"] == str(n2.id)


def test_list_notes_requires_owned_library_item() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [None]
    try:
        list_notes(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            limit=10,
            cursor=None,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")
