from __future__ import annotations

import datetime as dt
import uuid
from types import SimpleNamespace
from typing import Any, cast

from app.services.storygraph_imports import (
    _iso,
    _manual_external_provider_id,
    _mark_job_failed_fresh_session,
    _record_issue,
    _safe_rollback,
    get_active_storygraph_job,
)
from app.services.storygraph_parser import StorygraphParseIssue


class _FakeSession:
    def __init__(self, existing: object | None = None) -> None:
        self._existing = existing
        self.added: list[object] = []

    def scalar(self, _stmt: object) -> object | None:
        return self._existing

    def add(self, value: object) -> None:
        self.added.append(value)


class _FakeScalarSession:
    def __init__(self, result: object | None) -> None:
        self.result = result
        self.calls = 0

    def scalar(self, _stmt: object) -> object | None:
        self.calls += 1
        return self.result


class _RollbackRaisesSession:
    def __init__(self) -> None:
        self.rollback_calls = 0

    def rollback(self) -> None:
        self.rollback_calls += 1
        raise RuntimeError("rollback boom")


def test_record_issue_inserts_new_job_row() -> None:
    user_id = uuid.uuid4()
    job = SimpleNamespace(id=uuid.uuid4(), user_id=user_id)
    issue = StorygraphParseIssue(
        row_number=150,
        title="A Small Key",
        uid="9781938660177",
        identity_hash="abc123",
        message="row 150: authors are required",
    )
    session = _FakeSession(existing=None)

    _record_issue(cast(Any, session), job=cast(Any, job), issue=issue)

    assert len(session.added) == 1
    created = cast(Any, session.added[0])
    assert created.job_id == job.id
    assert created.user_id == user_id
    assert created.row_number == 150
    assert created.identity_hash == "abc123"
    assert created.result == "failed"
    assert created.message == "row 150: authors are required"


def test_record_issue_updates_existing_job_row() -> None:
    existing = SimpleNamespace(
        row_number=2,
        title="Old",
        uid="old",
        result="imported",
        message="old message",
    )
    job = SimpleNamespace(id=uuid.uuid4(), user_id=uuid.uuid4())
    issue = StorygraphParseIssue(
        row_number=151,
        title="New",
        uid="new",
        identity_hash="samehash",
        message="row 151: invalid date",
    )
    session = _FakeSession(existing=existing)

    _record_issue(cast(Any, session), job=cast(Any, job), issue=issue)

    assert session.added == []
    assert existing.row_number == 151
    assert existing.title == "New"
    assert existing.uid == "new"
    assert existing.result == "failed"
    assert existing.message == "row 151: invalid date"


def test_record_issue_supports_skipped_result() -> None:
    user_id = uuid.uuid4()
    job = SimpleNamespace(id=uuid.uuid4(), user_id=user_id)
    issue = StorygraphParseIssue(
        row_number=42,
        title="Missing",
        uid=None,
        identity_hash="missinghash",
        message="authors are required",
    )
    session = _FakeSession(existing=None)

    _record_issue(cast(Any, session), job=cast(Any, job), issue=issue, result="skipped")

    created = cast(Any, session.added[0])
    assert created.result == "skipped"


def test_manual_external_provider_id_prefix() -> None:
    assert _manual_external_provider_id("xyz") == "storygraph:xyz"


def test_iso_serializes_and_handles_none() -> None:
    stamp = dt.datetime(2026, 2, 15, 12, 0, tzinfo=dt.UTC)
    assert _iso(stamp) == stamp.isoformat()
    assert _iso(None) is None


def test_get_active_storygraph_job_returns_scalar_result() -> None:
    marker = object()
    session = _FakeScalarSession(marker)
    result = get_active_storygraph_job(
        cast(Any, session),
        user_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
    )
    assert result is marker
    assert session.calls == 1


def test_safe_rollback_swallows_session_errors() -> None:
    session = _RollbackRaisesSession()
    _safe_rollback(cast(Any, session))
    assert session.rollback_calls == 1


def test_mark_job_failed_fresh_session_updates_terminal_fields(
    monkeypatch: Any,
) -> None:
    now = dt.datetime(2026, 2, 16, tzinfo=dt.UTC)
    stale_job = SimpleNamespace(
        status="running",
        error_summary=None,
        finished_at=None,
        updated_at=None,
    )
    terminal_session = SimpleNamespace(
        commit_calls=0,
        close_calls=0,
        commit=lambda: None,
        close=lambda: None,
    )

    def _commit() -> None:
        terminal_session.commit_calls += 1

    def _close() -> None:
        terminal_session.close_calls += 1

    terminal_session.commit = _commit
    terminal_session.close = _close

    monkeypatch.setattr(
        "app.services.storygraph_imports.create_db_session",
        lambda: terminal_session,
    )
    monkeypatch.setattr(
        "app.services.storygraph_imports.get_storygraph_job",
        lambda *_args, **_kwargs: stale_job,
    )
    monkeypatch.setattr(
        "app.services.storygraph_imports.dt",
        SimpleNamespace(
            datetime=SimpleNamespace(now=lambda tz=None: now),
            UTC=dt.UTC,
        ),
    )

    _mark_job_failed_fresh_session(
        user_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        job_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
        message="import stalled",
    )

    assert stale_job.status == "failed"
    assert stale_job.error_summary == "import stalled"
    assert stale_job.finished_at == now
    assert stale_job.updated_at == now
    assert terminal_session.commit_calls == 1
    assert terminal_session.close_calls == 1
