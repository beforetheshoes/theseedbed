from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.library_search import router as library_search_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(library_search_router)

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
        "app.routers.library_search.search_library_items",
        lambda _session, *, user_id, query, limit: [
            {
                "work_id": str(uuid.uuid4()),
                "work_title": f"Match: {query}",
                "author_names": ["Author A"],
                "cover_url": None,
                "openlibrary_work_key": "/works/OL1W",
            }
        ],
    )

    yield app


def test_library_search_returns_items(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/library/search", params={"query": "ab", "limit": 10})
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["items"][0]["work_title"] == "Match: ab"


def test_library_search_validates_query_length(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/library/search", params={"query": "a"})
    assert response.status_code == 422
