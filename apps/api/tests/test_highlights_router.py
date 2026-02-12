from __future__ import annotations

import uuid
from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.highlights import router as highlights_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(highlights_router)

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

    app.dependency_overrides[get_settings] = lambda: Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key=None,
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=10,
        api_version="0.1.0",
    )

    monkeypatch.setattr(
        "app.routers.highlights.list_highlights",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4()), "quote": "q"}],
    )
    monkeypatch.setattr(
        "app.routers.highlights.create_highlight",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.highlights.update_highlight",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.highlights.delete_highlight",
        lambda *_args, **_kwargs: None,
    )

    yield app


def test_list_highlights(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/highlights")
    assert response.status_code == 200


def test_create_highlight(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/library/items/{uuid.uuid4()}/highlights",
        json={
            "quote": "Hello",
            "visibility": "private",
            "location": {"type": "page", "value": 10},
            "location_sort": 10.0,
        },
    )
    assert response.status_code == 200


def test_patch_highlight(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/highlights/{uuid.uuid4()}",
        json={"quote": "Updated"},
    )
    assert response.status_code == 200


def test_delete_highlight(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/highlights/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_create_highlight_returns_400_on_validation_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.highlights.create_highlight",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/library/items/{uuid.uuid4()}/highlights",
        json={"quote": "Hello", "visibility": "public"},
    )
    assert response.status_code == 400


def test_list_highlights_returns_404_on_missing_item(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.highlights.list_highlights",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("library item not found")
        ),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/highlights")
    assert response.status_code == 404


def test_patch_highlight_returns_404_and_400(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)
    monkeypatch.setattr(
        "app.routers.highlights.update_highlight",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    response = client.patch(
        f"/api/v1/highlights/{uuid.uuid4()}",
        json={"quote": "Updated"},
    )
    assert response.status_code == 404

    monkeypatch.setattr(
        "app.routers.highlights.update_highlight",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    response = client.patch(
        f"/api/v1/highlights/{uuid.uuid4()}",
        json={"quote": "Updated"},
    )
    assert response.status_code == 400


def test_delete_highlight_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.highlights.delete_highlight",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.delete(f"/api/v1/highlights/{uuid.uuid4()}")
    assert response.status_code == 404
