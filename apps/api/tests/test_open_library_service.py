from __future__ import annotations

import asyncio
from collections.abc import Generator

import httpx
import pytest

from app.services.open_library import (
    OpenLibraryClient,
    _extract_language_codes,
    _normalize_edition_key,
    _normalize_work_key,
    _parse_publish_year,
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
    seen_params: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls["count"] += 1
        seen_params.append(dict(request.url.params))
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
    assert first.items[0].edition_count is None
    assert first.items[0].languages == []
    assert first.items[0].readable is False
    assert seen_params[0]["q"] == "title:book"
    assert "sort" not in seen_params[0]
    assert "fields" in seen_params[0]


def test_search_books_supports_fielded_filters() -> None:
    seen_params: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_params.append(dict(request.url.params))
        return httpx.Response(
            200,
            json={
                "docs": [
                    {
                        "key": "/works/OL1W",
                        "title": "Book A",
                        "language": ["eng", "deu"],
                        "edition_count": 7,
                        "has_fulltext": True,
                    }
                ]
            },
        )

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    result = asyncio.run(
        client.search_books(
            query="book",
            author="Author A",
            subject="Fantasy",
            language="eng",
            first_publish_year_from=1990,
            first_publish_year_to=2005,
            sort="new",
        )
    )

    assert result.items[0].edition_count == 7
    assert result.items[0].languages == ["eng", "deu"]
    assert result.items[0].readable is True
    assert seen_params[0]["sort"] == "new"
    assert "author:Author A" in seen_params[0]["q"]
    assert "subject:Fantasy" in seen_params[0]["q"]
    assert "language:eng" in seen_params[0]["q"]
    assert "first_publish_year:[1990 TO *]" in seen_params[0]["q"]
    assert "first_publish_year:[* TO 2005]" in seen_params[0]["q"]


def test_fetch_work_bundle_collects_author_and_first_edition() -> None:
    responses = {
        "/works/OL1W.json": {
            "title": "Book A",
            "authors": [{"author": {"key": "/authors/OL2A"}}],
            "covers": [12],
        },
        "/authors/OL2A.json": {"name": "Author A"},
        "/works/OL1W/editions.json": {
            "entries": [{"key": "/books/OL3M", "isbn_10": ["1234567890"]}]
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


def test_fetch_work_bundle_scores_and_selects_best_edition() -> None:
    responses = {
        "/works/OL1W.json": {
            "title": "Book",
            "authors": [],
            "covers": [],
        },
        "/works/OL1W/editions.json": {
            "entries": [
                {"key": "/books/OL1M", "isbn_10": ["123"], "publish_date": "1990"},
                {
                    "key": "/books/OL2M",
                    "isbn_13": ["9781234567890"],
                    "isbn_10": ["123"],
                    "publishers": ["Pub"],
                    "publish_date": "2001-01-01",
                    "covers": [9],
                    "languages": [{"key": "/languages/eng"}],
                    "physical_format": "Paperback",
                },
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
    assert bundle.edition is not None
    assert bundle.edition["key"] == "/books/OL2M"
    assert bundle.edition["language"] == "eng"
    assert bundle.edition["format"] == "Paperback"
    assert bundle.edition["publish_date_iso"] is not None


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
    assert _normalize_edition_key("/books/OL1M") == "/books/OL1M"
    with pytest.raises(ValueError):
        _normalize_work_key("bad-key")
    with pytest.raises(ValueError):
        _normalize_edition_key("bad-key")


def test_language_and_year_parsing_helpers_cover_edge_cases() -> None:
    assert _extract_language_codes(
        [{"code": "ENG"}, " eng ", {"key": "/languages/deu"}]
    ) == [
        "eng",
        "deu",
    ]
    assert _parse_publish_year(12000) is None
    assert _parse_publish_year("no-year-here") is None


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


def test_fetch_related_works_uses_subjects_and_dedupes() -> None:
    responses = {
        "/subjects/fantasy.json": {
            "works": [
                {"key": "/works/OL1W", "title": "One", "cover_id": 1},
                {
                    "key": "/works/OL2W",
                    "title": "Two",
                    "cover_id": 2,
                    "authors": [{"name": "Author Two"}],
                },
            ]
        },
        "/subjects/fiction.json": {
            "works": [
                {"key": "/works/OL2W", "title": "Two", "cover_id": 2},
                {
                    "key": "/works/OL3W",
                    "title": "Three",
                    "cover_id": 3,
                    "authors": [{"name": "Author Three"}, {"name": "Author Four"}],
                },
            ]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    related = asyncio.run(
        client.fetch_related_works(
            work_payload={"subjects": ["Fantasy", "Fiction"]},
            exclude_work_key="/works/OL1W",
        )
    )
    assert [item.work_key for item in related] == ["/works/OL2W", "/works/OL3W"]
    assert related[0].author_names == ["Author Two"]
    assert related[1].author_names == ["Author Three", "Author Four"]


def test_fetch_related_works_skips_items_without_cover() -> None:
    responses = {
        "/subjects/fantasy.json": {
            "works": [
                {"key": "/works/OL2W", "title": "No Cover"},
                {"key": "/works/OL3W", "title": "Has Cover", "cover_id": 33},
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    related = asyncio.run(
        client.fetch_related_works(
            work_payload={"subjects": ["Fantasy"]},
            exclude_work_key="/works/OL1W",
        )
    )
    assert [item.work_key for item in related] == ["/works/OL3W"]


def test_fetch_related_works_prefers_same_language_when_available() -> None:
    responses = {
        "/subjects/fantasy.json": {
            "works": [
                {
                    "key": "/works/OL2W",
                    "title": "English Match",
                    "cover_id": 21,
                    "language": ["eng"],
                },
                {
                    "key": "/works/OL3W",
                    "title": "Spanish",
                    "cover_id": 22,
                    "language": ["spa"],
                },
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    related = asyncio.run(
        client.fetch_related_works(
            work_payload={
                "subjects": ["Fantasy"],
                "languages": [{"key": "/languages/eng"}],
            },
            exclude_work_key="/works/OL1W",
        )
    )
    assert [item.work_key for item in related] == ["/works/OL2W"]


def test_fetch_related_works_falls_back_when_no_language_match() -> None:
    responses = {
        "/subjects/fantasy.json": {
            "works": [
                {
                    "key": "/works/OL2W",
                    "title": "Spanish",
                    "cover_id": 22,
                    "language": ["spa"],
                }
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    related = asyncio.run(
        client.fetch_related_works(
            work_payload={
                "subjects": ["Fantasy"],
                "languages": [{"key": "/languages/eng"}],
            },
            exclude_work_key="/works/OL1W",
        )
    )
    assert [item.work_key for item in related] == ["/works/OL2W"]


def test_fetch_author_profile() -> None:
    responses = {
        "/authors/OL1A.json": {"name": "Author A", "bio": "Bio", "photos": [12]},
        "/authors/OL1A/works.json": {
            "entries": [{"key": "/works/OL1W", "title": "Book", "covers": [99]}]
        },
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    profile = asyncio.run(client.fetch_author_profile(author_key="/authors/OL1A"))
    assert profile.author_key == "/authors/OL1A"
    assert profile.name == "Author A"
    assert profile.photo_url == "https://covers.openlibrary.org/a/id/12-M.jpg"
    assert profile.top_works[0].work_key == "/works/OL1W"


def test_fetch_work_audiobook_durations_filters_audio_entries() -> None:
    responses = {
        "/works/OL1W/editions.json": {
            "entries": [
                {"physical_format": "Audio CD", "duration": "10:30:00"},
                {"format": "Hardcover", "duration": "5:00:00"},
                {"title": "Book (audiobook)", "duration": "8 hours"},
                {"physical_format": "MP3 CD", "duration": "630 minutes"},
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    durations = asyncio.run(client.fetch_work_audiobook_durations(work_key="OL1W"))
    assert durations == [630, 480]


def test_fetch_work_audiobook_durations_handles_missing_entries() -> None:
    responses = {"/works/OL1W/editions.json": {"entries": "invalid"}}

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    durations = asyncio.run(client.fetch_work_audiobook_durations(work_key="OL1W"))
    assert durations == []


def test_fetch_work_audiobook_durations_reads_duration_seconds_from_edition_notes() -> (
    None
):
    responses = {
        "/works/OL1W/editions.json": {
            "entries": [
                {"key": "/books/OLA1M", "physical_format": "Audible eAudiobook"}
            ]
        },
        "/books/OLA1M.json": {"notes": "Edition notes: Duration in seconds: 3723"},
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    durations = asyncio.run(client.fetch_work_audiobook_durations(work_key="OL1W"))
    assert durations == [pytest.approx(62.05)]


def test_fetch_work_audiobook_durations_parses_comma_separated_seconds() -> None:
    responses = {
        "/works/OL1W/editions.json": {
            "entries": [
                {
                    "physical_format": "Audible eAudiobook",
                    "duration": "103,284 seconds",
                }
            ]
        }
    }

    def handler(request: httpx.Request) -> httpx.Response:
        payload = responses.get(request.url.path)
        if payload is None:
            return httpx.Response(404, json={"error": "missing"})
        return httpx.Response(200, json=payload)

    client = OpenLibraryClient(transport=httpx.MockTransport(handler))
    durations = asyncio.run(client.fetch_work_audiobook_durations(work_key="OL1W"))
    assert durations == [pytest.approx(1721.4)]
