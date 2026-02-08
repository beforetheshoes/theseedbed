from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.editions import router as editions_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(editions_router)

    user_id = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
    app.dependency_overrides[require_auth_context] = lambda: AuthContext(
        claims={},
        client_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        user_id=user_id,
    )
    app.dependency_overrides[enforce_client_user_rate_limit] = lambda: None
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

    def _fake_session() -> Generator[object, None, None]:
        yield object()

    app.dependency_overrides[get_db_session] = _fake_session

    async def _ok_upload(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {"cover_url": "https://example.com/cover.jpg"}

    async def _ok_cache(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        return {"cached": True, "cover_url": "https://example.com/cover.jpg"}

    monkeypatch.setattr(
        "app.routers.editions.set_edition_cover_from_upload", _ok_upload
    )
    monkeypatch.setattr(
        "app.routers.editions.cache_edition_cover_from_source_url", _ok_cache
    )

    yield app


def test_upload_cover_returns_ok(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover",
        files={"file": ("cover.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 200
    assert response.json()["data"]["cover_url"] == "https://example.com/cover.jpg"


def test_upload_cover_maps_permission_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _deny(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise PermissionError("no")

    monkeypatch.setattr("app.routers.editions.set_edition_cover_from_upload", _deny)

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover",
        files={"file": ("cover.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 403


def test_cache_cover_returns_ok(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover/cache",
        json={"source_url": "https://covers.openlibrary.org/b/id/1-L.jpg"},
    )
    assert response.status_code == 200
    assert response.json()["data"]["cached"] is True


def test_upload_cover_maps_image_validation_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.services.images import ImageValidationError

    async def _bad(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise ImageValidationError("bad image")

    monkeypatch.setattr("app.routers.editions.set_edition_cover_from_upload", _bad)

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover",
        files={"file": ("cover.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 400


def test_cache_cover_maps_value_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _bad(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise ValueError("nope")

    monkeypatch.setattr(
        "app.routers.editions.cache_edition_cover_from_source_url", _bad
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover/cache",
        json={"source_url": "https://x.co"},
    )
    assert response.status_code == 400


def test_upload_cover_maps_lookup_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise LookupError("missing")

    monkeypatch.setattr("app.routers.editions.set_edition_cover_from_upload", _missing)

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover",
        files={"file": ("cover.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 404


def test_upload_cover_maps_value_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _bad(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise ValueError("nope")

    monkeypatch.setattr("app.routers.editions.set_edition_cover_from_upload", _bad)

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover",
        files={"file": ("cover.jpg", b"img", "image/jpeg")},
    )
    assert response.status_code == 400


def test_cache_cover_maps_permission_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _deny(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise PermissionError("no")

    monkeypatch.setattr(
        "app.routers.editions.cache_edition_cover_from_source_url", _deny
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover/cache",
        json={"source_url": "https://covers.openlibrary.org/b/id/1-L.jpg"},
    )
    assert response.status_code == 403


def test_cache_cover_maps_lookup_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise LookupError("missing")

    monkeypatch.setattr(
        "app.routers.editions.cache_edition_cover_from_source_url", _missing
    )

    client = TestClient(app)
    response = client.post(
        f"/api/v1/editions/{uuid.uuid4()}/cover/cache",
        json={"source_url": "https://covers.openlibrary.org/b/id/1-L.jpg"},
    )
    assert response.status_code == 404
