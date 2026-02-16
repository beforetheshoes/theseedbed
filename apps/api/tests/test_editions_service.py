from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any, cast

import pytest

from app.services.editions import update_edition_totals


class FakeSession:
    def __init__(self) -> None:
        self.edition: Any = None
        self.scalar_value: Any = None
        self.committed = False

    def get(self, _model: type[Any], _key: Any) -> Any:
        return self.edition

    def scalar(self, _stmt: Any) -> Any:
        return self.scalar_value

    def commit(self) -> None:
        self.committed = True


def test_update_edition_totals_requires_updates() -> None:
    session = FakeSession()
    with pytest.raises(ValueError):
        update_edition_totals(
            cast(Any, session),
            user_id=uuid.uuid4(),
            edition_id=uuid.uuid4(),
            updates={},
        )


def test_update_edition_totals_requires_existing_edition() -> None:
    session = FakeSession()
    with pytest.raises(LookupError):
        update_edition_totals(
            cast(Any, session),
            user_id=uuid.uuid4(),
            edition_id=uuid.uuid4(),
            updates={"total_pages": 100},
        )


def test_update_edition_totals_requires_library_membership() -> None:
    session = FakeSession()
    session.edition = SimpleNamespace(
        id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        total_pages=100,
        total_audio_minutes=200,
    )
    session.scalar_value = None
    with pytest.raises(PermissionError):
        update_edition_totals(
            cast(Any, session),
            user_id=uuid.uuid4(),
            edition_id=uuid.uuid4(),
            updates={"total_pages": 120},
        )


def test_update_edition_totals_validates_positive_values() -> None:
    session = FakeSession()
    session.edition = SimpleNamespace(
        id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        total_pages=100,
        total_audio_minutes=200,
    )
    session.scalar_value = uuid.uuid4()

    with pytest.raises(ValueError):
        update_edition_totals(
            cast(Any, session),
            user_id=uuid.uuid4(),
            edition_id=uuid.uuid4(),
            updates={"total_pages": 0},
        )

    with pytest.raises(ValueError):
        update_edition_totals(
            cast(Any, session),
            user_id=uuid.uuid4(),
            edition_id=uuid.uuid4(),
            updates={"total_audio_minutes": 0},
        )


def test_update_edition_totals_updates_and_allows_null() -> None:
    edition = SimpleNamespace(
        id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        total_pages=100,
        total_audio_minutes=200,
    )
    session = FakeSession()
    session.edition = edition
    session.scalar_value = uuid.uuid4()

    updated = update_edition_totals(
        cast(Any, session),
        user_id=uuid.uuid4(),
        edition_id=cast(uuid.UUID, edition.id),
        updates={"total_pages": 250, "total_audio_minutes": None},
    )

    assert cast(Any, updated).id == edition.id
    assert edition.total_pages == 250
    assert edition.total_audio_minutes is None
    assert session.committed is True
