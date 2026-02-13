from __future__ import annotations

import asyncio
import datetime as dt

import httpx

from app.services.google_books import GoogleBooksClient


def test_google_books_search_parses_results() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/volumes")
        return httpx.Response(
            200,
            json={
                "totalItems": 1,
                "items": [
                    {
                        "id": "gb1",
                        "volumeInfo": {
                            "title": "Book",
                            "authors": ["A"],
                            "publishedDate": "2001-01-01",
                            "language": "en",
                            "imageLinks": {"thumbnail": "http://example.com/cover.jpg"},
                            "canonicalVolumeLink": "https://books.google.com/gb1",
                        },
                        "accessInfo": {"viewability": "PARTIAL"},
                    }
                ],
            },
        )

    client = GoogleBooksClient(
        api_key="k",
        transport=httpx.MockTransport(handler),
    )
    response = asyncio.run(client.search_books(query="book", limit=10, page=1))
    assert response.items[0].volume_id == "gb1"
    assert response.items[0].cover_url == "https://example.com/cover.jpg"
    assert response.items[0].readable is True


def test_google_books_fetch_work_bundle_parses_edition() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/volumes/gb1")
        return httpx.Response(
            200,
            json={
                "id": "gb1",
                "volumeInfo": {
                    "title": "Book",
                    "authors": ["A"],
                    "description": "D",
                    "publishedDate": "2004-10-09",
                    "publisher": "P",
                    "language": "en",
                    "printType": "BOOK",
                    "industryIdentifiers": [
                        {"type": "ISBN_10", "identifier": "0123456789"},
                        {"type": "ISBN_13", "identifier": "9780123456789"},
                    ],
                    "imageLinks": {"thumbnail": "http://example.com/cover.jpg"},
                    "infoLink": "https://books.google.com/gb1",
                },
            },
        )

    client = GoogleBooksClient(
        api_key="k",
        transport=httpx.MockTransport(handler),
    )
    bundle = asyncio.run(client.fetch_work_bundle(volume_id="gb1"))
    assert bundle.volume_id == "gb1"
    assert bundle.first_publish_year == 2004
    assert bundle.cover_url == "https://example.com/cover.jpg"
    assert bundle.edition is not None
    assert bundle.edition["isbn10"] == "0123456789"
    assert bundle.edition["isbn13"] == "9780123456789"
    assert bundle.edition["publish_date_iso"] == dt.date(2004, 10, 9)


def test_google_books_search_empty_query_returns_empty() -> None:
    client = GoogleBooksClient(api_key="k")
    response = asyncio.run(client.search_books(query="   ", limit=10, page=1))
    assert response.items == []
    assert response.has_more is False


def test_google_books_search_filters_and_handles_missing_fields() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "totalItems": 3,
                "items": [
                    {"id": "missing-volume-info"},
                    {
                        "id": "filtered-year",
                        "volumeInfo": {
                            "title": "Old Book",
                            "publishedDate": "1990",
                        },
                    },
                    {
                        "id": "kept",
                        "volumeInfo": {
                            "title": "Book",
                            "authors": ["A", 1],
                            "publishedDate": "2005",
                            "language": "EN",
                        },
                        "accessInfo": {"viewability": "NO_PAGES"},
                    },
                ],
            },
        )

    client = GoogleBooksClient(api_key="k", transport=httpx.MockTransport(handler))
    response = asyncio.run(
        client.search_books(
            query="book",
            limit=10,
            page=1,
            first_publish_year_from=2000,
            first_publish_year_to=2010,
            sort="new",
        )
    )
    assert len(response.items) == 1
    assert response.items[0].volume_id == "kept"
    assert response.items[0].readable is False
    assert response.items[0].language == "en"


def test_google_books_fetch_work_bundle_handles_sparse_fields() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "gb2",
                "volumeInfo": {
                    "title": "Book",
                    "publishedDate": "2004",
                    "industryIdentifiers": [
                        {"type": "ISBN_13", "identifier": "9780123456789"}
                    ],
                },
            },
        )

    client = GoogleBooksClient(api_key="k", transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(volume_id="gb2"))
    assert bundle.first_publish_year == 2004
    assert bundle.edition is not None
    assert bundle.edition["isbn13"] == "9780123456789"
    assert bundle.edition["publish_date_iso"] is None


def test_google_books_search_raises_on_non_object_payload() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=[{"id": "not-an-object"}])

    client = GoogleBooksClient(api_key="k", transport=httpx.MockTransport(handler))
    try:
        asyncio.run(client.search_books(query="book", limit=10, page=1))
    except RuntimeError as exc:
        assert "non-object payload" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_google_books_fetch_work_bundle_validates_inputs_and_required_fields() -> None:
    client = GoogleBooksClient(api_key="k")
    try:
        asyncio.run(client.fetch_work_bundle(volume_id="   "))
    except ValueError as exc:
        assert "volume_id is required" in str(exc)
    else:
        raise AssertionError("expected ValueError")

    async def missing_volume_info(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "gb3"})

    client_missing_volume = GoogleBooksClient(
        api_key="k",
        transport=httpx.MockTransport(missing_volume_info),
    )
    try:
        asyncio.run(client_missing_volume.fetch_work_bundle(volume_id="gb3"))
    except LookupError as exc:
        assert "volumeInfo" in str(exc)
    else:
        raise AssertionError("expected LookupError")


def test_google_books_fetch_work_bundle_without_optional_metadata() -> None:
    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "id": "gb5",
                "volumeInfo": {
                    "title": "Book",
                    "canonicalVolumeLink": "https://books.google.com/gb5",
                },
            },
        )

    client = GoogleBooksClient(api_key="k", transport=httpx.MockTransport(handler))
    bundle = asyncio.run(client.fetch_work_bundle(volume_id="gb5"))
    assert bundle.edition is None
    assert bundle.attribution_url == "https://books.google.com/gb5"


def test_google_books_search_includes_author_and_subject_filters() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        query = request.url.params.get("q", "")
        assert "inauthor:Rowling" in query
        assert "subject:Fantasy" in query
        return httpx.Response(200, json={"totalItems": 0, "items": []})

    client = GoogleBooksClient(api_key="k", transport=httpx.MockTransport(handler))
    response = asyncio.run(
        client.search_books(
            query="harry",
            limit=10,
            page=1,
            author="Rowling",
            subject="Fantasy",
            language="eng",
            sort="new",
        )
    )
    assert response.items == []

    async def missing_title(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "gb4", "volumeInfo": {}})

    client_missing_title = GoogleBooksClient(
        api_key="k",
        transport=httpx.MockTransport(missing_title),
    )
    try:
        asyncio.run(client_missing_title.fetch_work_bundle(volume_id="gb4"))
    except LookupError as exc:
        assert "missing title" in str(exc)
    else:
        raise AssertionError("expected LookupError")
