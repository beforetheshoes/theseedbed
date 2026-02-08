from __future__ import annotations

import uuid
from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.reviews import public_router
from app.routers.reviews import router as reviews_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(public_router)
    app.include_router(reviews_router)

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
        "app.routers.reviews.list_public_reviews_for_work",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )
    monkeypatch.setattr(
        "app.routers.reviews.list_reviews_for_user",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )
    monkeypatch.setattr(
        "app.routers.reviews.upsert_review_for_work",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.reviews.delete_review",
        lambda *_args, **_kwargs: None,
    )

    yield app


def test_public_list_work_reviews(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/works/{uuid.uuid4()}/reviews")
    assert response.status_code == 200
    assert "items" in response.json()["data"]


def test_list_my_reviews(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/me/reviews")
    assert response.status_code == 200


def test_upsert_work_review(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/review",
        json={"body": "Nice", "visibility": "private"},
    )
    assert response.status_code == 200


def test_delete_review(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/reviews/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_delete_review_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.reviews.delete_review",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.delete(f"/api/v1/reviews/{uuid.uuid4()}")
    assert response.status_code == 404


def test_upsert_review_returns_404_when_missing_library_item(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.reviews.upsert_review_for_work",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/review",
        json={"body": "Nice", "visibility": "private"},
    )
    assert response.status_code == 404


def test_upsert_review_returns_400_on_invalid_payload(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.reviews.upsert_review_for_work",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/works/{uuid.uuid4()}/review",
        json={"body": "Nice", "visibility": "private"},
    )
    assert response.status_code == 400
