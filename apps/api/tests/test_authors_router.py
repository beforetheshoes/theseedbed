from __future__ import annotations

import uuid
from collections.abc import Generator

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.authors import router as authors_router
from app.routers.books import get_open_library_client


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(authors_router)

    app.dependency_overrides[require_auth_context] = lambda: AuthContext(
        claims={},
        client_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        user_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    )
    app.dependency_overrides[get_open_library_client] = lambda: object()

    class _FakeSession:
        def get(self, _model: object, _key: object) -> object | None:
            return None

    def _fake_session() -> Generator[object, None, None]:
        yield _FakeSession()

    app.dependency_overrides[get_db_session] = _fake_session

    async def _fake_profile(*_args: object, **_kwargs: object) -> dict[str, object]:
        return {
            "id": str(uuid.uuid4()),
            "name": "Author A",
            "bio": "Bio",
            "photo_url": None,
            "openlibrary_author_key": "/authors/OL1A",
            "works": [],
        }

    monkeypatch.setattr(
        "app.routers.authors.get_openlibrary_author_profile", _fake_profile
    )
    yield app


def test_get_author(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/authors/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["name"] == "Author A"


def test_get_author_missing_returns_empty_profile(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _missing(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise LookupError("missing")

    monkeypatch.setattr("app.routers.authors.get_openlibrary_author_profile", _missing)
    client = TestClient(app)
    response = client.get(f"/api/v1/authors/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["works"] == []


def test_get_author_502(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    async def _down(*_args: object, **_kwargs: object) -> dict[str, object]:
        raise httpx.ConnectError("down")

    monkeypatch.setattr("app.routers.authors.get_openlibrary_author_profile", _down)
    client = TestClient(app)
    response = client.get(f"/api/v1/authors/{uuid.uuid4()}")
    assert response.status_code == 502
