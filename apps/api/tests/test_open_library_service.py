from __future__ import annotations

import asyncio
from collections.abc import Generator

import httpx
import pytest

from app.services.open_library import (
    OpenLibraryClient,
    _normalize_edition_key,
    _normalize_work_key,
)


@pytest.fixture(autouse=True)
def no_sleep(monkeypatch: pytest.MonkeyPatch) -> Generator[None, None, None]:
    async def _fake_sleep(_: float) -> None:
        return None

    monkeypatch.setattr("app.services.open_library.asyncio.sleep", _fake_sleep)
    yield


def test_search_books_uses_user_agent_and_cache() -> None:
    seen_user_agents: list[str] = []
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        ua = request.headers.get("User-Agent")
        if ua:
            seen_user_agents.append(ua)
        return httpx.Response(
            200,
            json={
                "docs": [
                    {
                        "key": "/works/OL1W",
                        "title": "Book A",
                        "author_name": ["Author A"],
                        "first_publish_year": 1999,
                        "cover_i": 100,
                    }
                ]
            },
        )

    client = OpenLibraryClient(
        user_agent="SeedbedTest/1.0 (dev@example.com)",
        transport=httpx.MockTransport(handler),
    )

    first = asyncio.run(client.search_books(query="book", limit=5, page=1))
    second = asyncio.run(client.search_books(query="book", limit=5, page=1))

    assert calls["count"] == 1
    assert seen_user_agents == ["SeedbedTest/1.0 (dev@example.com)"]
    assert first.cache_hit is False
    assert second.cache_hit is True
    assert first.query == "book"
    assert first.limit == 5
    assert first.page == 1
    assert first.num_found is None
    assert first.has_more is False
    assert first.next_page is None
    assert first.items[0].title == "Book A"


def test_fetch_work_bundle_collects_author_and_first_edition() -> None:
    responses = {
        "/works/OL1W.json": {
            "title": "Book A",
            "authors": [{"author": {"key": "/authors/OL2A"}}],
            "covers": [12],
        },
        "/authors/OL2A.json": {"name": "Author A"},
        "/works/OL1W/editions.json": {
            "entries": [
                {"key": "/books/OL3M", "isbn_10": ["1234567890"], "publishers": ["Pub"]}
            ]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(work_key="OL1W"))

    assert bundle.work_key == "/works/OL1W"
    assert bundle.title == "Book A"
    assert bundle.authors == [{"key": "/authors/OL2A", "name": "Author A"}]
    assert bundle.edition is not None
    assert bundle.edition["key"] == "/books/OL3M"
    assert bundle.cover_url == "https://covers.openlibrary.org/b/id/12-L.jpg"


def test_fetch_work_bundle_falls_back_to_edition_cover_when_work_missing() -> None:
    requests: list[str] = []
    responses = {
        "/works/OL1W.json": {"title": "Book", "authors": [], "covers": []},
        "/works/OL1W/editions.json": {"entries": [{"key": "/books/OL3M"}]},
        "/books/OL3M.json": {"covers": [99], "isbn_10": ["123"], "publishers": ["Pub"]},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(work_key="OL1W"))

    assert bundle.edition is not None
    assert bundle.edition["key"] == "/books/OL3M"
    assert bundle.cover_url == "https://covers.openlibrary.org/b/id/99-L.jpg"
    assert "/books/OL3M.json" in requests


def test_request_retries_on_5xx() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(503, json={"message": "retry"})
        return httpx.Response(200, json={"docs": []})

    client = OpenLibraryClient(transport=httpx.MockTransport(handler), max_retries=2)
    result = asyncio.run(client.search_books(query="retry"))

    assert calls["count"] == 2
    assert result.items == []


def test_request_retries_on_429_respects_retry_after_header() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            return httpx.Response(
                429,
                headers={"Retry-After": "1"},
                json={"message": "rate limited"},
            )
        return httpx.Response(200, json={"docs": []})

    client = OpenLibraryClient(transport=httpx.MockTransport(handler), max_retries=2)
    result = asyncio.run(client.search_books(query="retry-429"))

    assert calls["count"] == 2
    assert result.items == []


def test_request_does_not_retry_on_4xx_other_than_429() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        return httpx.Response(404, json={"message": "not found"})

    client = OpenLibraryClient(transport=httpx.MockTransport(handler), max_retries=5)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(client.search_books(query="no-retry"))

    assert calls["count"] == 1


def test_request_retries_on_timeout() -> None:
    calls = {"count": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        if calls["count"] == 1:
            raise httpx.ReadTimeout("timed out", request=request)
        return httpx.Response(200, json={"docs": []})

    client = OpenLibraryClient(transport=httpx.MockTransport(handler), max_retries=2)
    result = asyncio.run(client.search_books(query="retry-timeout"))

    assert calls["count"] == 2
    assert result.items == []


def test_normalize_keys() -> None:
    assert _normalize_work_key("OL1W") == "/works/OL1W"
    assert _normalize_work_key("/works/OL1W") == "/works/OL1W"
    assert _normalize_edition_key("OL1M") == "/books/OL1M"
    with pytest.raises(ValueError):
        _normalize_work_key("bad-key")
    with pytest.raises(ValueError):
        _normalize_edition_key("bad-key")


def test_fetch_work_bundle_with_explicit_edition_and_description_object() -> None:
    responses = {
        "/works/OL1W.json": {
            "title": "Book A",
            "description": {"value": "Desc"},
            "authors": [],
            "covers": [],
        },
        "/books/OL3M.json": {
            "isbn_13": ["9999999999999"],
            "publish_date": "2020",
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    bundle = asyncio.run(
        client.fetch_work_bundle(work_key="/works/OL1W", edition_key="OL3M")
    )
    assert bundle.description == "Desc"
    assert bundle.edition is not None
    assert bundle.edition["key"] == "/books/OL3M"
    assert bundle.edition["isbn13"] == "9999999999999"


def test_request_raises_after_retry_exhausted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "still failing"})

    client = OpenLibraryClient(transport=httpx.MockTransport(handler), max_retries=2)
    with pytest.raises(httpx.HTTPStatusError):
        asyncio.run(client.search_books(query="boom"))


def test_search_books_filters_invalid_docs() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "docs": [
                    "not-a-dict",
                    {"key": "/works/OL1W"},  # missing title
                    {"title": "No key"},
                    {"key": "/works/OL2W", "title": "Ok", "cover_i": "nope"},
                ]
            },
        )

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(client.search_books(query="q"))
    assert [item.work_key for item in result.items] == ["/works/OL2W"]
    assert result.items[0].cover_url is None


def test_search_books_sets_num_found_and_next_page_from_total() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "numFound": 13,
                "docs": [
                    {"key": "/works/OL1W", "title": "One"},
                    {"key": "/works/OL2W", "title": "Two"},
                    {"key": "/works/OL3W", "title": "Three"},
                    {"key": "/works/OL4W", "title": "Four"},
                    {"key": "/works/OL5W", "title": "Five"},
                ],
            },
        )

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(client.search_books(query="q", limit=5, page=2))
    assert result.num_found == 13
    assert result.has_more is True
    assert result.next_page == 3


def test_search_books_uses_short_page_fallback_when_total_missing() -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "docs": [
                    {"key": "/works/OL1W", "title": "One"},
                    {"key": "/works/OL2W", "title": "Two"},
                ]
            },
        )

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(client.search_books(query="q", limit=5, page=1))
    assert result.num_found is None
    assert result.has_more is False
    assert result.next_page is None


def test_fetch_work_bundle_handles_missing_editions_and_description_string() -> None:
    responses = {
        "/works/OL1W.json": {
            "title": "Book A",
            "description": "Desc",
            "authors": [],
            "covers": [],
        },
        "/works/OL1W/editions.json": {"entries": []},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(work_key="OL1W"))
    assert bundle.description == "Desc"
    assert bundle.edition is None


def test_fetch_work_bundle_parses_edition_fields_defensively() -> None:
    responses = {
        "/works/OL1W.json": {"title": "Book", "authors": [], "covers": []},
        "/works/OL1W/editions.json": {
            "entries": [{"key": "/books/OL3M", "isbn_10": "nope", "publishers": "nope"}]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(work_key="OL1W"))
    assert bundle.edition is not None
    assert bundle.edition["isbn10"] is None
    assert bundle.edition["publisher"] is None


def test_fetch_cover_ids_for_work_prefers_work_payload() -> None:
    requests: list[str] = []

    responses = {
        "/works/OL1W.json": {"title": "Book", "authors": [], "covers": [10, 11, 10]},
        "/works/OL1W/editions.json": {"entries": [{"covers": [1, 2, 3]}]},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request.url.path)
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    cover_ids = asyncio.run(client.fetch_cover_ids_for_work(work_key="OL1W"))
    assert cover_ids == [10, 11]
    assert "/works/OL1W.json" in requests


def test_fetch_cover_ids_for_work_falls_back_to_editions() -> None:
    responses = {
        "/works/OL1W.json": {"title": "Book", "authors": [], "covers": []},
        "/works/OL1W/editions.json": {
            "entries": [
                {"covers": [1, 2, 2]},
                {"covers": [3]},
                {"covers": ["nope", 4]},
                "not-a-dict",
            ]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    cover_ids = asyncio.run(
        client.fetch_cover_ids_for_work(work_key="/works/OL1W", editions_limit=50)
    )
    assert cover_ids == [1, 2, 3, 4]


def test_fetch_cover_ids_for_work_returns_empty_when_entries_invalid() -> None:
    responses = {
        "/works/OL1W.json": {"title": "Book", "authors": [], "covers": []},
        "/works/OL1W/editions.json": {"entries": "nope"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    cover_ids = asyncio.run(client.fetch_cover_ids_for_work(work_key="OL1W"))
    assert cover_ids == []
