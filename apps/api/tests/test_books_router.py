from __future__ import annotations

import uuid
from collections.abc import Generator
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.books import get_open_library_client
from app.routers.books import router as books_router
from app.services.open_library import (
    OpenLibrarySearchResponse,
    OpenLibrarySearchResult,
    OpenLibraryWorkBundle,
)


class FakeOpenLibrary:
    async def search_books(
        self, *, query: str, limit: int, page: int
    ) -> OpenLibrarySearchResponse:
        return OpenLibrarySearchResponse(
            items=[
                OpenLibrarySearchResult(
                    work_key="/works/OL1W",
                    title=query,
                    author_names=["A"],
                    first_publish_year=2000,
                    cover_url=None,
                )
            ],
            query=query,
            limit=limit,
            page=page,
            num_found=22,
            has_more=True,
            next_page=2,
            cache_hit=True,
        )

    async def fetch_work_bundle(
        self, *, work_key: str, edition_key: str | None
    ) -> OpenLibraryWorkBundle:
        return OpenLibraryWorkBundle(
            work_key=work_key,
            title="Book",
            description=None,
            first_publish_year=2000,
            cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            authors=[],
            edition=None,
            raw_work={},
            raw_edition=None,
        )


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(books_router)

    user_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    app.dependency_overrides[require_auth_context] = lambda: AuthContext(
        claims={},
        client_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        user_id=user_id,
    )
    app.dependency_overrides[enforce_client_user_rate_limit] = lambda: None

    def _fake_session() -> Generator[object, None, None]:
        yield object()

    app.dependency_overrides[get_db_session] = _fake_session
    app.dependency_overrides[get_open_library_client] = lambda: FakeOpenLibrary()
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )

    monkeypatch.setattr(
        "app.routers.books.import_openlibrary_bundle",
        lambda *_args, **_kwargs: {"edition": {"id": str(uuid.uuid4())}},
    )

    async def _fake_cache(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return SimpleNamespace(cover_url="cached")

    monkeypatch.setattr(
        "app.routers.books.cache_edition_cover_from_url",
        _fake_cache,
    )

    async def _fake_manual(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {"work": {"id": str(uuid.uuid4())}}

    monkeypatch.setattr(
        "app.routers.books.create_manual_book",
        _fake_manual,
    )

    yield app


def test_search_books(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/books/search", params={"query": "q"})
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["items"][0]["title"] == "q"
    assert payload["next_page"] == 2
    assert payload["has_more"] is True
    assert payload["num_found"] == 22


def test_get_open_library_client_constructs_client() -> None:
    client = get_open_library_client()
    assert client is not None


def test_import_book(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post("/api/v1/books/import", json={"work_key": "/works/OL1W"})
    assert response.status_code == 200


def test_create_manual_book(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/books/manual",
        data={"title": "T", "authors_json": '["A"]'},
    )
    assert response.status_code == 200


def test_create_manual_book_rejects_invalid_authors_json(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/books/manual",
        data={"title": "T", "authors_json": "not-json"},
    )
    assert response.status_code == 400


def test_create_manual_book_rejects_non_list_authors(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/books/manual",
        data={"title": "T", "authors_json": '{"a":1}'},
    )
    assert response.status_code == 400


def test_search_books_returns_502_on_open_library_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    class BrokenOpenLibrary(FakeOpenLibrary):
        async def search_books(
            self, *, query: str, limit: int, page: int
        ) -> OpenLibrarySearchResponse:
            raise httpx.ConnectError(
                "down",
                request=httpx.Request("GET", "https://openlibrary.org/search.json"),
            )

    app.dependency_overrides[get_open_library_client] = lambda: BrokenOpenLibrary()
    client = TestClient(app)
    response = client.get("/api/v1/books/search", params={"query": "q"})
    assert response.status_code == 502


def test_import_book_returns_400_and_404_for_domain_errors(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)

    monkeypatch.setattr(
        "app.routers.books.import_openlibrary_bundle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    response = client.post("/api/v1/books/import", json={"work_key": "/works/OL1W"})
    assert response.status_code == 400

    monkeypatch.setattr(
        "app.routers.books.import_openlibrary_bundle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    response = client.post("/api/v1/books/import", json={"work_key": "/works/OL1W"})
    assert response.status_code == 404


def test_import_book_does_not_fail_when_cover_cache_errors(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.books.cache_edition_cover_from_url",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    client = TestClient(app)
    response = client.post("/api/v1/books/import", json={"work_key": "/works/OL1W"})
    assert response.status_code == 200


def test_create_manual_book_reads_cover_and_handles_value_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/books/manual",
        data={"title": "T", "authors_json": '["A"]'},
        files={"cover": ("c.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 200

    async def fake_manual_error(*_args: Any, **_kwargs: Any) -> dict[str, object]:
        raise ValueError("bad")

    monkeypatch.setattr("app.routers.books.create_manual_book", fake_manual_error)
    response = client.post(
        "/api/v1/books/manual",
        data={"title": "T", "authors_json": '["A"]'},
    )
    assert response.status_code == 400
