from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.library import router as library_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(library_router)

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

    monkeypatch.setattr(
        "app.routers.library.get_library_item_by_work_detail",
        lambda *_args, **_kwargs: {
            "id": str(uuid.uuid4()),
            "work_id": str(uuid.uuid4()),
            "preferred_edition_id": None,
            "cover_url": "https://example.com/cover.jpg",
            "status": "to_read",
            "visibility": "private",
            "rating": None,
            "tags": [],
            "created_at": dt.datetime.now(tz=dt.UTC).isoformat(),
        },
    )

    yield app


def test_get_library_item_by_work(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/by-work/{uuid.uuid4()}")
    assert response.status_code == 200
    assert "id" in response.json()["data"]


def test_get_library_item_by_work_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.get_library_item_by_work_detail",
        lambda *_args, **_kwargs: None,
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/by-work/{uuid.uuid4()}")
    assert response.status_code == 404
