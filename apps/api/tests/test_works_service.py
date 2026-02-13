from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from typing import Any, cast

import pytest

from app.db.models.bibliography import Author, Edition, Work
from app.services.works import (
    get_openlibrary_author_profile,
    get_openlibrary_work_key,
    get_work_detail,
    list_related_works,
    list_work_editions,
    refresh_work_if_stale,
)


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


def test_get_work_detail_raises_when_work_missing() -> None:
    session = FakeSession()
    session.get_values = [None]
    with pytest.raises(LookupError):
        get_work_detail(session, work_id=uuid.uuid4())  # type: ignore[arg-type]


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


def test_get_openlibrary_work_key_returns_provider_id() -> None:
    session = FakeSession()
    session.scalar_values = ["/works/OL1W"]
    key = get_openlibrary_work_key(session, work_id=uuid.uuid4())  # type: ignore[arg-type]
    assert key == "/works/OL1W"


def test_list_related_works_returns_empty_without_mapping() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    open_library = object()
    items = asyncio.run(
        list_related_works(
            session, work_id=uuid.uuid4(), open_library=open_library  # type: ignore[arg-type]
        )
    )
    assert items == []


def test_list_related_works_returns_empty_without_source_payload() -> None:
    session = FakeSession()
    session.scalar_values = ["/works/OL1W", "not-a-dict"]
    items = asyncio.run(
        list_related_works(
            cast(Any, session),
            work_id=uuid.uuid4(),
            open_library=object(),  # type: ignore[arg-type]
        )
    )
    assert items == []


def test_list_related_works_builds_payload() -> None:
    session = FakeSession()
    session.scalar_values = ["/works/OL1W", {"subjects": ["Fantasy"]}]

    class FakeOpenLibrary:
        async def fetch_related_works(self, **_kwargs: Any) -> list[Any]:
            return [
                type(
                    "R",
                    (),
                    {
                        "work_key": "/works/OL2W",
                        "title": "Related",
                        "cover_url": None,
                        "first_publish_year": 2001,
                        "author_names": ["Author A"],
                    },
                )()
            ]

    items = asyncio.run(
        list_related_works(
            session, work_id=uuid.uuid4(), open_library=FakeOpenLibrary()  # type: ignore[arg-type]
        )
    )
    assert items[0]["work_key"] == "/works/OL2W"
    assert items[0]["author_names"] == ["Author A"]


def test_get_openlibrary_author_profile_success() -> None:
    author_id = uuid.uuid4()
    session = FakeSession()
    session.get_values = [Author(id=author_id, name="Author")]
    session.scalar_values = ["/authors/OL1A"]

    class FakeOpenLibrary:
        async def fetch_author_profile(self, **_kwargs: Any) -> Any:
            return type(
                "P",
                (),
                {
                    "name": "Author A",
                    "bio": "Bio",
                    "photo_url": None,
                    "author_key": "/authors/OL1A",
                    "top_works": [
                        type(
                            "W",
                            (),
                            {
                                "work_key": "/works/OL2W",
                                "title": "Book",
                                "cover_url": None,
                                "first_publish_year": 2001,
                            },
                        )()
                    ],
                },
            )()

    profile = asyncio.run(
        get_openlibrary_author_profile(
            session, author_id=author_id, open_library=FakeOpenLibrary()  # type: ignore[arg-type]
        )
    )
    assert profile["name"] == "Author A"
    assert profile["works"][0]["work_key"] == "/works/OL2W"


def test_get_openlibrary_author_profile_raises_when_missing_mapping() -> None:
    author_id = uuid.uuid4()
    session = FakeSession()
    session.get_values = [Author(id=author_id, name="Author")]
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        asyncio.run(
            get_openlibrary_author_profile(
                session, author_id=author_id, open_library=object()  # type: ignore[arg-type]
            )
        )


def test_get_openlibrary_author_profile_raises_when_author_missing() -> None:
    session = FakeSession()
    session.get_values = [None]
    with pytest.raises(LookupError):
        asyncio.run(
            get_openlibrary_author_profile(
                cast(Any, session),
                author_id=uuid.uuid4(),
                open_library=object(),  # type: ignore[arg-type]
            )
        )


def test_refresh_work_if_stale_refreshes(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    stale = dt.datetime.now(dt.UTC) - dt.timedelta(days=31)
    session.scalar_values = ["/works/OL1W", stale]
    called = {"imported": False}

    class FakeOpenLibrary:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            return object()

    monkeypatch.setattr(
        "app.services.works.import_openlibrary_bundle",
        lambda *_args, **_kwargs: called.__setitem__("imported", True),
    )
    result = asyncio.run(
        refresh_work_if_stale(
            session,  # type: ignore[arg-type]
            work_id=uuid.uuid4(),
            open_library=FakeOpenLibrary(),  # type: ignore[arg-type]
        )
    )

    assert result is True
    assert called["imported"] is True


def test_refresh_work_if_stale_skips_when_fresh() -> None:
    session = FakeSession()
    fresh = dt.datetime.now(dt.UTC) - dt.timedelta(days=1)
    session.scalar_values = ["/works/OL1W", fresh]
    result = asyncio.run(
        refresh_work_if_stale(
            session, work_id=uuid.uuid4(), open_library=object()  # type: ignore[arg-type]
        )
    )
    assert result is False


def test_refresh_work_if_stale_returns_false_without_openlibrary_mapping() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    result = asyncio.run(
        refresh_work_if_stale(
            cast(Any, session),
            work_id=uuid.uuid4(),
            open_library=object(),  # type: ignore[arg-type]
        )
    )
    assert result is False
