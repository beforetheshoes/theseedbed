from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any, cast

import pytest

from app.core import schema_guard


class _FakeSession:
    def __init__(self, *, enum_ok: bool, columns_ok: bool) -> None:
        self._enum_ok = enum_ok
        self._columns_ok = columns_ok

    def execute(self, *_args: object, **_kwargs: object):  # type: ignore[no-untyped-def]
        # The guard checks both enum-label and column existence via `.first()`.
        class _Result:
            def __init__(self, present: bool) -> None:
                self._present = present

            def first(self):  # type: ignore[no-untyped-def]
                return (1,) if self._present else None

        sql = str(_args[0])
        if "pg_type" in sql and "pg_enum" in sql:
            return _Result(self._enum_ok)
        if "information_schema.columns" in sql:
            return _Result(self._columns_ok)
        return _Result(False)


@contextmanager
def _open_fake_session(session: _FakeSession) -> Iterator[_FakeSession]:
    yield session


def test_schema_guard_skips_when_not_staging_or_prod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SUPABASE_ENV", raising=False)
    monkeypatch.setattr(
        schema_guard,
        "_open_db_session",
        lambda: _open_fake_session(_FakeSession(enum_ok=False, columns_ok=False)),
    )
    schema_guard.run_schema_guard()


def test_schema_guard_raises_with_actionable_message(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_ENV", "staging")
    monkeypatch.setattr(
        schema_guard,
        "_open_db_session",
        lambda: _open_fake_session(_FakeSession(enum_ok=False, columns_ok=False)),
    )
    with pytest.raises(schema_guard.SchemaGuardError) as exc:
        schema_guard.run_schema_guard()
    message = str(exc.value)
    assert "Apply Supabase migrations" in message
    assert "Missing requirements" in message
    assert "content_visibility" in message
    assert "public.notes.ap_uri" in message
    assert "public.works.default_cover_set_by" in message


def test_schema_guard_passes_when_schema_is_present(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("SUPABASE_ENV", "prod")
    monkeypatch.setattr(
        schema_guard,
        "_open_db_session",
        lambda: _open_fake_session(_FakeSession(enum_ok=True, columns_ok=True)),
    )
    schema_guard.run_schema_guard()


def test_open_db_session_exhausts_generator(monkeypatch: pytest.MonkeyPatch) -> None:
    class _Session:
        closed = False

    session = _Session()

    def _fake_get_db_session():  # type: ignore[no-untyped-def]
        try:
            yield session
        finally:
            session.closed = True

    monkeypatch.setattr(schema_guard, "get_db_session", _fake_get_db_session)

    with schema_guard._open_db_session() as opened:
        assert cast(Any, opened) is session
        assert session.closed is False

    assert session.closed is True
