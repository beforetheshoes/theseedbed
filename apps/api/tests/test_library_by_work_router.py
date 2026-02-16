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
    monkeypatch.setattr(
        "app.routers.library.get_library_item_statistics",
        lambda *_args, **_kwargs: {
            "library_item_id": str(uuid.uuid4()),
            "window": {
                "days": 90,
                "tz": "UTC",
                "start_date": "2026-01-01",
                "end_date": "2026-03-31",
            },
            "totals": {"total_pages": 300, "total_audio_minutes": 600},
            "counts": {
                "total_cycles": 1,
                "completed_cycles": 1,
                "imported_cycles": 0,
                "completed_reads": 1,
                "total_logs": 2,
                "logs_with_canonical": 2,
                "logs_missing_canonical": 0,
            },
            "current": {
                "latest_logged_at": dt.datetime.now(tz=dt.UTC).isoformat(),
                "canonical_percent": 50.0,
                "pages_read": 150.0,
                "minutes_listened": 300.0,
            },
            "streak": {"non_zero_days": 2, "last_non_zero_date": "2026-02-09"},
            "series": {
                "progress_over_time": [
                    {
                        "date": "2026-02-08",
                        "canonical_percent": 25.0,
                        "pages_read": 75.0,
                        "minutes_listened": 150.0,
                    }
                ],
                "daily_delta": [
                    {
                        "date": "2026-02-08",
                        "canonical_percent_delta": 25.0,
                        "pages_read_delta": 75.0,
                        "minutes_listened_delta": 150.0,
                    }
                ],
            },
            "timeline": [
                {
                    "log_id": str(uuid.uuid4()),
                    "logged_at": dt.datetime.now(tz=dt.UTC).isoformat(),
                    "date": "2026-02-08",
                    "unit": "percent_complete",
                    "value": 25.0,
                    "note": None,
                    "start_value": 0.0,
                    "end_value": 25.0,
                    "session_delta": 25.0,
                }
            ],
            "data_quality": {
                "has_missing_totals": False,
                "unresolved_logs_exist": False,
                "unresolved_log_ids": [],
            },
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


def test_get_library_item_statistics(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(
        f"/api/v1/library/items/{uuid.uuid4()}/statistics",
        params={"tz": "America/Los_Angeles", "days": 30},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert "counts" in payload
    assert "series" in payload
    assert "timeline" in payload


def test_get_library_item_statistics_returns_404(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.get_library_item_statistics",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("library item not found")
        ),
    )
    client = TestClient(app)
    response = client.get(f"/api/v1/library/items/{uuid.uuid4()}/statistics")
    assert response.status_code == 404


def test_get_library_item_statistics_returns_400_for_invalid_days(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.get_library_item_statistics",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            ValueError("days must be between 7 and 365")
        ),
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/library/items/{uuid.uuid4()}/statistics",
        params={"days": 2},
    )
    assert response.status_code == 400


def test_get_library_item_statistics_returns_400_for_invalid_tz(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.library.get_library_item_statistics",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError("invalid timezone")),
    )
    client = TestClient(app)
    response = client.get(
        f"/api/v1/library/items/{uuid.uuid4()}/statistics",
        params={"tz": "Mars/OlympusMons"},
    )
    assert response.status_code == 400
