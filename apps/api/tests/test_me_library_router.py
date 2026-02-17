from __future__ import annotations

import datetime as dt
import re
import uuid
from collections.abc import Generator
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers.library import router as library_router
from app.routers.me import router as me_router

VALID_LIBRARY_STATUSES = ("to_read", "reading", "completed", "abandoned")
VALID_LIBRARY_VISIBILITIES = ("private", "public")


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(me_router)
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
        "app.routers.me.get_or_create_profile",
        lambda session, *, user_id: SimpleNamespace(
            id=user_id,
            handle="seed",
            display_name="Seed",
            avatar_url=None,
            enable_google_books=False,
            theme_primary_color=None,
            theme_accent_color=None,
            theme_font_family=None,
            theme_heading_font_family=None,
            default_progress_unit="pages_read",
        ),
    )

    def _fake_update_profile(
        session: object,
        *,
        user_id: uuid.UUID,
        handle: str | None,
        display_name: str | None,
        avatar_url: str | None,
        enable_google_books: bool | None,
        theme_primary_color: str | None,
        theme_accent_color: str | None,
        theme_font_family: str | None,
        theme_heading_font_family: str | None,
        default_progress_unit: str | None,
    ) -> SimpleNamespace:
        if theme_primary_color is not None and not re.fullmatch(
            r"^#[0-9A-Fa-f]{6}$", theme_primary_color
        ):
            raise ValueError("theme_primary_color must be a #RRGGBB hex value")
        if theme_accent_color is not None and not re.fullmatch(
            r"^#[0-9A-Fa-f]{6}$", theme_accent_color
        ):
            raise ValueError("theme_accent_color must be a #RRGGBB hex value")
        _valid_fonts = {
            "atkinson",
            "ibm_plex_sans",
            "fraunces",
            "inter",
            "averia_libre",
            "dongle",
            "nunito_sans",
            "lora",
            "libre_baskerville",
        }
        if theme_font_family is not None and theme_font_family not in _valid_fonts:
            raise ValueError(
                f"theme_font_family must be one of: {', '.join(sorted(_valid_fonts))}"
            )
        if (
            theme_heading_font_family is not None
            and theme_heading_font_family not in _valid_fonts
        ):
            raise ValueError(
                f"theme_heading_font_family must be one of: {', '.join(sorted(_valid_fonts))}"
            )
        return SimpleNamespace(
            id=user_id,
            handle=handle or "seed",
            display_name=display_name,
            avatar_url=avatar_url,
            enable_google_books=(
                enable_google_books if isinstance(enable_google_books, bool) else False
            ),
            theme_primary_color=theme_primary_color,
            theme_accent_color=theme_accent_color,
            theme_font_family=theme_font_family,
            theme_heading_font_family=theme_heading_font_family,
            default_progress_unit=default_progress_unit or "pages_read",
        )

    monkeypatch.setattr("app.routers.me.update_profile", _fake_update_profile)

    monkeypatch.setattr(
        "app.routers.library.list_library_items",
        lambda session, *, user_id, page, page_size, sort, status, tag, visibility: {
            "items": [
                {
                    "id": str(uuid.uuid4()),
                    "work_id": str(uuid.uuid4()),
                    "work_title": "Book",
                    "author_names": ["Author A"],
                    "cover_url": None,
                    "status": status or "to_read",
                    "visibility": "private",
                    "rating": None,
                    "tags": [],
                    "last_read_at": None,
                    "created_at": dt.datetime.now(tz=dt.UTC).isoformat(),
                }
            ],
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_count": 1,
                "total_pages": 1,
                "from": 1,
                "to": 1,
                "has_prev": False,
                "has_next": False,
            },
        },
    )
    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item",
        lambda session, **_: (
            SimpleNamespace(
                id=uuid.uuid4(),
                work_id=uuid.uuid4(),
                preferred_edition_id=None,
                status="to_read",
                visibility="private",
                rating=None,
                tags=None,
                created_at=dt.datetime.now(tz=dt.UTC),
            ),
            True,
        ),
    )
    monkeypatch.setattr(
        "app.routers.library.update_library_item",
        lambda session, *, user_id, item_id, updates: SimpleNamespace(
            id=item_id,
            work_id=uuid.uuid4(),
            preferred_edition_id=updates.get("preferred_edition_id"),
            status=updates.get("status", "to_read"),
            visibility=updates.get("visibility", "private"),
            rating=updates.get("rating"),
            tags=updates.get("tags"),
        ),
    )
    monkeypatch.setattr(
        "app.routers.library.delete_library_item",
        lambda session, *, user_id, item_id: None,
    )

    yield app


def test_get_me(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/me")
    assert response.status_code == 200
    assert response.json()["data"]["handle"] == "seed"
    assert response.json()["data"]["enable_google_books"] is False
    assert response.json()["data"]["theme_primary_color"] is None
    assert response.json()["data"]["theme_accent_color"] is None
    assert response.json()["data"]["theme_font_family"] is None
    assert response.json()["data"]["theme_heading_font_family"] is None
    assert response.json()["data"]["default_progress_unit"] == "pages_read"


def test_patch_me(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch("/api/v1/me", json={"display_name": "Updated"})
    assert response.status_code == 200
    assert response.json()["data"]["display_name"] == "Updated"


def test_patch_me_updates_google_books_preference(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch("/api/v1/me", json={"enable_google_books": True})
    assert response.status_code == 200
    assert response.json()["data"]["enable_google_books"] is True


def test_patch_me_updates_default_progress_unit(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        "/api/v1/me", json={"default_progress_unit": "minutes_listened"}
    )
    assert response.status_code == 200
    assert response.json()["data"]["default_progress_unit"] == "minutes_listened"


def test_patch_me_updates_theme_settings(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        "/api/v1/me",
        json={
            "theme_primary_color": "#112233",
            "theme_accent_color": "#445566",
            "theme_font_family": "ibm_plex_sans",
        },
    )
    assert response.status_code == 200
    data = response.json()["data"]
    assert data["theme_primary_color"] == "#112233"
    assert data["theme_accent_color"] == "#445566"
    assert data["theme_font_family"] == "ibm_plex_sans"


def test_patch_me_rejects_invalid_theme_font_family(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        "/api/v1/me",
        json={
            "theme_font_family": "comic_sans",
        },
    )
    assert response.status_code == 400


def test_patch_me_rejects_invalid_theme_colors(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        "/api/v1/me",
        json={
            "theme_primary_color": "#12345",
        },
    )
    assert response.status_code == 400


def test_patch_me_returns_400_on_validation_error(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.me.update_profile",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad")),
    )
    client = TestClient(app)
    response = client.patch("/api/v1/me", json={"handle": ""})
    assert response.status_code == 400


def test_list_library_items(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(
        "/api/v1/library/items",
        params={
            "status": "reading",
            "tag": "tag-a",
            "visibility": "public",
            "page": 2,
            "page_size": 25,
            "sort": "author_desc",
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["items"][0]["status"] == "reading"
    assert response.json()["data"]["pagination"]["page"] == 2
    assert response.json()["data"]["pagination"]["page_size"] == 25
    assert "last_read_at" in response.json()["data"]["items"][0]


def test_create_library_item(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4())},
    )
    assert response.status_code == 200
    assert response.json()["data"]["created"] is True


@pytest.mark.parametrize("status", VALID_LIBRARY_STATUSES)
def test_create_library_item_accepts_valid_status_values(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch, status: str
) -> None:
    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item",
        lambda session, **kwargs: (
            SimpleNamespace(
                id=uuid.uuid4(),
                work_id=kwargs["work_id"],
                status=kwargs["status"],
                visibility=kwargs.get("visibility") or "private",
                rating=kwargs.get("rating"),
                tags=kwargs.get("tags"),
            ),
            True,
        ),
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4()), "status": status},
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == status


@pytest.mark.parametrize("visibility", VALID_LIBRARY_VISIBILITIES)
def test_create_library_item_accepts_valid_visibility_values(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch, visibility: str
) -> None:
    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item",
        lambda session, **kwargs: (
            SimpleNamespace(
                id=uuid.uuid4(),
                work_id=kwargs["work_id"],
                status=kwargs.get("status") or "to_read",
                visibility=kwargs["visibility"],
                rating=kwargs.get("rating"),
                tags=kwargs.get("tags"),
            ),
            True,
        ),
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4()), "visibility": visibility},
    )
    assert response.status_code == 200
    assert response.json()["data"]["visibility"] == visibility


def test_create_library_item_rejects_invalid_status_before_service_call(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = False

    def _create_or_get(*_args: object, **_kwargs: object) -> tuple[object, bool]:
        nonlocal called
        called = True
        return object(), True

    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item", _create_or_get
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4()), "status": "paused"},
    )
    assert response.status_code == 422
    assert called is False


def test_create_library_item_rejects_invalid_visibility_before_service_call(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = False

    def _create_or_get(*_args: object, **_kwargs: object) -> tuple[object, bool]:
        nonlocal called
        called = True
        return object(), True

    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item", _create_or_get
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4()), "visibility": "friends_only"},
    )
    assert response.status_code == 422
    assert called is False


def test_create_library_item_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.create_or_get_library_item",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing work")),
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/library/items",
        json={"work_id": str(uuid.uuid4())},
    )
    assert response.status_code == 404


def test_list_library_items_returns_400_for_bad_params(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.list_library_items",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad params")),
    )
    client = TestClient(app)
    response = client.get("/api/v1/library/items", params={"status": "reading"})
    assert response.status_code == 400


def test_list_library_items_rejects_invalid_sort(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/library/items", params={"sort": "random"})
    assert response.status_code == 422


def test_list_library_items_rejects_invalid_page_size(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get("/api/v1/library/items", params={"page_size": 101})
    assert response.status_code == 422


def test_patch_library_item(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"status": "reading", "tags": ["memoir"]},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["status"] == "reading"
    assert payload["tags"] == ["memoir"]


@pytest.mark.parametrize("status", VALID_LIBRARY_STATUSES)
def test_patch_library_item_accepts_valid_status_values(
    app: FastAPI, status: str
) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"status": status},
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == status


@pytest.mark.parametrize("visibility", VALID_LIBRARY_VISIBILITIES)
def test_patch_library_item_accepts_valid_visibility_values(
    app: FastAPI, visibility: str
) -> None:
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"visibility": visibility},
    )
    assert response.status_code == 200
    assert response.json()["data"]["visibility"] == visibility


def test_patch_library_item_rejects_invalid_status_before_service_call(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = False

    def _update(*_args: object, **_kwargs: object) -> object:
        nonlocal called
        called = True
        return object()

    monkeypatch.setattr("app.routers.library.update_library_item", _update)
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"status": "paused"},
    )
    assert response.status_code == 422
    assert called is False


def test_patch_library_item_rejects_invalid_visibility_before_service_call(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    called = False

    def _update(*_args: object, **_kwargs: object) -> object:
        nonlocal called
        called = True
        return object()

    monkeypatch.setattr("app.routers.library.update_library_item", _update)
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"visibility": "friends_only"},
    )
    assert response.status_code == 422
    assert called is False


def test_patch_library_item_returns_400(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.update_library_item",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("bad update")),
    )
    client = TestClient(app)
    response = client.patch(f"/api/v1/library/items/{uuid.uuid4()}", json={})
    assert response.status_code == 400


def test_patch_library_item_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.update_library_item",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing item")),
    )
    client = TestClient(app)
    response = client.patch(
        f"/api/v1/library/items/{uuid.uuid4()}",
        json={"status": "reading"},
    )
    assert response.status_code == 404


def test_delete_library_item(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.delete(f"/api/v1/library/items/{uuid.uuid4()}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_delete_library_item_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.delete_library_item",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(LookupError("missing item")),
    )
    client = TestClient(app)
    response = client.delete(f"/api/v1/library/items/{uuid.uuid4()}")
    assert response.status_code == 404
