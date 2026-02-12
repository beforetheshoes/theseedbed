from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import pytest

from app.db.models.bibliography import Author, Edition, Work
from app.services.works import get_work_detail, list_work_editions


class FakeScalarResult:
    def __init__(self, values: list[Any]) -> None:
        self._values = values

    def scalars(self) -> FakeScalarResult:
        return self

    def all(self) -> list[Any]:
        return list(self._values)


class FakeExecuteResult:
    def __init__(
        self, rows: list[Any] | None = None, scalar_values: list[Any] | None = None
    ) -> None:
        self._rows = rows or []
        self._scalar_values = scalar_values or []

    def all(self) -> list[Any]:
        return list(self._rows)

    def scalars(self) -> FakeScalarResult:
        return FakeScalarResult(self._scalar_values)


class FakeSession:
    def __init__(self) -> None:
        self.get_values: list[Any] = []
        self.execute_values: list[FakeExecuteResult] = []
        self.scalar_values: list[Any] = []

    def get(self, _model: object, _ident: object) -> Any:
        if self.get_values:
            return self.get_values.pop(0)
        return None

    def execute(self, _stmt: object) -> FakeExecuteResult:
        if self.execute_values:
            return self.execute_values.pop(0)
        return FakeExecuteResult()

    def scalar(self, _stmt: object) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None


def test_get_work_detail_uses_edition_cover_when_present() -> None:
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url="https://example.com/default.jpg",
    )
    author = Author(id=uuid.uuid4(), name="Author")

    session = FakeSession()
    session.get_values = [work]
    session.execute_values = [FakeExecuteResult(scalar_values=[author])]
    session.scalar_values = ["https://example.com/edition.jpg"]

    detail = get_work_detail(session, work_id=work_id)  # type: ignore[arg-type]
    assert detail["cover_url"] == "https://example.com/edition.jpg"
    assert detail["authors"][0]["name"] == "Author"


def test_get_work_detail_falls_back_to_work_default_cover() -> None:
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url="https://example.com/default.jpg",
    )
    session = FakeSession()
    session.get_values = [work]
    session.execute_values = [FakeExecuteResult(scalar_values=[])]
    session.scalar_values = [None]

    detail = get_work_detail(session, work_id=work_id)  # type: ignore[arg-type]
    assert detail["cover_url"] == "https://example.com/default.jpg"


def test_list_work_editions_returns_rows() -> None:
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    edition = Edition(
        id=uuid.uuid4(),
        work_id=work_id,
        isbn10="1234567890",
        isbn13=None,
        publisher="Pub",
        publish_date=None,
        language=None,
        format=None,
        cover_url="https://example.com/cover.jpg",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )

    session = FakeSession()
    session.get_values = [work]
    session.execute_values = [
        FakeExecuteResult(rows=[(edition, "openlibrary", "/books/OL1M")])
    ]

    rows = list_work_editions(session, work_id=work_id, limit=20)  # type: ignore[arg-type]
    assert rows[0]["id"] == str(edition.id)
    assert rows[0]["provider"] == "openlibrary"


def test_list_work_editions_raises_when_work_missing() -> None:
    session = FakeSession()
    session.get_values = [None]
    with pytest.raises(LookupError):
        list_work_editions(session, work_id=uuid.uuid4(), limit=20)  # type: ignore[arg-type]
