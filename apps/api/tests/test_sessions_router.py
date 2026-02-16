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
from app.routers.sessions import router as sessions_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(sessions_router)

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
        "app.routers.sessions.list_read_cycles",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )
    monkeypatch.setattr(
        "app.routers.sessions.create_read_cycle",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.sessions.update_read_cycle",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.sessions.delete_read_cycle",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.routers.sessions.list_progress_logs",
        lambda *_args, **_kwargs: [{"id": str(uuid.uuid4())}],
    )
    monkeypatch.setattr(
        "app.routers.sessions.create_progress_log",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.sessions.update_progress_log",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.sessions.delete_progress_log",
        lambda *_args, **_kwargs: None,
    )

    yield app


def test_list_cycles(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/read-cycles")
    assert response.status_code == 200
    assert isinstance(response.json()["data"]["items"], list)


def test_create_cycle(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/library/items/{uuid.uuid4()}/read-cycles",
        json={"started_at": "2026-02-08T00:00:00Z", "title": "Read #1"},
    )
    assert response.status_code == 200
    assert "id" in response.json()["data"]


def test_patch_cycle(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/read-cycles/{uuid.uuid4()}",
        json={"note": "ok"},
    )
    assert response.status_code == 200


def test_delete_cycle(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/read-cycles/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_list_logs(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/read-cycles/{uuid.uuid4()}/progress-logs")
    assert response.status_code == 200
    assert isinstance(response.json()["data"]["items"], list)


def test_create_log(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/read-cycles/{uuid.uuid4()}/progress-logs",
        json={"unit": "percent_complete", "value": 20},
    )
    assert response.status_code == 200
    assert "id" in response.json()["data"]


def test_patch_log(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/progress-logs/{uuid.uuid4()}",
        json={"note": "ok"},
    )
    assert response.status_code == 200


def test_delete_log(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/progress-logs/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_list_cycles_returns_404_on_missing_item(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.sessions.list_read_cycles",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("library item not found")
        ),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/read-cycles")
    assert response.status_code == 404


def test_create_log_returns_400_on_invalid_value(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.sessions.create_progress_log",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("percent_complete must be between 0 and 100")
        ),
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/read-cycles/{uuid.uuid4()}/progress-logs",
        json={"unit": "percent_complete", "value": 120},
    )
    assert response.status_code == 400


def test_patch_cycle_returns_404_on_missing_cycle(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.sessions.update_read_cycle",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("read cycle not found")
        ),
    )
    client = TestClient(app)
    response = client.patch(f"/api/v1/read-cycles/{uuid.uuid4()}", json={"note": "x"})
    assert response.status_code == 404
