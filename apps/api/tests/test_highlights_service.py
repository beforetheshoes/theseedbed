from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa

from app.db.models.content import Highlight
from app.services.highlights import (
    create_highlight,
    delete_highlight,
    list_highlights,
    update_highlight,
)


class _ScalarIter:
    def __init__(self, rows: list[Highlight]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return iter(self._rows)


class _ExecResult:
    def __init__(self, rows: list[Highlight]) -> None:
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


def test_create_highlight_rejects_long_public_quote() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [item_id]
    try:
        create_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            quote="x" * 11,
            visibility="public",
            location=None,
            location_type=None,
            location_sort=None,
            max_public_chars=10,
        )
    except ValueError as exc:
        assert "character" in str(exc)
    else:
        raise AssertionError("expected ValueError")


def test_list_highlights_truncates_public_quote() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    highlight = Highlight(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item_id,
        quote="abcdefghijk",
        visibility="public",
        location=None,
        location_type=None,
        location_sort=None,
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.scalar_values = [item_id, [highlight]]
    rows = list_highlights(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        library_item_id=item_id,
        limit=10,
        max_public_chars=5,
    )
    assert rows[0]["quote"] == "abcde"


def test_update_and_delete_highlight() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    highlight_id = uuid.uuid4()
    started = dt.datetime(2026, 2, 8, tzinfo=dt.UTC)
    highlight = Highlight(
        id=highlight_id,
        user_id=user_id,
        library_item_id=item_id,
        quote="hi",
        visibility="private",
        location=None,
        location_type=None,
        location_sort=None,
        created_at=started,
        updated_at=started,
    )

    from app.services.highlights import delete_highlight, update_highlight

    session = FakeSession()
    session.scalar_values = [highlight]
    updated = update_highlight(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        highlight_id=highlight_id,
        quote="updated",
        visibility="unlisted",
        location=None,
        location_type=None,
        location_sort=None,
        max_public_chars=10,
    )
    assert updated.quote == "updated"
    assert updated.visibility == "unlisted"

    session = FakeSession()
    session.scalar_values = [highlight]
    delete_highlight(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        highlight_id=highlight_id,
    )
    assert session.deleted
    assert session.committed is True


def test_highlight_error_paths() -> None:
    user_id = uuid.uuid4()
    item_id = uuid.uuid4()
    highlight_id = uuid.uuid4()

    # create: missing library item
    session = FakeSession()
    session.scalar_values = [None]
    try:
        create_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            quote="q",
            visibility="private",
            location=None,
            location_type=None,
            location_sort=None,
            max_public_chars=10,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")

    # create: invalid visibility
    session = FakeSession()
    session.scalar_values = [item_id]
    try:
        create_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            quote="q",
            visibility="nope",
            location=None,
            location_type=None,
            location_sort=None,
            max_public_chars=10,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")

    # create: blank quote
    session = FakeSession()
    session.scalar_values = [item_id]
    try:
        create_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            library_item_id=item_id,
            quote="   ",
            visibility="private",
            location=None,
            location_type=None,
            location_sort=None,
            max_public_chars=10,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError")

    # update: missing highlight
    session = FakeSession()
    session.scalar_values = [None]
    try:
        update_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            highlight_id=highlight_id,
            quote=None,
            visibility=None,
            location=None,
            location_type=None,
            location_sort=None,
            max_public_chars=10,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")

    # delete: missing highlight
    session = FakeSession()
    session.scalar_values = [None]
    try:
        delete_highlight(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            highlight_id=highlight_id,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")
