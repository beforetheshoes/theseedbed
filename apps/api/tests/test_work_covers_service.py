from __future__ import annotations

import asyncio
import uuid
from typing import Any, cast

import pytest

from app.core.config import Settings
from app.db.models.bibliography import Work
from app.db.models.external_provider import SourceRecord
from app.db.models.users import LibraryItem
from app.services import work_covers
from app.services.covers import CoverCacheResult
from app.services.storage import StorageUploadResult
from app.services.work_covers import (
    _author_search_variants,
    _normalized_isbn_candidates,
    _search_openlibrary_cover_candidates,
    list_googlebooks_cover_candidates,
    list_openlibrary_cover_candidates,
    select_cover_from_url,
    select_openlibrary_cover,
)


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.get_map: dict[tuple[type[Any], Any], Any] = {}
        self.committed = False

    def scalar(self, _stmt: Any) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def get(self, model: type[Any], key: Any) -> Any:
        return self.get_map.get((model, key))

    def commit(self) -> None:
        self.committed = True


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )


def test_list_openlibrary_cover_candidates_parses_source_record() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()

    session.scalar_values = [
        "/works/OL1W",
        SourceRecord(
            provider="openlibrary",
            entity_type="work",
            provider_id="/works/OL1W",
            raw={"covers": [10, 11, 10]},
        ),
    ]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            raise AssertionError("should not be called when SourceRecord has covers")

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert [i["cover_id"] for i in items] == [10, 11]
    assert "thumbnail_url" in items[0]
    assert "image_url" in items[0]
    assert items[0]["source"] == "openlibrary"


def test_list_openlibrary_cover_candidates_returns_empty_when_missing() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map[(Work, work_id)] = work
    session.scalar_values = [None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str, str | None]]:
                return [("9780000000001", None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return (" Author ",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            raise AssertionError("should not fetch cover ids without mapped work key")

        async def search_books(self, **kwargs: Any) -> Any:
            if kwargs.get("query") != "isbn:9780000000001":
                return type("Resp", (), {"items": []})()
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "work_key": "/works/OL1W",
                                "cover_url": "https://covers.openlibrary.org/b/id/123-L.jpg",
                            },
                        )()
                    ]
                },
            )()

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert len(items) == 1
    assert items[0]["source"] == "openlibrary"
    assert items[0]["source_id"] == "/works/OL1W"


def test_list_openlibrary_cover_candidates_returns_empty_when_source_missing() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.scalar_values = ["/works/OL1W", None]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            return [99]

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert [i["cover_id"] for i in items] == [99]


def test_list_openlibrary_cover_candidates_falls_back_to_search_when_no_cover_ids() -> (
    None
):
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map[(Work, work_id)] = work
    session.scalar_values = ["/works/OL1W", None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return [(None, None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return ("Author",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            return []

        async def search_books(self, **kwargs: Any) -> Any:
            if kwargs["query"] != "Book":
                return type("Resp", (), {"items": []})()
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "work_key": "/works/OLX",
                                "cover_url": "https://covers.openlibrary.org/b/id/500-L.jpg",
                            },
                        )()
                    ]
                },
            )()

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert len(items) == 1
    assert items[0]["source_id"] == "/works/OLX"
    assert items[0]["image_url"] == "https://covers.openlibrary.org/b/id/500-L.jpg"


def test_list_openlibrary_cover_candidates_returns_empty_when_covers_invalid() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.scalar_values = [
        "/works/OL1W",
        SourceRecord(
            provider="openlibrary",
            entity_type="work",
            provider_id="/works/OL1W",
            raw={"covers": "nope"},
        ),
    ]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            return [10, 11]

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert [i["cover_id"] for i in items] == [10, 11]


def test_normalized_isbn_candidates_dedupes_and_filters_invalid() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return [
                    ("978-0000000001", "0-123456789"),
                    ("9780000000001", "0123456789"),
                    ("bad", "123"),
                ]

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    values = _normalized_isbn_candidates(cast(Any, session), work_id=work_id)
    assert values == ["9780000000001", "0123456789"]


def test_search_openlibrary_cover_candidates_handles_missing_work() -> None:
    session = FakeSession()

    class _OL:
        async def search_books(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not be called")

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=uuid.uuid4(),
            open_library=cast(Any, _OL()),
        )
    )
    assert items == []


def test_search_openlibrary_cover_candidates_skips_empty_and_duplicate_urls() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return [("9780000000001", None), ("9780000000001", None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return ("Author",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _OL:
        async def search_books(self, **_kwargs: Any) -> Any:
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "work_key": "/works/OL1W",
                                "cover_url": None,
                            },
                        )(),
                        type(
                            "Item",
                            (),
                            {
                                "work_key": "/works/OL2W",
                                "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg",
                            },
                        )(),
                        type(
                            "Item",
                            (),
                            {
                                "work_key": "/works/OL3W",
                                "cover_url": "https://covers.openlibrary.org/b/id/1-L.jpg",
                            },
                        )(),
                    ]
                },
            )()

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            open_library=cast(Any, _OL()),
        )
    )
    assert len(items) == 1
    assert items[0]["source_id"] == "/works/OL2W"


def test_search_openlibrary_cover_candidates_tries_author_variants() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Katabasis",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return []

            @staticmethod
            def first() -> tuple[str] | None:
                return ("R.F. Kuang",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    seen_authors: list[str] = []

    class _OL:
        async def search_books(self, **kwargs: Any) -> Any:
            seen_authors.append(str(kwargs.get("author") or ""))
            if kwargs.get("author") == "r f kuang":
                return type(
                    "Resp",
                    (),
                    {
                        "items": [
                            type(
                                "Item",
                                (),
                                {
                                    "work_key": "/works/OL42397860W",
                                    "cover_url": "https://covers.openlibrary.org/b/id/423-L.jpg",
                                },
                            )()
                        ]
                    },
                )()
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            open_library=cast(Any, _OL()),
        )
    )
    assert len(items) == 1
    assert "R.F. Kuang" in seen_authors
    assert "r f kuang" in seen_authors


def test_search_openlibrary_cover_candidates_caps_at_sixteen_results() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return [(None, None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return ("Author",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _OL:
        async def search_books(self, **_kwargs: Any) -> Any:
            items = [
                type(
                    "Item",
                    (),
                    {
                        "work_key": f"/works/OL{i}W",
                        "cover_url": f"https://covers.openlibrary.org/b/id/{i}-L.jpg",
                    },
                )()
                for i in range(1, 30)
            ]
            return type("Resp", (), {"items": items})()

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            open_library=cast(Any, _OL()),
        )
    )
    assert len(items) == 16


def test_list_openlibrary_cover_candidates_ignores_invalid_cover_ids_from_source() -> (
    None
):
    session = FakeSession()
    work_id = uuid.uuid4()
    session.scalar_values = [
        "/works/OL1W",
        SourceRecord(
            provider="openlibrary",
            entity_type="work",
            provider_id="/works/OL1W",
            raw={"covers": ["x", None, 0, -1, 12]},
        ),
    ]

    class _OL:
        async def fetch_cover_ids_for_work(self, **_kwargs: Any) -> list[int]:
            raise AssertionError("should not fetch when valid source cover id exists")

    items = asyncio.run(
        list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=_OL()  # type: ignore[arg-type]
        )
    )
    assert [i["cover_id"] for i in items] == [12]


def test_list_googlebooks_cover_candidates_by_isbn() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map[(Work, work_id)] = work
    session.scalar_values = [None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str, str | None]]:
                return [("9780000000001", None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return None

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _Google:
        async def search_books(self, **kwargs: Any) -> Any:
            query = kwargs["query"]
            if query != "isbn:9780000000001":
                return type("Resp", (), {"items": []})()
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "volume_id": "gb1",
                                "cover_url": "https://books.google.com/cover.jpg",
                                "attribution_url": "https://books.google.com/books?id=gb1",
                            },
                        )()
                    ]
                },
            )()

        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not fetch bundle without mapped google id")

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            session, work_id=work_id, google_books=_Google()  # type: ignore[arg-type]
        )
    )
    assert len(items) == 1
    assert items[0]["source"] == "googlebooks"
    assert items[0]["source_id"] == "gb1"


def test_list_googlebooks_cover_candidates_tries_author_variants() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Katabasis",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map[(Work, work_id)] = work
    session.scalar_values = [None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return []

            @staticmethod
            def first() -> tuple[str] | None:
                return ("R.F. Kuang",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    seen_authors: list[str] = []

    class _Google:
        async def search_books(self, **kwargs: Any) -> Any:
            seen_authors.append(str(kwargs.get("author") or ""))
            if kwargs.get("author") == "r f kuang":
                return type(
                    "Resp",
                    (),
                    {
                        "items": [
                            type(
                                "Item",
                                (),
                                {
                                    "volume_id": "gb-katabasis",
                                    "cover_url": "https://books.google.com/katabasis-cover.jpg",
                                    "attribution_url": "https://books.google.com/books?id=gb-katabasis",
                                },
                            )()
                        ]
                    },
                )()
            return type("Resp", (), {"items": []})()

        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not fetch bundle without mapped google id")

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            google_books=cast(Any, _Google()),
        )
    )
    assert len(items) == 1
    assert "R.F. Kuang" in seen_authors
    assert "r f kuang" in seen_authors


def test_list_googlebooks_cover_candidates_returns_empty_when_work_missing() -> None:
    session = FakeSession()

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not be called")

        async def search_books(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not be called")

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            cast(Any, session),
            work_id=uuid.uuid4(),
            google_books=_Google(),  # type: ignore[arg-type]
        )
    )
    assert items == []


def test_list_googlebooks_cover_candidates_prefers_mapped_bundle_and_dedupes() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = ["gb1"]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str, str | None]]:
                return [("9780000000001", None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return (" Author ",)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            return type(
                "Bundle",
                (),
                {
                    "volume_id": "gb1",
                    "cover_url": "https://books.google.com/cover.jpg",
                    "attribution_url": "https://books.google.com/books?id=gb1",
                },
            )()

        async def search_books(self, **_kwargs: Any) -> Any:
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "volume_id": "gb2",
                                "cover_url": "https://books.google.com/cover.jpg",
                                "attribution_url": "https://books.google.com/books?id=gb2",
                            },
                        )(),
                        type(
                            "Item",
                            (),
                            {
                                "volume_id": "gb3",
                                "cover_url": "https://books.google.com/cover-2.jpg",
                                "attribution_url": "https://books.google.com/books?id=gb3",
                            },
                        )(),
                    ]
                },
            )()

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            session, work_id=work_id, google_books=_Google()  # type: ignore[arg-type]
        )
    )
    assert [item["source_id"] for item in items] == ["gb1", "gb3"]


def test_list_googlebooks_cover_candidates_limits_and_skips_invalid_entries() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="isbn:9780000000001",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = ["gb0"]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str, str | None]]:
                return [
                    ("9780000000001", "1-234-56789-0"),
                    ("9780000000001", "1-234-56789-0"),
                ]

            @staticmethod
            def first() -> tuple[int] | None:
                return (123,)

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            return type(
                "Bundle",
                (),
                {
                    "volume_id": "gb0",
                    "cover_url": None,
                    "attribution_url": "https://books.google.com/books?id=gb0",
                },
            )()

        async def search_books(self, **_kwargs: Any) -> Any:
            dynamic_items = [
                type(
                    "Item",
                    (),
                    {
                        "volume_id": f"gb{idx}",
                        "cover_url": f"https://books.google.com/cover-{idx}.jpg",
                        "attribution_url": f"https://books.google.com/books?id=gb{idx}",
                    },
                )()
                for idx in range(1, 18)
            ]
            return type(
                "Resp",
                (),
                {
                    "items": [
                        type(
                            "Item",
                            (),
                            {
                                "volume_id": "missing-cover",
                                "cover_url": None,
                                "attribution_url": None,
                            },
                        )(),
                        *dynamic_items,
                    ]
                },
            )()

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            session, work_id=work_id, google_books=_Google()  # type: ignore[arg-type]
        )
    )
    assert len(items) == 16
    assert items[0]["source_id"] == "gb1"


def test_list_googlebooks_cover_candidates_skips_blank_and_duplicate_queries() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="   ",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = [None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str, str | None]]:
                return [("-", None), ("9780000000001", None), ("9780000000001", None)]

            @staticmethod
            def first() -> tuple[str] | None:
                return None

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    queries: list[str] = []

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("should not fetch bundle without mapped google id")

        async def search_books(self, **kwargs: Any) -> Any:
            queries.append(str(kwargs["query"]))
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            google_books=_Google(),  # type: ignore[arg-type]
        )
    )
    assert items == []
    assert queries == ["isbn:", "isbn:9780000000001"]


def test_author_search_variants_handles_initials_and_last_name() -> None:
    variants = _author_search_variants("R.F. Kuang")
    assert "R.F. Kuang" in variants
    assert "r f kuang" in variants
    assert "rf kuang" in variants
    assert "kuang" in variants


def test_author_search_variants_handles_full_name() -> None:
    variants = _author_search_variants("Rebecca F. Kuang")
    assert "rebecca kuang" in variants
    assert "r f kuang" in variants


def test_search_openlibrary_cover_candidates_dedupes_author_variants_with_same_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.execute = lambda _stmt: type(  # type: ignore[attr-defined]
        "Res",
        (),
        {
            "all": staticmethod(lambda: [(None, None)]),
            "first": staticmethod(lambda: ("Author",)),
        },
    )()
    monkeypatch.setattr(
        work_covers, "_author_search_variants", lambda _author: ["same", "same"]
    )
    calls: list[str] = []

    class _OL:
        async def search_books(self, **kwargs: Any) -> Any:
            calls.append(str(kwargs.get("author") or ""))
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            open_library=cast(Any, _OL()),
        )
    )
    assert items == []
    assert calls.count("same") == 1
    assert "" in calls


def test_list_googlebooks_cover_candidates_dedupes_author_variants_with_same_value(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = [None]
    session.execute = lambda _stmt: type(  # type: ignore[attr-defined]
        "Res",
        (),
        {
            "all": staticmethod(lambda: [(None, None)]),
            "first": staticmethod(lambda: ("Author",)),
        },
    )()
    monkeypatch.setattr(
        work_covers, "_author_search_variants", lambda _author: ["same", "same"]
    )
    calls: list[str] = []

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("not expected")

        async def search_books(self, **kwargs: Any) -> Any:
            calls.append(str(kwargs.get("author") or ""))
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            google_books=cast(Any, _Google()),
        )
    )
    assert items == []
    assert calls.count("same") == 1
    assert "" in calls


def test_list_googlebooks_cover_candidates_skips_already_seen_query_via_mocked_isbns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = [None]

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def first() -> tuple[str] | None:
                return None

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    monkeypatch.setattr(
        work_covers, "_list_isbn_queries", lambda *_args, **_kwargs: ["9781", "9781"]
    )
    calls: list[str] = []

    class _Google:
        async def fetch_work_bundle(self, **_kwargs: Any) -> Any:
            raise AssertionError("not expected")

        async def search_books(self, **kwargs: Any) -> Any:
            calls.append(str(kwargs["query"]))
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        list_googlebooks_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            google_books=cast(Any, _Google()),
        )
    )
    assert items == []
    assert calls == ["isbn:9781"]


def test_search_openlibrary_cover_candidates_skips_seen_query_via_mocked_isbns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    monkeypatch.setattr(
        work_covers,
        "_normalized_isbn_candidates",
        lambda *_args, **_kwargs: ["9781", "9781"],
    )
    session.execute = lambda _stmt: type("Res", (), {"first": staticmethod(lambda: None)})()  # type: ignore[attr-defined]
    calls: list[str] = []

    class _OL:
        async def search_books(self, **kwargs: Any) -> Any:
            calls.append(str(kwargs["query"]))
            return type("Resp", (), {"items": []})()

    items = asyncio.run(
        _search_openlibrary_cover_candidates(
            cast(Any, session),
            work_id=work_id,
            open_library=cast(Any, _OL()),
        )
    )
    assert items == []
    assert calls == ["isbn:9781"]


def test_select_openlibrary_cover_sets_override_when_global_cover_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()

    item = LibraryItem(
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=None,
        status="to_read",
        visibility="private",
        rating=None,
        tags=None,
    )
    session.scalar_values = [item]
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url="https://example.supabase.co/storage/v1/object/public/covers/existing.jpg",
    )

    async def fake_cache_cover_to_storage(**_kwargs: Any) -> StorageUploadResult:
        return StorageUploadResult(
            public_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/abc.jpg",
            bucket="covers",
            path="openlibrary/abc.jpg",
        )

    monkeypatch.setattr(
        work_covers, "cache_cover_to_storage", fake_cache_cover_to_storage
    )

    result = asyncio.run(
        select_openlibrary_cover(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=user_id,
            work_id=work_id,
            cover_id=123,
        )
    )

    assert result["scope"] == "override"
    assert item.cover_override_url is not None
    assert session.committed is True


def test_select_cover_from_url_rejects_blank_source_url() -> None:
    session = FakeSession()
    with pytest.raises(ValueError):
        asyncio.run(
            select_cover_from_url(
                session,  # type: ignore[arg-type]
                settings=_settings(),
                user_id=uuid.uuid4(),
                work_id=uuid.uuid4(),
                source_url="   ",
            )
        )


def test_select_cover_from_url_requires_library_item() -> None:
    session = FakeSession()
    with pytest.raises(PermissionError):
        asyncio.run(
            select_cover_from_url(
                session,  # type: ignore[arg-type]
                settings=_settings(),
                user_id=uuid.uuid4(),
                work_id=uuid.uuid4(),
                source_url="https://example.com/cover.jpg",
            )
        )


def test_select_cover_from_url_raises_when_work_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    item = LibraryItem(
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=None,
        status="to_read",
        visibility="private",
        rating=None,
        tags=None,
    )
    # item lookup, any_edition_cover lookup, latest edition lookup
    session.scalar_values = [item, None, None]

    async def fake_cache_cover_to_storage(**_kwargs: Any) -> StorageUploadResult:
        return StorageUploadResult(
            public_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
            bucket="covers",
            path="openlibrary/x.jpg",
        )

    monkeypatch.setattr(
        work_covers, "cache_cover_to_storage", fake_cache_cover_to_storage
    )

    with pytest.raises(LookupError):
        asyncio.run(
            select_cover_from_url(
                session,  # type: ignore[arg-type]
                settings=_settings(),
                user_id=user_id,
                work_id=work_id,
                source_url="https://example.com/cover.jpg",
            )
        )


def test_select_openlibrary_cover_sets_global_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()

    item = LibraryItem(
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=edition_id,
        status="to_read",
        visibility="private",
        rating=None,
        tags=None,
    )
    # First scalar: find item, then global cover check queries any edition cover -> None
    session.scalar_values = [item, None]
    session.get_map[(Work, work_id)] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )

    async def fake_cache_edition_cover_from_url(
        *_args: Any, **_kwargs: Any
    ) -> CoverCacheResult:
        return CoverCacheResult(
            cached=True,
            cover_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
            storage=StorageUploadResult(
                public_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
                bucket="covers",
                path="openlibrary/x.jpg",
            ),
        )

    monkeypatch.setattr(
        work_covers, "cache_edition_cover_from_url", fake_cache_edition_cover_from_url
    )

    result = asyncio.run(
        select_openlibrary_cover(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=user_id,
            work_id=work_id,
            cover_id=10,
        )
    )
    assert result["scope"] == "global"
    assert result["cover_url"] is not None


def test_select_openlibrary_cover_sets_global_on_work_when_no_edition_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()

    item = LibraryItem(
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=None,
        status="to_read",
        visibility="private",
        rating=None,
        tags=None,
    )
    # scalar sequence:
    # - find item
    # - _work_has_global_cover -> any_edition_cover -> None
    # - edition lookup for latest edition -> None
    session.scalar_values = [item, None, None]
    work = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map[(Work, work_id)] = work

    async def fake_cache_cover_to_storage(**_kwargs: Any) -> StorageUploadResult:
        return StorageUploadResult(
            public_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
            bucket="covers",
            path="openlibrary/x.jpg",
        )

    monkeypatch.setattr(
        work_covers, "cache_cover_to_storage", fake_cache_cover_to_storage
    )

    result = asyncio.run(
        select_openlibrary_cover(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=user_id,
            work_id=work_id,
            cover_id=1,
        )
    )
    assert result["scope"] == "global"
    assert work.default_cover_url is not None
    assert session.committed is True
