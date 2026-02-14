from __future__ import annotations

import uuid
from collections.abc import Generator

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.works import get_google_books_client, get_open_library_client
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
