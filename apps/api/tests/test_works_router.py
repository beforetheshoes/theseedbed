from __future__ import annotations

import uuid
from collections.abc import Generator
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.works import (
    _ensure_openlibrary_work_mapping,
    _first_author_for_lookup,
    _work_title_for_lookup,
    get_google_books_client,
    get_open_library_client,
)
from app.routers.works import router as works_router
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
                "language": "eng",
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

    async def _fake_compare_payload(*_args: Any, **_kwargs: Any) -> dict[str, Any]:
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
    assert "openlibrary:/books/OL1M" in payload["prefetch_compare"]


def test_compare_cover_metadata_source_returns_normalized_fields(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_session = _FakeSession(
        scalar_values=[
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
