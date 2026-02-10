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
from app.routers.works import router as works_router


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

    async def _fake_list_covers(
        *_args: object, **_kwargs: object
    ) -> list[dict[str, object]]:
        return [{"cover_id": 1, "thumbnail_url": "t", "image_url": "i"}]

    monkeypatch.setattr(
        "app.routers.works.list_openlibrary_cover_candidates",
        _fake_list_covers,
    )

    async def _fake_select(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {"scope": "override", "cover_url": "https://example.com/x.jpg"}

    monkeypatch.setattr("app.routers.works.select_openlibrary_cover", _fake_select)

    yield app


def test_get_work(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}")
    assert response.status_code == 200


def test_get_work_returns_404(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.routers.works.get_work_detail",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}")
    assert response.status_code == 404


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


def test_select_work_cover(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/covers/select", json={"cover_id": 123}
    )
    assert response.status_code == 200
    assert response.json()["data"]["scope"] in {"global", "override"}


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
