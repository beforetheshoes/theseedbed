from __future__ import annotations

import uuid
from collections.abc import Generator
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.works import (
    _author_match_score,
    _build_cover_metadata_compare_payload,
    _collect_google_source_tiles,
    _current_field_values_for_compare,
    _ensure_openlibrary_work_mapping,
    _extract_source_authors,
    _extract_source_cover,
    _extract_source_identifier,
    _extract_source_language,
    _extract_source_publish_date,
    _extract_source_publisher,
    _extract_source_title,
    _first_author_for_lookup,
    _first_string,
    _google_books_enabled_for_user,
    _has_selected_value,
    _normalize_text_tokens,
    _openlibrary_edition_raw_has_compare_fields,
    _parse_google_selected_values,
    _parse_openlibrary_cover_url,
    _parse_openlibrary_description,
    _parse_openlibrary_first_publish_year,
    _parse_openlibrary_selected_values,
    _resolve_edition_target_for_compare,
    _resolve_effective_languages,
    _resolve_openlibrary_work_key_for_source,
    _selected_values_from_google_bundle,
    _selected_values_from_openlibrary_bundle,
    _tile_sort_key,
    _title_match_score,
    _upsert_source_record,
    _work_authors_for_lookup,
    _work_title_for_lookup,
    get_google_books_client,
    get_open_library_client,
)
from app.routers.works import router as works_router
from app.services.google_books import GoogleBooksWorkBundle
from app.services.open_library import OpenLibraryWorkBundle
from app.services.storage import StorageNotConfiguredError


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(works_router)

    user_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    app.dependency_overrides[require_auth_context] = lambda: AuthContext(
        claims={},
        client_id=None,
        user_id=user_id,
    )

    def _fake_session() -> Generator[object, None, None]:
        yield object()

    app.dependency_overrides[get_db_session] = _fake_session
    app.dependency_overrides[get_open_library_client] = lambda: object()
    app.dependency_overrides[get_google_books_client] = lambda: object()
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
        "app.routers.works.get_work_detail",
        lambda *_args, **_kwargs: {"id": str(uuid.uuid4()), "title": "Book"},
    )
    monkeypatch.setattr(
        "app.routers.works.list_work_editions",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )

    async def _fake_refresh(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr("app.routers.works.refresh_work_if_stale", _fake_refresh)

    async def _fake_related(
        *_args: object, **_kwargs: object
    ) -> list[dict[str, object]]:
        return [
            {
                "work_key": "/works/OL1W",
                "title": "Related",
                "cover_url": None,
                "author_names": ["Author A"],
            }
        ]

    monkeypatch.setattr("app.routers.works.list_related_works", _fake_related)

    async def _fake_list_covers(
        *_args: object, **_kwargs: object
    ) -> list[dict[str, object]]:
        return [
            {
                "source": "openlibrary",
                "source_id": "1",
                "cover_id": 1,
                "thumbnail_url": "t",
                "image_url": "i",
                "source_url": "i",
            }
        ]

    monkeypatch.setattr(
        "app.routers.works.list_openlibrary_cover_candidates",
        _fake_list_covers,
    )
    monkeypatch.setattr(
        "app.routers.works.list_googlebooks_cover_candidates",
        lambda *_args, **_kwargs: [],
    )
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: type("Profile", (), {"enable_google_books": False})(),
    )

    async def _fake_select(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"scope": "override", "cover_url": "https://example.com/x.jpg"}

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _fake_select)
    monkeypatch.setattr("app.routers.works.select_cover_from_url", _fake_select)

    yield app


def test_get_work(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}")
    assert response.status_code == 200


def test_get_open_library_client_constructs_client() -> None:
    client = get_open_library_client()
    assert client is not None


def test_get_google_books_client_constructs_client() -> None:
    client = get_google_books_client(
        Settings(
            supabase_url="https://example.supabase.co",
            supabase_jwt_audience="authenticated",
            supabase_jwt_secret=None,
            supabase_jwks_cache_ttl_seconds=60,
            supabase_service_role_key="service-role",
            supabase_storage_covers_bucket="covers",
            public_highlight_max_chars=280,
            google_books_api_key="test-key",
            api_version="0.1.0",
        )
    )
    assert client is not None


def test_get_work_returns_404(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.routers.works.get_work_detail",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}")
    assert response.status_code == 404


def test_get_work_ignores_refresh_errors(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> None:
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("app.routers.works.refresh_work_if_stale", _boom)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}")
    assert response.status_code == 200


def test_list_editions(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/editions")
    assert response.status_code == 200
    assert isinstance(response.json()["data"]["items"], list)


def test_list_editions_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.works.list_work_editions",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/editions")
    assert response.status_code == 404


def test_list_work_covers(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/covers")
    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["cover_id"] == 1


def test_list_work_covers_returns_502_on_open_library_failure(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("app.routers.works.list_openlibrary_cover_candidates", _boom)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/covers")
    assert response.status_code == 502


def test_list_work_covers_includes_google_candidates_when_enabled(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: type("Profile", (), {"enable_google_books": True})(),
    )

    async def _google(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
        return [
            {
                "source": "googlebooks",
                "source_id": "gb1",
                "thumbnail_url": "https://books.google.com/cover.jpg",
                "image_url": "https://books.google.com/cover.jpg",
                "source_url": "https://books.google.com/cover.jpg",
            }
        ]

    monkeypatch.setattr("app.routers.works.list_googlebooks_cover_candidates", _google)
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        book_provider_google_enabled=True,
        google_books_api_key="test-key",
        api_version="0.1.0",
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/covers")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert any(item.get("source") == "openlibrary" for item in items)
    assert any(item.get("source") == "googlebooks" for item in items)


def test_list_work_covers_ignores_google_failures(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: type("Profile", (), {"enable_google_books": True})(),
    )

    async def _boom(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
        raise httpx.ConnectError("down")

    monkeypatch.setattr("app.routers.works.list_googlebooks_cover_candidates", _boom)
    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        book_provider_google_enabled=True,
        google_books_api_key="test-key",
        api_version="0.1.0",
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/covers")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["source"] == "openlibrary"


def test_related_works(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/related")
    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["title"] == "Related"
    assert response.json()["data"]["items"][0]["author_names"] == ["Author A"]


def test_related_works_returns_502_on_open_library_failure(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> list[dict[str, object]]:
        raise httpx.ConnectError("down")

    monkeypatch.setattr("app.routers.works.list_related_works", _boom)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/related")
    assert response.status_code == 502


def test_select_work_cover(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 200
    assert response.json()["data"]["scope"] in {"global", "override"}


def test_select_work_cover_from_source_url(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select",
        json={"source_url": "https://books.google.com/cover.jpg"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["scope"] in {"global", "override"}


def test_select_work_cover_rejects_invalid_selector(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select",
        json={},
    )
    assert response.status_code == 422


def test_select_work_cover_returns_403(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _deny(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise PermissionError("nope")

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _deny)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 403


def test_select_work_cover_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise LookupError("missing")

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _missing)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 404


def test_select_work_cover_returns_400(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _invalid(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise ValueError("invalid")

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _invalid)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 400


def test_select_work_cover_returns_502_on_cache_failure(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _boom)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 502


def test_select_work_cover_returns_503_when_storage_not_configured(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise StorageNotConfiguredError("SUPABASE_SERVICE_ROLE_KEY is not configured")

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _boom)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 503
    payload = response.json()
    assert payload["detail"]["code"] == "cover_upload_unavailable"


def test_list_enrichment_candidates(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_candidates(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "work_id": str(uuid.uuid4()),
            "edition_target": {"id": str(uuid.uuid4()), "label": "Edition"},
            "providers": {
                "attempted": ["openlibrary", "googlebooks"],
                "succeeded": ["openlibrary"],
                "failed": [
                    {
                        "provider": "googlebooks",
                        "code": "google_books_unavailable",
                        "message": "down",
                    }
                ],
            },
            "fields": [
                {
                    "field_key": "work.description",
                    "scope": "work",
                    "current_value": "Current",
                    "candidates": [],
                    "has_conflict": False,
                }
            ],
        }

    monkeypatch.setattr("app.routers.works.get_enrichment_candidates", _fake_candidates)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/enrichment/candidates")
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["providers"]["attempted"] == ["openlibrary", "googlebooks"]
    assert data["fields"][0]["field_key"] == "work.description"


def test_list_enrichment_candidates_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise LookupError("missing")

    monkeypatch.setattr("app.routers.works.get_enrichment_candidates", _missing)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/enrichment/candidates")
    assert response.status_code == 404


def test_list_enrichment_candidates_returns_502(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _boom(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise httpx.ConnectError("nope")

    monkeypatch.setattr("app.routers.works.get_enrichment_candidates", _boom)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/enrichment/candidates")
    assert response.status_code == 502


def test_apply_enrichment(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_apply(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "updated": ["work.description"],
            "skipped": [],
            "edition_target": {"id": str(uuid.uuid4()), "label": "Edition"},
        }

    monkeypatch.setattr("app.routers.works.apply_enrichment_selections", _fake_apply)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/enrichment/apply",
        json={
            "selections": [
                {
                    "field_key": "work.description",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": "Desc",
                }
            ]
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["updated"] == ["work.description"]


def test_apply_enrichment_returns_400(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _invalid(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise ValueError("invalid")

    monkeypatch.setattr("app.routers.works.apply_enrichment_selections", _invalid)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/enrichment/apply",
        json={
            "selections": [
                {
                    "field_key": "work.description",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": "Desc",
                }
            ]
        },
    )
    assert response.status_code == 400


def test_list_cover_metadata_sources_returns_mixed_provider_tiles(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[],
        execute_rows=[[("openlibrary", "/books/OL1M", {"title": "Source title"})]],
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="OL Edition",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9780000000001",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            )
        ]

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [
            {
                "provider": "googlebooks",
                "source_id": "vol-1",
                "title": "Google Edition",
                "authors": ["Matt Dinniman"],
                "publisher": "Ace",
                "publish_date": "2025-09-23",
                "language": "en",
                "identifier": "9780000000002",
                "cover_url": "https://books.google.com/cover.jpg",
                "source_label": "Google Books",
            }
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions
    )
    monkeypatch.setattr(
        "app.routers.works._openlibrary_work_key_for_work",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles",
        _fake_google_tiles,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")

    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert any(item["provider"] == "openlibrary" for item in items)
    assert any(item["provider"] == "googlebooks" for item in items)
    openlibrary_item = next(item for item in items if item["provider"] == "openlibrary")
    assert openlibrary_item["openlibrary_work_key"] == "/works/OL1W"


def test_list_cover_metadata_sources_includes_prefetch_compare_when_requested(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL1W"],
        execute_rows=[[]],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="This Inevitable Ruin",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9780000000001",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            )
        ]

    compare_kwargs: dict[str, Any] = {}

    async def _fake_compare_payload(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
        compare_kwargs.update(_kwargs)
        return {
            "selected_source": {
                "provider": "openlibrary",
                "source_id": "/books/OL1M",
                "source_label": "Open Library OL1M",
                "edition_id": None,
            },
            "fields": [],
        }

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions
    )
    monkeypatch.setattr(
        "app.routers.works._build_cover_metadata_compare_payload",
        _fake_compare_payload,
    )

    async def _fake_no_google(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles",
        _fake_no_google,
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{work_id}/cover-metadata/sources",
        params={"include_prefetch_compare": "true", "prefetch_limit": 3},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["items"][0]["source_id"] == "/books/OL1M"
    assert payload["items"][0]["openlibrary_work_key"] == "/works/OL1W"
    assert "openlibrary:/books/OL1M" in payload["prefetch_compare"]
    assert compare_kwargs["openlibrary_work_key"] == "/works/OL1W"


def test_compare_cover_metadata_source_returns_normalized_fields(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_session = _FakeSession(
        scalar_values=[
            None,
            None,
            None,
            {
                "description": {"value": "Selected description"},
                "covers": [1],
                "first_publish_year": 2024,
            },
        ],
        work=SimpleNamespace(
            title="Work title",
            description="Current description",
            default_cover_url="https://example.com/current.jpg",
            first_publish_year=2020,
        ),
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{uuid.uuid4()}/cover-metadata/compare",
        params={"provider": "openlibrary", "source_id": "/works/OL1W"},
    )
    assert response.status_code == 200
    field = response.json()["data"]["fields"][0]
    assert field["field_key"] == "work.description"
    assert field["field_label"] == "Description"
    assert field["selected_available"] is True


def test_compare_cover_metadata_source_rejects_invalid_provider(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{uuid.uuid4()}/cover-metadata/compare",
        params={"provider": "unsupported", "source_id": "abc"},
    )
    assert response.status_code == 400


class _FakeResult:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows

    def first(self) -> Any:
        return self._rows[0] if self._rows else None


class _FakeSession:
    def __init__(
        self,
        *,
        scalar_values: list[Any],
        execute_rows: list[list[Any]] | None = None,
        work: Any = None,
    ) -> None:
        self._scalar_values = list(scalar_values)
        self._execute_rows = list(execute_rows or [])
        self._work = work
        self.added: list[Any] = []
        self.commit_calls = 0

    def scalar(self, *_args: Any, **_kwargs: Any) -> Any:
        if not self._scalar_values:
            return None
        return self._scalar_values.pop(0)

    def execute(self, *_args: Any, **_kwargs: Any) -> _FakeResult:
        if not self._execute_rows:
            return _FakeResult([])
        return _FakeResult(self._execute_rows.pop(0))

    def get(self, *_args: Any, **_kwargs: Any) -> Any:
        return self._work

    def add(self, value: Any) -> None:
        self.added.append(value)

    def commit(self) -> None:
        self.commit_calls += 1


def test_work_title_for_lookup_returns_none_for_missing_work() -> None:
    session = _FakeSession(scalar_values=[], work=None)
    assert _work_title_for_lookup(cast(Any, session), work_id=uuid.uuid4()) is None


def test_current_field_values_for_compare_prefers_library_cover_override() -> None:
    session = _FakeSession(
        scalar_values=[
            None,  # preferred_edition_id lookup
            None,  # latest edition lookup
            "https://example.com/override-cover.jpg",  # cover coalesce lookup
        ],
        work=SimpleNamespace(
            description="Current description",
            default_cover_url="https://example.com/default-cover.jpg",
            first_publish_year=2020,
        ),
    )

    values = _current_field_values_for_compare(
        session=cast(Any, session),
        work_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        edition_id=None,
    )

    assert values["work.cover_url"] == "https://example.com/override-cover.jpg"


def test_google_books_enabled_for_user_requires_setting_key_and_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = AuthContext(claims={}, client_id=None, user_id=uuid.uuid4())
    session = cast(Any, _FakeSession(scalar_values=[]))
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=True),
    )
    assert not _google_books_enabled_for_user(
        auth=auth,
        session=session,
        settings=Settings(
            supabase_url="https://example.supabase.co",
            supabase_jwt_audience="authenticated",
            supabase_jwt_secret=None,
            supabase_jwks_cache_ttl_seconds=60,
            supabase_service_role_key="service-role",
            supabase_storage_covers_bucket="covers",
            public_highlight_max_chars=280,
            book_provider_google_enabled=False,
            google_books_api_key="key",
            api_version="0.1.0",
        ),
    )
    assert not _google_books_enabled_for_user(
        auth=auth,
        session=session,
        settings=Settings(
            supabase_url="https://example.supabase.co",
            supabase_jwt_audience="authenticated",
            supabase_jwt_secret=None,
            supabase_jwks_cache_ttl_seconds=60,
            supabase_service_role_key="service-role",
            supabase_storage_covers_bucket="covers",
            public_highlight_max_chars=280,
            book_provider_google_enabled=True,
            google_books_api_key=None,
            api_version="0.1.0",
        ),
    )
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=False),
    )
    assert not _google_books_enabled_for_user(
        auth=auth,
        session=session,
        settings=Settings(
            supabase_url="https://example.supabase.co",
            supabase_jwt_audience="authenticated",
            supabase_jwt_secret=None,
            supabase_jwks_cache_ttl_seconds=60,
            supabase_service_role_key="service-role",
            supabase_storage_covers_bucket="covers",
            public_highlight_max_chars=280,
            book_provider_google_enabled=True,
            google_books_api_key="key",
            api_version="0.1.0",
        ),
    )


def test_first_author_for_lookup_returns_none_for_missing_or_invalid_row() -> None:
    session_none = _FakeSession(scalar_values=[], execute_rows=[[]])
    assert (
        _first_author_for_lookup(cast(Any, session_none), work_id=uuid.uuid4()) is None
    )

    session_invalid = _FakeSession(scalar_values=[], execute_rows=[[(123,)]])
    assert (
        _first_author_for_lookup(cast(Any, session_invalid), work_id=uuid.uuid4())
        is None
    )


def test_work_authors_for_lookup_filters_invalid_blank_and_duplicates() -> None:
    session = _FakeSession(
        scalar_values=[],
        execute_rows=[
            [(123,), (" Matt Dinniman ",), ("",), ("Matt Dinniman",), ("A",)]
        ],
    )
    assert _work_authors_for_lookup(cast(Any, session), work_id=uuid.uuid4()) == [
        "Matt Dinniman",
        "A",
    ]


def test_ensure_openlibrary_work_mapping_updates_existing_mapping() -> None:
    work_id = uuid.uuid4()
    existing_mapping = SimpleNamespace(provider_id="/works/OLD")
    session = _FakeSession(
        scalar_values=[existing_mapping, SimpleNamespace(entity_id=work_id)]
    )

    _ensure_openlibrary_work_mapping(
        cast(Any, session), work_id=work_id, work_key="/works/OL41914127W"
    )

    assert existing_mapping.provider_id == "/works/OL41914127W"
    assert session.added == []


def test_list_openlibrary_provider_editions_falls_back_to_search(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[("Matt Dinniman",)], []],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(
            items=[
                SimpleNamespace(
                    work_key="/works/OL41914127W",
                    title="This Inevitable Ruin",
                    author_names=["Matt Dinniman"],
                )
            ]
        )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL60639135M",
                title="This Inevitable Ruin",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9780594009041",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            )
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_editions=_fake_fetch_work_editions,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/provider-editions/openlibrary")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mapped_work_key"] is None
    assert payload["items"][0]["work_key"] == "/works/OL41914127W"
    assert payload["items"][0]["edition_key"] == "/books/OL60639135M"
    assert payload["items"][0]["work_title"] == "This Inevitable Ruin"


def test_list_openlibrary_provider_editions_handles_empty_lookup(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        work=None,
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/provider-editions/openlibrary")

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mapped_work_key"] is None
    assert payload["items"] == []


def test_list_openlibrary_provider_editions_uses_existing_mapping(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    imported_edition_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[[("/books/OL60639135M", imported_edition_id)]],
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL60639135M",
                title="This Inevitable Ruin",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9780594009041",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            )
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary?language=eng"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mapped_work_key"] == "/works/OL41914127W"
    assert payload["items"][0]["imported_edition_id"] == str(imported_edition_id)


def test_list_openlibrary_provider_editions_dedupes_and_respects_limit(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[("Matt Dinniman",)], []],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(
            items=[
                SimpleNamespace(
                    work_key="/works/OL1W",
                    title="This Inevitable Ruin",
                    author_names=["Matt Dinniman"],
                ),
                SimpleNamespace(
                    work_key="/works/OL1W",
                    title="Duplicate",
                    author_names=[],
                ),
                SimpleNamespace(work_key=" ", title="Blank", author_names=[]),
                SimpleNamespace(
                    work_key="/works/OL2W",
                    title="This Inevitable Ruin 2",
                    author_names=["Matt Dinniman"],
                ),
                SimpleNamespace(
                    work_key="/works/OL3W",
                    title="This Inevitable Ruin 3",
                    author_names=["Matt Dinniman"],
                ),
                SimpleNamespace(
                    work_key="/works/OL4W",
                    title="Overflow",
                    author_names=["Matt Dinniman"],
                ),
            ]
        )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1",
                publisher=None,
                publish_date=None,
                language=None,
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1 duplicate",
                publisher=None,
                publish_date=None,
                language=None,
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_editions=_fake_fetch_work_editions,
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary?limit=1"
    )

    assert response.status_code == 200
    payload = response.json()["data"]
    assert len(payload["items"]) == 1
    assert payload["items"][0]["edition_key"] == "/books/OL1M"


def test_import_openlibrary_provider_edition_sets_mapping_and_preferred(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    imported_edition_id = str(uuid.uuid4())
    library_item = SimpleNamespace(preferred_edition_id=None)
    fake_session = _FakeSession(
        scalar_values=[None, None, None, library_item],
    )
    fetched: dict[str, str] = {}

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str) -> Any:
        fetched["work_key"] = work_key
        fetched["edition_key"] = edition_key
        return SimpleNamespace()

    monkeypatch.setattr(
        "app.routers.works.import_openlibrary_bundle",
        lambda *_args, **_kwargs: {"edition": {"id": imported_edition_id}},
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_bundle=_fake_fetch_work_bundle,
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary/import",
        json={
            "work_key": "/works/OL41914127W",
            "edition_key": "/books/OL60639135M",
            "set_preferred": True,
        },
    )

    assert response.status_code == 200
    assert fetched["work_key"] == "/works/OL41914127W"
    assert fetched["edition_key"] == "/books/OL60639135M"
    assert response.json()["data"]["imported_edition_id"] == imported_edition_id
    assert library_item.preferred_edition_id == uuid.UUID(imported_edition_id)
    assert fake_session.commit_calls == 1
    assert len(fake_session.added) == 1
    assert fake_session.added[0].provider_id == "/works/OL41914127W"


def test_import_openlibrary_provider_edition_requires_work_selection(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(scalar_values=[None])

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary/import",
        json={"edition_key": "/books/OL60639135M", "set_preferred": True},
    )

    assert response.status_code == 400


def test_import_openlibrary_provider_edition_returns_409_for_conflict(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[
            None,
            None,
            SimpleNamespace(entity_id=uuid.uuid4()),
        ]
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary/import",
        json={
            "work_key": "/works/OL41914127W",
            "edition_key": "/books/OL60639135M",
            "set_preferred": False,
        },
    )

    assert response.status_code == 409


def test_import_openlibrary_provider_edition_skips_preferred_when_disabled(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(scalar_values=["/works/OL41914127W", None, None])

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str) -> Any:
        return SimpleNamespace()

    monkeypatch.setattr(
        "app.routers.works.import_openlibrary_bundle",
        lambda *_args, **_kwargs: {"edition": {"id": str(uuid.uuid4())}},
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_bundle=_fake_fetch_work_bundle
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary/import",
        json={
            "edition_key": "/books/OL60639135M",
            "set_preferred": False,
        },
    )

    assert response.status_code == 200
    assert fake_session.commit_calls == 0


def test_source_extract_helpers_and_matching() -> None:
    openlibrary_raw = {
        "title": " This Inevitable Ruin ",
        "author_name": ["Matt Dinniman"],
        "covers": [15142977],
        "languages": [{"key": "/languages/eng"}],
        "publishers": ["Ace"],
        "publish_date": "2025-09-23",
        "isbn_13": ["9798217190041"],
    }
    google_raw = {
        "volumeInfo": {
            "title": "This Inevitable Ruin",
            "authors": ["Matt Dinniman"],
            "imageLinks": {"thumbnail": "http://books.google.com/cover.jpg"},
            "language": "en",
            "publisher": "Penguin",
            "publishedDate": "2025-02-11",
            "industryIdentifiers": [{"identifier": "9780593820254"}],
        }
    }

    assert _first_string(["", "  ", "value "]) == "value"
    assert _extract_source_title(openlibrary_raw) == "This Inevitable Ruin"
    assert _extract_source_title(google_raw) == "This Inevitable Ruin"
    assert _extract_source_authors(openlibrary_raw) == ["Matt Dinniman"]
    assert _extract_source_authors(google_raw) == ["Matt Dinniman"]
    openlibrary_cover = _extract_source_cover(openlibrary_raw)
    assert openlibrary_cover is not None
    assert openlibrary_cover.endswith("-M.jpg")
    assert _extract_source_cover(google_raw) == "https://books.google.com/cover.jpg"
    assert _extract_source_language(openlibrary_raw) == "eng"
    assert _extract_source_language(google_raw) == "en"
    assert _extract_source_publisher(openlibrary_raw) == "Ace"
    assert _extract_source_publish_date(google_raw) == "2025-02-11"
    assert _extract_source_identifier(openlibrary_raw, "fallback") == "9798217190041"
    assert _extract_source_identifier({}, "fallback") == "fallback"
    assert _normalize_text_tokens("This, Inevitable RUIN!") == [
        "this",
        "inevitable",
        "ruin",
    ]
    assert _title_match_score("This Inevitable Ruin", "This Inevitable Ruin") == 100
    assert _author_match_score("Matt Dinniman", ["Matt Dinniman"]) >= 25
    assert _tile_sort_key({"provider": "openlibrary", "title": "A"}) < _tile_sort_key(
        {"provider": "googlebooks", "title": "A"}
    )
    assert _has_selected_value("x")
    assert not _has_selected_value("  ")


def test_openlibrary_and_google_selected_value_parsers() -> None:
    raw_work = {
        "description": {"value": "A desc"},
        "first_publish_year": 2024,
        "covers": [99],
    }
    raw_edition = {
        "covers": [100],
        "publishers": ["Ace"],
        "publish_date": "2025-09-23",
        "isbn_13": ["9798217190041"],
        "languages": [{"key": "/languages/eng"}],
        "physical_format": "Hardcover",
        "number_of_pages": 880,
        "duration": "10:37:00",
        "works": [{"key": "/works/OL41914127W"}],
    }
    parsed = _parse_openlibrary_selected_values(
        raw_work=raw_work, raw_edition=raw_edition
    )
    assert parsed["work.description"] == "A desc"
    assert parsed["work.cover_url"] is not None
    assert str(parsed["work.cover_url"]).endswith("/100-L.jpg")
    assert parsed["edition.publisher"] == "Ace"
    assert parsed["edition.total_pages"] == 880
    assert _parse_openlibrary_description({"description": "x"}) == "x"
    assert (
        _parse_openlibrary_first_publish_year({"first_publish_date": "2025-09-23"})
        == 2025
    )
    cover_url = _parse_openlibrary_cover_url({"covers": [1]}, {"covers": [2]})
    assert cover_url is not None
    assert cover_url.endswith("/2-L.jpg")
    assert _openlibrary_edition_raw_has_compare_fields(raw_edition)

    google_raw = {
        "volumeInfo": {
            "description": "Google desc",
            "publishedDate": "2025-02-11",
            "imageLinks": {"thumbnail": "http://books.google.com/x.jpg"},
            "industryIdentifiers": [
                {"type": "ISBN_10", "identifier": "0593820254"},
                {"type": "ISBN_13", "identifier": "9780593820254"},
            ],
            "publisher": "Penguin",
            "language": "en",
            "printType": "BOOK",
            "pageCount": 810,
        }
    }
    google_parsed = _parse_google_selected_values(google_raw)
    assert google_parsed["work.description"] == "Google desc"
    assert google_parsed["edition.isbn13"] == "9780593820254"
    assert google_parsed["edition.total_pages"] == 810


def test_selected_values_from_bundles() -> None:
    ol_bundle = OpenLibraryWorkBundle(
        work_key="/works/OL1W",
        title="Title",
        description="Desc",
        first_publish_year=2024,
        cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        authors=[],
        edition={
            "publisher": "Ace",
            "publish_date_iso": "2025-09-23",
            "isbn10": "111",
            "isbn13": "222",
            "language": "eng",
            "format": "Hardcover",
            "total_pages": None,
            "total_audio_minutes": None,
        },
        raw_work={},
        raw_edition={"number_of_pages": 880, "duration": "10:37:00"},
    )
    ol_values = _selected_values_from_openlibrary_bundle(bundle=ol_bundle)
    assert ol_values["edition.total_pages"] == 880
    assert ol_values["edition.total_audio_minutes"] == "10:37:00"

    gb_bundle = GoogleBooksWorkBundle(
        volume_id="id",
        title="Title",
        description="Desc",
        first_publish_year=2025,
        cover_url="https://books.google.com/cover.jpg",
        authors=["Matt Dinniman"],
        edition={
            "publisher": "Penguin",
            "publish_date_iso": "2025-02-11",
            "isbn10": "0593820254",
            "isbn13": "9780593820254",
            "language": "en",
            "format": "BOOK",
            "total_pages": 810,
            "total_audio_minutes": None,
        },
        raw_volume={},
        attribution_url=None,
    )
    gb_values = _selected_values_from_google_bundle(bundle=gb_bundle)
    assert gb_values["edition.publisher"] == "Penguin"
    assert gb_values["edition.total_pages"] == 810


def test_resolve_openlibrary_work_key_for_source_and_upsert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = uuid.uuid4()
    session = _FakeSession(scalar_values=[{"works": [{"key": "/works/OL41914127W"}]}])
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, session),
            work_id=work_id,
            source_id="/books/OL60639135M",
        )
        == "/works/OL41914127W"
    )
    monkeypatch.setattr(
        "app.routers.works._openlibrary_work_key_for_work",
        lambda *_args, **_kwargs: "/works/FALLBACK",
    )
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, _FakeSession(scalar_values=[None])),
            work_id=work_id,
            source_id="unknown",
        )
        == "/works/FALLBACK"
    )
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, _FakeSession(scalar_values=[])),
            work_id=work_id,
            source_id="/books/OL60639135M",
            openlibrary_work_key="/works/OLPREFERRED",
        )
        == "/works/OLPREFERRED"
    )

    add_session = _FakeSession(scalar_values=[None])
    _upsert_source_record(
        cast(Any, add_session),
        provider="openlibrary",
        entity_type="edition",
        provider_id="/books/OL1M",
        raw={"k": "v"},
    )
    assert len(add_session.added) == 1

    existing = SimpleNamespace(raw={})
    update_session = _FakeSession(scalar_values=[existing])
    _upsert_source_record(
        cast(Any, update_session),
        provider="openlibrary",
        entity_type="edition",
        provider_id="/books/OL1M",
        raw={"fresh": True},
    )
    assert existing.raw == {"fresh": True}


def test_resolve_openlibrary_work_key_for_source_returns_work_key_input() -> None:
    session = _FakeSession(scalar_values=[])
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, session),
            work_id=uuid.uuid4(),
            source_id="/works/OL41914127W",
        )
        == "/works/OL41914127W"
    )


@pytest.mark.anyio
async def test_collect_google_source_tiles_filters_and_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = uuid.uuid4()
    auth = AuthContext(claims={}, client_id=None, user_id=uuid.uuid4())
    session = _FakeSession(
        scalar_values=["mappedVolumeId"],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=True),
    )
    monkeypatch.setattr(
        "app.routers.works._first_author_for_lookup",
        lambda *_args, **_kwargs: "Matt Dinniman",
    )

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(
            items=[
                SimpleNamespace(volume_id="mappedVolumeId"),
                SimpleNamespace(volume_id="goodACAAJ"),
                SimpleNamespace(volume_id="otherQBAJ"),
                SimpleNamespace(volume_id="badMatch"),
            ]
        )

    async def _fake_fetch_work_bundle(*, volume_id: str) -> GoogleBooksWorkBundle:
        if volume_id == "badMatch":
            return GoogleBooksWorkBundle(
                volume_id=volume_id,
                title="Unrelated Book",
                description=None,
                first_publish_year=None,
                cover_url=None,
                authors=["Someone Else"],
                edition={},
                raw_volume={},
                attribution_url=None,
            )
        if volume_id == "otherQBAJ":
            raise RuntimeError("skip")
        return GoogleBooksWorkBundle(
            volume_id=volume_id,
            title="This Inevitable Ruin",
            description=None,
            first_publish_year=2025,
            cover_url="https://books.google.com/cover.jpg",
            authors=["Matt Dinniman"],
            edition={
                "publisher": "Penguin",
                "publish_date": "2025-02-11",
                "language": "en",
                "isbn13": "9780593820254",
            },
            raw_volume={},
            attribution_url=None,
        )

    google_books = SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_bundle=_fake_fetch_work_bundle,
    )

    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )

    tiles = await _collect_google_source_tiles(
        work_id=work_id,
        auth=auth,
        session=cast(Any, session),
        google_books=cast(Any, google_books),
        settings=settings,
        limit=10,
        language="en",
        allowed_google_languages={"en"},
    )

    assert len(tiles) <= 2
    assert tiles[0]["provider"] == "googlebooks"
    assert all(tile["source_id"] != "badMatch" for tile in tiles)


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_openlibrary_refreshes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(
        scalar_values=[
            None,
            None,
        ]
    )
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"work.description": None, "edition.publisher": None},
    )
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda **_kwargs: "/works/OL41914127W",
    )

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str | None) -> Any:
        assert work_key == "/works/OL41914127W"
        assert edition_key == "/books/OL60639135M"
        return OpenLibraryWorkBundle(
            work_key=work_key,
            title="This Inevitable Ruin",
            description="Selected description",
            first_publish_year=2024,
            cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            authors=[{"name": "Matt Dinniman"}],
            edition={"publisher": "Ace"},
            raw_work={"description": {"value": "Selected description"}},
            raw_edition={
                "covers": [15142977],
                "publishers": ["Ace"],
                "publish_date": "2025-09-23",
                "works": [{"key": "/works/OL41914127W"}],
            },
        )

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(
            Any, SimpleNamespace(fetch_work_bundle=_fake_fetch_work_bundle)
        ),
        google_books=cast(Any, SimpleNamespace()),
        provider="openlibrary",
        source_id="/books/OL60639135M",
        edition_id=None,
    )

    payload_obj = cast(dict[str, Any], payload)
    assert (
        cast(dict[str, Any], payload_obj["selected_source"])["provider"]
        == "openlibrary"
    )
    assert session.commit_calls == 1
    fields = cast(list[dict[str, Any]], payload_obj["fields"])
    assert any(field["provider_id"] == "/books/OL60639135M" for field in fields)


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_google_fetches_and_commits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(scalar_values=[None])
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"work.description": None, "edition.publisher": None},
    )

    async def _fake_fetch_work_bundle(*, volume_id: str) -> Any:
        assert volume_id == "zwT-0AEACAAJ"
        return GoogleBooksWorkBundle(
            volume_id=volume_id,
            title="This Inevitable Ruin",
            description="Google description",
            first_publish_year=2025,
            cover_url="https://books.google.com/cover.jpg",
            authors=["Matt Dinniman"],
            edition={"publisher": "Penguin"},
            raw_volume={
                "volumeInfo": {
                    "description": "Google description",
                    "publisher": "Penguin",
                    "publishedDate": "2025-02-11",
                }
            },
            attribution_url=None,
        )

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(Any, SimpleNamespace()),
        google_books=cast(
            Any, SimpleNamespace(fetch_work_bundle=_fake_fetch_work_bundle)
        ),
        provider="googlebooks",
        source_id="zwT-0AEACAAJ",
        edition_id=None,
    )

    payload_obj = cast(dict[str, Any], payload)
    assert (
        cast(dict[str, Any], payload_obj["selected_source"])["provider"]
        == "googlebooks"
    )
    assert session.commit_calls == 1
    fields = cast(list[dict[str, Any]], payload_obj["fields"])
    assert all(field["provider"] == "googlebooks" for field in fields)


def test_list_cover_metadata_sources_uses_mapped_authors_when_missing(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[[]],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_fetch_work_bundle(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(authors=[{"name": "Matt Dinniman"}])

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL60639135M",
                title="This Inevitable Ruin",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9798217190041",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            )
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_bundle=_fake_fetch_work_bundle,
        fetch_work_editions=_fake_fetch_work_editions,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")
    assert response.status_code == 200
    authors = response.json()["data"]["items"][0]["authors"]
    assert authors == ["Matt Dinniman"]


def test_list_cover_metadata_sources_search_fallback_dedupes(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[]],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(
            items=[
                SimpleNamespace(
                    work_key="/works/OL1W",
                    title="This Inevitable Ruin",
                    author_names=["Matt Dinniman"],
                ),
                SimpleNamespace(
                    work_key="/works/OL1W", title="Duplicate", author_names=[]
                ),
                SimpleNamespace(work_key=" ", title="Blank", author_names=[]),
                SimpleNamespace(
                    work_key="/works/OL2W",
                    title="This Inevitable Ruin 2",
                    author_names=["Matt Dinniman"],
                ),
            ]
        )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1",
                publisher="Ace",
                publish_date="2025-09-23",
                language="eng",
                isbn10=None,
                isbn13="9798217190041",
                cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
            ),
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1 duplicate",
                publisher=None,
                publish_date=None,
                language=None,
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_editions=_fake_fetch_work_editions,
    )
    app.dependency_overrides[get_google_books_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources?limit=2")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["source_id"] == "/books/OL1M"


def test_list_cover_metadata_sources_search_fallback_filters_unrelated_titles(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[]],
        work=SimpleNamespace(title="1984"),
    )
    fetched_work_keys: list[str] = []

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        return SimpleNamespace(
            items=[
                SimpleNamespace(
                    work_key="/works/OL1984W",
                    title="1984",
                    author_names=["George Orwell"],
                ),
                SimpleNamespace(
                    work_key="/works/OLANIMALW",
                    title="Animal Farm",
                    author_names=["George Orwell"],
                ),
            ]
        )

    async def _fake_fetch_work_editions(*, work_key: str, **_kwargs: Any) -> list[Any]:
        fetched_work_keys.append(work_key)
        if work_key == "/works/OL1984W":
            return [
                SimpleNamespace(
                    key="/books/OL1984M",
                    title="1984",
                    publisher="Secker & Warburg",
                    publish_date="1949-06-08",
                    language="eng",
                    isbn10=None,
                    isbn13=None,
                    cover_url="https://covers.openlibrary.org/b/id/123-M.jpg",
                )
            ]
        return []

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_editions=_fake_fetch_work_editions,
    )
    app.dependency_overrides[get_google_books_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["source_id"] == "/books/OL1984M"
    assert items[0]["openlibrary_work_key"] == "/works/OL1984W"
    assert fetched_work_keys == ["/works/OL1984W"]


def test_list_cover_metadata_sources_ignores_mapped_author_fetch_failure(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[[]],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _boom_fetch_work_bundle(*_args: Any, **_kwargs: Any) -> Any:
        raise RuntimeError("boom")

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_bundle=_boom_fetch_work_bundle,
        fetch_work_editions=_fake_fetch_work_editions,
    )
    app.dependency_overrides[get_google_books_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_google_uses_cached_raw(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cached_raw = {
        "volumeInfo": {
            "description": "Cached description",
            "language": "en",
            "publishedDate": "2025-02-11",
        }
    }
    session = _FakeSession(scalar_values=[cached_raw])
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"work.description": None},
    )

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(Any, SimpleNamespace()),
        google_books=cast(
            Any,
            SimpleNamespace(
                fetch_work_bundle=lambda **_kwargs: (_ for _ in ()).throw(
                    AssertionError("should not fetch")
                )
            ),
        ),
        provider="googlebooks",
        source_id="cached-vol",
        edition_id=None,
    )
    payload_obj = cast(dict[str, Any], payload)
    assert (
        cast(dict[str, Any], payload_obj["selected_source"])["provider"]
        == "googlebooks"
    )
    assert session.commit_calls == 0


def test_openlibrary_parsers_cover_more_branches() -> None:
    assert _parse_openlibrary_description({"description": {"value": " v "}}) == "v"
    assert _parse_openlibrary_description({"description": {"value": "   "}}) is None
    assert _parse_openlibrary_first_publish_year({"first_publish_year": 0}) is None
    assert (
        _parse_openlibrary_first_publish_year({"first_publish_date": "unknown"}) is None
    )
    assert (
        _parse_openlibrary_cover_url({"covers": [1]}, {"covers": ["bad", 2]})
        == "https://covers.openlibrary.org/b/id/2-L.jpg"
    )
    assert (
        _parse_openlibrary_cover_url({"covers": ["bad"]}, {"covers": ["bad"]}) is None
    )
    assert not _openlibrary_edition_raw_has_compare_fields({"covers": [1]})


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_rejects_blank_source_id() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await _build_cover_metadata_compare_payload(
            session=cast(Any, _FakeSession(scalar_values=[])),
            auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
            work_id=uuid.uuid4(),
            open_library=cast(Any, SimpleNamespace()),
            google_books=cast(Any, SimpleNamespace()),
            provider="openlibrary",
            source_id="   ",
            edition_id=None,
        )
    assert exc_info.value.status_code == 400


def test_list_cover_metadata_sources_fills_missing_fields_from_source_records(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[
            [],
            [
                (
                    "openlibrary",
                    "/books/OL1M",
                    {
                        "title": "Recovered title",
                        "authors": ["Recovered Author"],
                        "publishers": ["Recovered Publisher"],
                        "publish_date": "2025-09-23",
                        "languages": [{"key": "/languages/eng"}],
                        "covers": [15142977],
                        "isbn_13": ["9798217190041"],
                    },
                )
            ],
        ],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title=None,
                publisher=None,
                publish_date=None,
                language=None,
                isbn10=None,
                isbn13=None,
                cover_url=None,
            )
        ]

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [
            {"provider": "", "source_id": "bad"},
            {"provider": "googlebooks", "source_id": ""},
            {"provider": "openlibrary", "source_id": "/books/OL1M"},
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        fetch_work_bundle=lambda **_kwargs: SimpleNamespace(authors=[]),
    )
    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles", _fake_google_tiles
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources?limit=1")
    assert response.status_code == 200
    item = response.json()["data"]["items"][0]
    assert item["title"] == "Mapped Open Library work"
    assert item["publisher"] == "Recovered Publisher"
    assert item["language"] == "eng"
    assert item["identifier"] == "/books/OL1M"
    assert item["cover_url"].endswith("-M.jpg")


def test_list_cover_metadata_sources_enriches_openlibrary_missing_language_cover(
    app: FastAPI,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[[], []],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )
    fetch_calls: list[str] = []

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="Recovered title",
                publisher=None,
                publish_date=None,
                language=None,
                isbn10=None,
                isbn13=None,
                cover_url=None,
            )
        ]

    async def _fake_fetch_edition_payload(*, edition_key: str) -> dict[str, Any]:
        fetch_calls.append(edition_key)
        return {
            "languages": [{"key": "/languages/eng"}],
            "covers": [15142977],
            "publishers": ["Recovered Publisher"],
            "publish_date": "2025-09-23",
            "isbn_13": ["9798217190041"],
        }

    async def _fake_no_google(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return []

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        fetch_work_bundle=lambda **_kwargs: SimpleNamespace(authors=[]),
        fetch_edition_payload=_fake_fetch_edition_payload,
    )
    app.dependency_overrides[get_google_books_client] = lambda: SimpleNamespace()

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["language"] == "eng"
    assert items[0]["cover_url"].endswith("-M.jpg")
    assert fetch_calls == ["/books/OL1M"]


def test_helper_extractors_handle_invalid_inputs() -> None:
    assert _extract_source_title(None) is None
    assert _extract_source_authors(None) == []
    assert _extract_source_cover(None) is None
    assert _extract_source_language(None) is None
    assert _extract_source_publisher(None) is None
    assert _extract_source_publish_date(None) is None
    assert _extract_source_identifier(None, "fallback") == "fallback"
    assert _first_string("not-a-list") is None
    assert (
        _extract_source_publisher({"volumeInfo": {"publisher": "Penguin"}}) == "Penguin"
    )
    assert (
        _extract_source_identifier(
            {
                "volumeInfo": {
                    "industryIdentifiers": [
                        {},
                        {"type": "ISBN_13"},
                        {"identifier": "9780593820254"},
                    ]
                }
            },
            "fallback",
        )
        == "9780593820254"
    )


def test_title_and_author_match_score_branches() -> None:
    assert _title_match_score("a b c d", "a b c x") == 60
    assert _title_match_score("a b c", "a b c x") == 80
    assert _title_match_score("a b c", "x a b c y") == 80
    assert _title_match_score("a", "z") == 0
    assert (
        _title_match_score(
            "The Da Vinci Code (Robert Langdon, #2)", "The Da Vinci Code"
        )
        >= 80
    )

    assert _author_match_score(None, ["a"]) == 0
    assert _author_match_score("  ", ["a"]) == 0
    assert _author_match_score("Matt Dinniman", ["Matt Dinniman"]) == 30
    assert _author_match_score("A B C", ["A B X"]) == 25
    assert _author_match_score("A B", ["A X"]) == 15
    assert _author_match_score("A B", ["Z Y"]) == 0
    assert _author_match_score("", ["A"]) == 0
    assert _author_match_score("!!!", ["A"]) == 0
    assert _author_match_score("Matt Dinniman", ["!!!", "Matt Dinniman"]) == 30


def test_resolve_effective_languages_canonicalizes_to_openlibrary_codes() -> None:
    assert _resolve_effective_languages(
        explicit_languages="en,es,fra",
        legacy_language=None,
        default_language=None,
    ) == ["eng", "spa", "fra"]
    assert _resolve_effective_languages(
        explicit_languages=None,
        legacy_language="en",
        default_language=None,
    ) == ["eng"]
    assert _normalize_text_tokens(None) == []
    assert _title_match_score("", "This Inevitable Ruin") == 0


def test_extract_source_helpers_cover_fallback_paths() -> None:
    assert _extract_source_title({"volumeInfo": {"title": "  "}}) is None
    assert _extract_source_authors({"volumeInfo": {"authors": "bad"}}) == []
    assert (
        _extract_source_cover(
            {
                "covers": [0, -1, "x"],
                "volumeInfo": {
                    "imageLinks": {"thumbnail": " ", "smallThumbnail": "http://img"}
                },
            }
        )
        == "https://img"
    )
    assert _extract_source_cover({"covers": [0, -1]}) is None
    assert _extract_source_language({"languages": [{}, " eng "]}) == "eng"
    assert (
        _extract_source_language(
            {"languages": [{"key": "/not-language"}], "volumeInfo": {"language": "fr"}}
        )
        == "fr"
    )
    assert (
        _extract_source_identifier(
            {"volumeInfo": {"industryIdentifiers": [None, {"identifier": " "}, {}]}},
            "fallback",
        )
        == "fallback"
    )
    assert _extract_source_identifier({"isbn_10": ["123"]}, "fallback") == "123"
    assert (
        _extract_source_publisher(
            {"publishers": [" "], "volumeInfo": {"publisher": " "}}
        )
        is None
    )
    assert (
        _extract_source_publish_date(
            {"publish_date": " ", "volumeInfo": {"publishedDate": " "}}
        )
        is None
    )


@pytest.mark.anyio
async def test_collect_google_source_tiles_handles_missing_work_and_blank_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth = AuthContext(claims={}, client_id=None, user_id=uuid.uuid4())
    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=True),
    )
    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )
    google_books = cast(
        Any,
        SimpleNamespace(
            search_books=lambda **_kwargs: (_ for _ in ()).throw(
                AssertionError("should not search")
            ),
            fetch_work_bundle=lambda **_kwargs: (_ for _ in ()).throw(
                AssertionError("should not fetch")
            ),
        ),
    )
    missing_work_tiles = await _collect_google_source_tiles(
        work_id=uuid.uuid4(),
        auth=auth,
        session=cast(Any, _FakeSession(scalar_values=[], work=None)),
        google_books=google_books,
        settings=settings,
        limit=5,
        language=None,
        allowed_google_languages={"en"},
    )
    assert missing_work_tiles == []

    blank_title_tiles = await _collect_google_source_tiles(
        work_id=uuid.uuid4(),
        auth=auth,
        session=cast(
            Any,
            _FakeSession(
                scalar_values=[],
                work=SimpleNamespace(title="   "),
            ),
        ),
        google_books=google_books,
        settings=settings,
        limit=5,
        language=None,
        allowed_google_languages={"en"},
    )
    assert blank_title_tiles == []


@pytest.mark.anyio
async def test_collect_google_source_tiles_breaks_on_high_volume_search(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = uuid.uuid4()
    auth = AuthContext(claims={}, client_id=None, user_id=uuid.uuid4())
    session = _FakeSession(
        scalar_values=["mappedVolumeId"],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )
    search_calls = {"count": 0}

    monkeypatch.setattr(
        "app.routers.works.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=True),
    )
    monkeypatch.setattr(
        "app.routers.works._first_author_for_lookup",
        lambda *_args, **_kwargs: "",
    )

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        search_calls["count"] += 1
        return SimpleNamespace(
            items=[SimpleNamespace(volume_id=f"id-{idx}") for idx in range(25)]
        )

    async def _fake_fetch_work_bundle(*, volume_id: str) -> GoogleBooksWorkBundle:
        return GoogleBooksWorkBundle(
            volume_id=volume_id,
            title="This Inevitable Ruin",
            description=None,
            first_publish_year=None,
            cover_url=None,
            authors=["Matt Dinniman"],
            edition={},
            raw_volume={},
            attribution_url=None,
        )

    google_books = SimpleNamespace(
        search_books=_fake_search_books,
        fetch_work_bundle=_fake_fetch_work_bundle,
    )
    settings = Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )

    tiles = await _collect_google_source_tiles(
        work_id=work_id,
        auth=auth,
        session=cast(Any, session),
        google_books=cast(Any, google_books),
        settings=settings,
        limit=10,
        language=None,
        allowed_google_languages={"en"},
    )
    assert search_calls["count"] == 1
    assert len(tiles) <= 2


def test_resolve_edition_target_for_compare_prefers_explicit_edition() -> None:
    edition_id = uuid.uuid4()
    work_id = uuid.uuid4()
    user_id = uuid.uuid4()
    edition_obj = SimpleNamespace(id=edition_id)
    session = _FakeSession(scalar_values=[edition_obj])
    result = _resolve_edition_target_for_compare(
        session=cast(Any, session),
        work_id=work_id,
        user_id=user_id,
        edition_id=edition_id,
    )
    assert result is not None


def test_current_field_values_for_compare_raises_when_work_missing() -> None:
    with pytest.raises(HTTPException) as exc_info:
        _current_field_values_for_compare(
            session=cast(Any, _FakeSession(scalar_values=[], work=None)),
            work_id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            edition_id=None,
        )
    assert exc_info.value.status_code == 404


def test_resolve_edition_target_for_compare_uses_preferred_and_fallback() -> None:
    work_id = uuid.uuid4()
    user_id = uuid.uuid4()
    preferred = uuid.uuid4()
    preferred_obj = SimpleNamespace(id=preferred)
    fallback_obj = SimpleNamespace(id=uuid.uuid4())
    session = _FakeSession(
        scalar_values=[
            preferred,
            preferred_obj,
        ]
    )
    resolved = _resolve_edition_target_for_compare(
        session=cast(Any, session),
        work_id=work_id,
        user_id=user_id,
        edition_id=None,
    )
    assert resolved is not None

    session2 = _FakeSession(scalar_values=[None, fallback_obj])
    resolved2 = _resolve_edition_target_for_compare(
        session=cast(Any, session2),
        work_id=work_id,
        user_id=user_id,
        edition_id=None,
    )
    assert resolved2 is not None


def test_resolve_edition_target_for_compare_falls_back_when_preferred_missing() -> None:
    work_id = uuid.uuid4()
    user_id = uuid.uuid4()
    fallback_obj = SimpleNamespace(id=uuid.uuid4())
    session = _FakeSession(
        scalar_values=[
            uuid.uuid4(),
            None,
            fallback_obj,
        ]
    )
    resolved = _resolve_edition_target_for_compare(
        session=cast(Any, session),
        work_id=work_id,
        user_id=user_id,
        edition_id=None,
    )
    assert resolved is not None
    assert resolved.id == fallback_obj.id


@pytest.mark.anyio
async def test_compare_cover_metadata_source_returns_404_when_work_key_missing(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_session = _FakeSession(
        scalar_values=[],
        work=SimpleNamespace(
            title="Work",
            description=None,
            default_cover_url=None,
            first_publish_year=None,
        ),
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda **_kwargs: None,
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{uuid.uuid4()}/cover-metadata/compare",
        params={"provider": "openlibrary", "source_id": "/books/OL1M"},
    )
    assert response.status_code == 404


def test_list_cover_metadata_sources_handles_empty_lookup_title_without_search(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[]],
        work=SimpleNamespace(title=" "),
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        raise AssertionError("should not fetch editions without candidate works")

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("should not search when lookup title is blank")

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        search_books=_fake_search_books,
    )

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles", _fake_google_tiles
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources")
    assert response.status_code == 200
    assert response.json()["data"]["items"] == []


def test_list_cover_metadata_sources_uses_title_override_query(
    app: FastAPI,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=[None],
        execute_rows=[[]],
        work=SimpleNamespace(title=" "),
    )
    seen_queries: list[str] = []

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def _fake_search_books(*_args: Any, **_kwargs: Any) -> Any:
        seen_queries.append(str(_kwargs.get("query") or ""))
        return SimpleNamespace(
            items=[
                SimpleNamespace(
                    work_key="/works/OL1W",
                    title="The Da Vinci Code",
                    author_names=["Dan Brown"],
                    cover_url="https://covers.openlibrary.org/b/id/1-M.jpg",
                    first_publish_year=2003,
                    languages=["eng"],
                )
            ]
        )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        search_books=_fake_search_books,
    )

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return []

    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles", _fake_google_tiles
    )

    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{work_id}/cover-metadata/sources",
        params={"title": "The Da Vinci Code (Robert Langdon, #2)"},
    )
    assert response.status_code == 200
    assert seen_queries
    assert seen_queries[0] == "The Da Vinci Code"
    assert response.json()["data"]["items"][0]["source_id"] == "/works/OL1W"


def test_list_cover_metadata_sources_hydrates_google_missing_fields(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[
            [],
            [
                (
                    "googlebooks",
                    "vol-1",
                    {
                        "volumeInfo": {
                            "title": "Recovered Google Title",
                            "authors": ["Matt Dinniman"],
                            "publisher": "Penguin",
                            "publishedDate": "2025-02-11",
                            "language": "en",
                            "imageLinks": {
                                "smallThumbnail": "http://books.google.com/c.jpg"
                            },
                            "industryIdentifiers": [{"identifier": "9780593820254"}],
                        }
                    },
                )
            ],
        ],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [
            {
                "provider": "googlebooks",
                "source_id": "vol-1",
                "title": None,
                "authors": None,
                "publisher": None,
                "publish_date": None,
                "language": None,
                "identifier": " ",
                "cover_url": None,
                "source_label": "Google Books",
            }
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        fetch_work_bundle=lambda **_kwargs: SimpleNamespace(authors=[]),
    )
    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles",
        _fake_google_tiles,
    )

    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/cover-metadata/sources?limit=1")
    assert response.status_code == 200
    item = response.json()["data"]["items"][0]
    assert item["title"] == "Recovered Google Title"
    assert item["authors"] == ["Matt Dinniman"]
    assert item["identifier"] == "9780593820254"
    assert item["cover_url"] == "https://books.google.com/c.jpg"


def test_list_openlibrary_editions_dedupes_duplicate_edition_keys(app: FastAPI) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL41914127W"],
        execute_rows=[[]],
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return [
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1",
                publisher="Ace",
                publish_date="2025-01-01",
                language="eng",
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
            SimpleNamespace(
                key="/books/OL1M",
                title="Edition 1 dup",
                publisher="Ace",
                publish_date="2025-01-01",
                language="eng",
                isbn10=None,
                isbn13=None,
                cover_url=None,
            ),
        ]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{work_id}/provider-editions/openlibrary")
    assert response.status_code == 200
    assert len(response.json()["data"]["items"]) == 1


def test_import_openlibrary_provider_edition_set_preferred_with_missing_item(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(scalar_values=["/works/OL41914127W", None, None, None])

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str) -> Any:
        return SimpleNamespace()

    monkeypatch.setattr(
        "app.routers.works.import_openlibrary_bundle",
        lambda *_args, **_kwargs: {"edition": {"id": str(uuid.uuid4())}},
    )

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_bundle=_fake_fetch_work_bundle
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{work_id}/provider-editions/openlibrary/import",
        json={"edition_key": "/books/OL60639135M", "set_preferred": True},
    )
    assert response.status_code == 200
    assert fake_session.commit_calls == 0


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_openlibrary_without_raw_edition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(scalar_values=[None, None])
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"work.description": None},
    )
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda **_kwargs: "/works/OL1W",
    )

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str | None) -> Any:
        return OpenLibraryWorkBundle(
            work_key=work_key,
            title="Title",
            description="Desc",
            first_publish_year=2024,
            cover_url=None,
            authors=[],
            edition=None,
            raw_work={"description": "Desc"},
            raw_edition=None,
        )

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(
            Any, SimpleNamespace(fetch_work_bundle=_fake_fetch_work_bundle)
        ),
        google_books=cast(Any, SimpleNamespace()),
        provider="openlibrary",
        source_id="/books/OL1M",
        edition_id=None,
    )
    assert cast(dict[str, Any], payload["selected_source"])["provider"] == "openlibrary"


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_openlibrary_work_source_includes_edition_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(scalar_values=[None])
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"edition.publisher": None},
    )
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda **_kwargs: "/works/OL1W",
    )

    async def _fake_fetch_work_bundle(*, work_key: str, edition_key: str | None) -> Any:
        assert work_key == "/works/OL1W"
        assert edition_key is None
        return OpenLibraryWorkBundle(
            work_key=work_key,
            title="Title",
            description="Desc",
            first_publish_year=2024,
            cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            authors=[],
            edition={"key": "/books/OL999M", "publisher": "Ace"},
            raw_work={"description": "Desc"},
            raw_edition={"publishers": ["Ace"], "covers": [1]},
        )

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(
            Any, SimpleNamespace(fetch_work_bundle=_fake_fetch_work_bundle)
        ),
        google_books=cast(Any, SimpleNamespace()),
        provider="openlibrary",
        source_id="/works/OL1W",
        edition_id=None,
    )
    fields = cast(list[dict[str, Any]], cast(dict[str, Any], payload)["fields"])
    publisher_field = next(
        field for field in fields if field["field_key"] == "edition.publisher"
    )
    assert publisher_field["selected_value"] == "Ace"
    assert publisher_field["selected_available"] is True
    assert publisher_field["provider_id"] == "/books/OL999M"


@pytest.mark.anyio
async def test_build_cover_metadata_compare_payload_openlibrary_resolves_work_key_from_edition_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(
        scalar_values=[
            {"description": "Resolved work description", "covers": [1]},
            {"covers": [1], "publishers": ["Ace"]},
        ],
    )
    monkeypatch.setattr(
        "app.routers.works._current_field_values_for_compare",
        lambda **_kwargs: {"work.description": None},
    )
    monkeypatch.setattr(
        "app.routers.works._resolve_openlibrary_work_key_for_source",
        lambda **_kwargs: None,
    )

    async def _resolve_work_key_from_edition_key(**_kwargs: Any) -> str:
        return "/works/OLRESOLVED"

    payload = await _build_cover_metadata_compare_payload(
        session=cast(Any, session),
        auth=AuthContext(claims={}, client_id=None, user_id=uuid.uuid4()),
        work_id=uuid.uuid4(),
        open_library=cast(
            Any,
            SimpleNamespace(
                resolve_work_key_from_edition_key=_resolve_work_key_from_edition_key
            ),
        ),
        google_books=cast(Any, SimpleNamespace()),
        provider="openlibrary",
        source_id="/books/OL1M",
        edition_id=None,
    )

    assert cast(dict[str, Any], payload["selected_source"])["provider"] == "openlibrary"


def test_resolve_openlibrary_work_key_for_source_handles_invalid_works_entries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = _FakeSession(
        scalar_values=[
            {"works": ["bad", {"key": 123}, {"key": "/works/OLGOOD"}]},
            {"works": ["bad-only"]},
        ]
    )
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, session),
            work_id=uuid.uuid4(),
            source_id="/books/OL1M",
        )
        == "/works/OLGOOD"
    )
    monkeypatch.setattr(
        "app.routers.works._openlibrary_work_key_for_work",
        lambda *_args, **_kwargs: "/works/FALLBACK",
    )
    assert (
        _resolve_openlibrary_work_key_for_source(
            session=cast(Any, session),
            work_id=uuid.uuid4(),
            source_id="/books/OL2M",
        )
        == "/works/FALLBACK"
    )


def test_upsert_source_record_ignores_non_dict_raw() -> None:
    session = _FakeSession(scalar_values=[None])
    _upsert_source_record(
        cast(Any, session),
        provider="openlibrary",
        entity_type="edition",
        provider_id="/books/OL1M",
        raw="not-dict",
    )
    assert session.added == []


def test_list_enrichment_candidates_returns_400_on_value_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _invalid(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise ValueError("invalid")

    monkeypatch.setattr("app.routers.works.get_enrichment_candidates", _invalid)
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/enrichment/candidates")
    assert response.status_code == 400


def test_apply_enrichment_returns_404_and_502(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise LookupError("missing")

    monkeypatch.setattr("app.routers.works.apply_enrichment_selections", _missing)
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/enrichment/apply",
        json={"selections": []},
    )
    assert response.status_code == 404

    async def _boom(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise httpx.ConnectError("down")

    monkeypatch.setattr("app.routers.works.apply_enrichment_selections", _boom)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/enrichment/apply",
        json={"selections": []},
    )
    assert response.status_code == 502


def test_parse_google_selected_values_edge_branches() -> None:
    assert _parse_google_selected_values(None) == {}
    assert _parse_google_selected_values({"volumeInfo": []})["work.cover_url"] is None
    no_year = _parse_google_selected_values(
        {
            "volumeInfo": {
                "publishedDate": "not-a-date",
                "imageLinks": {"thumbnail": "   ", "smallThumbnail": "http://x"},
                "industryIdentifiers": [{"type": "OTHER", "identifier": "x"}],
            }
        }
    )
    assert no_year["work.first_publish_year"] is None
    assert no_year["work.cover_url"] == "https://x"


def test_parse_openlibrary_description_and_year_edge_branches() -> None:
    assert _parse_openlibrary_description({"description": {"value": "   "}}) is None
    assert _parse_openlibrary_description({"description": 123}) is None
    assert _parse_openlibrary_first_publish_year({"first_publish_year": 10001}) is None
    assert _parse_openlibrary_first_publish_year({"first_publish_date": "2025"}) == 2025


def test_extract_source_authors_non_string_entries() -> None:
    assert _extract_source_authors({"author_name": ["a", 1, None]}) == ["a"]
    assert _extract_source_authors({"authors": ["b", None]}) == ["b"]


def test_list_cover_metadata_sources_prefetch_skips_blank_provider_after_strip(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    work_id = uuid.uuid4()
    fake_session = _FakeSession(
        scalar_values=["/works/OL1W"],
        execute_rows=[[]],
        work=SimpleNamespace(title="This Inevitable Ruin"),
    )

    async def _fake_fetch_work_editions(*_args: Any, **_kwargs: Any) -> list[Any]:
        return []

    async def _fake_google_tiles(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [{"provider": " ", "source_id": "x", "title": "x"}]

    def _override_session() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _override_session
    app.dependency_overrides[get_open_library_client] = lambda: SimpleNamespace(
        fetch_work_editions=_fake_fetch_work_editions,
        fetch_work_bundle=lambda **_kwargs: SimpleNamespace(authors=[]),
    )
    monkeypatch.setattr(
        "app.routers.works._collect_google_source_tiles", _fake_google_tiles
    )
    monkeypatch.setattr(
        "app.routers.works._build_cover_metadata_compare_payload",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("should not prefetch")),
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/works/{work_id}/cover-metadata/sources?include_prefetch_compare=true"
    )
    assert response.status_code == 200
