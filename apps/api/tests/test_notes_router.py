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
from app.routers.notes import router as notes_router


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(notes_router)

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
        "app.routers.notes.list_notes",
        lambda *_args, **_kwargs: {
            "items": [{"id": str(uuid.uuid4())}],
            "next_cursor": None,
        },
    )
    monkeypatch.setattr(
        "app.routers.notes.create_note",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr(
        "app.routers.notes.update_note",
        lambda *_args, **_kwargs: SimpleNamespace(id=uuid.uuid4()),
    )
    monkeypatch.setattr("app.routers.notes.delete_note", lambda *_args, **_kwargs: None)

    yield app


def test_list_notes(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/notes")
    assert response.status_code == 200
    assert "items" in response.json()["data"]


def test_create_note(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        f"/api/v1/library/items/{uuid.uuid4()}/notes",
        json={"body": "Hello", "visibility": "private"},
    )
    assert response.status_code == 200


def test_patch_note(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(f"/api/v1/notes/{uuid.uuid4()}", json={"title": "T"})
    assert response.status_code == 200


def test_delete_note(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/notes/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_list_notes_returns_400_on_bad_cursor(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.notes.list_notes",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("invalid cursor")),
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/library/items/{uuid.uuid4()}/notes", params={"cursor": "bad"}
    )
    assert response.status_code == 400


def test_create_note_returns_404_on_missing_item(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.notes.create_note",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("library item not found")
        ),
    )
    client = TestClient(app)
    response = client.post(
        f"/api/v1/library/items/{uuid.uuid4()}/notes",
        json={"body": "Hello"},
    )
    assert response.status_code == 404


def test_patch_note_returns_404_and_400(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = TestClient(app)
    monkeypatch.setattr(
        "app.routers.notes.update_note",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    response = client.patch(f"/api/v1/notes/{uuid.uuid4()}", json={"title": "T"})
    assert response.status_code == 404

    monkeypatch.setattr(
        "app.routers.notes.update_note",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    response = client.patch(f"/api/v1/notes/{uuid.uuid4()}", json={"title": "T"})
    assert response.status_code == 400


def test_delete_note_returns_404(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.routers.notes.delete_note",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing")),
    )
    client = TestClient(app)
    response = client.delete(f"/api/v1/notes/{uuid.uuid4()}")
    assert response.status_code == 404
