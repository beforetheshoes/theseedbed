from __future__ import annotations

import uuid
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

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

    monkeypatch.setattr(
        "app.routers.works.get_work_detail",
        lambda *_args, **_kwargs: {"id": str(uuid.uuid4()), "title": "Book"},
    )
    monkeypatch.setattr(
        "app.routers.works.list_work_editions",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )

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
