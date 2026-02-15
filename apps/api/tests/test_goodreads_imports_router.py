from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections.abc import Generator
from types import SimpleNamespace
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.routers import goodreads_imports as goodreads_imports_module
from app.routers.goodreads_imports import router as imports_router
from app.services.goodreads_parser import GoodreadsMissingRequiredField
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient


@pytest.fixture
def app(monkeypatch: pytest.MonkeyPatch) -> Generator[FastAPI, None, None]:
    app = FastAPI()
    app.include_router(imports_router)

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
        "app.routers.goodreads_imports.create_goodreads_job",
        lambda *_args, **_kwargs: SimpleNamespace(
            id=uuid.UUID("11111111-1111-1111-1111-111111111111"),
            status="queued",
            created_at=dt.datetime(2026, 2, 14, tzinfo=dt.UTC),
            total_rows=0,
            processed_rows=0,
            imported_rows=0,
            failed_rows=0,
            skipped_rows=0,
        ),
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_active_goodreads_job",
        lambda *_args, **_kwargs: None,
    )

    async def _fake_process(**_kwargs) -> None:  # type: ignore[no-untyped-def]
        return None

    monkeypatch.setattr(
        "app.routers.goodreads_imports.process_goodreads_import_job",
        _fake_process,
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_goodreads_job",
        lambda *_args, **_kwargs: SimpleNamespace(
            status="running",
            updated_at=dt.datetime.now(tz=dt.UTC),
            error_summary=None,
            finished_at=None,
        ),
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.serialize_job",
        lambda *_args, **_kwargs: {
            "job_id": "11111111-1111-1111-1111-111111111111",
            "status": "running",
            "processed_rows": 3,
            "rows_preview": [],
        },
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.list_goodreads_job_rows",
        lambda *_args, **_kwargs: (
            [
                SimpleNamespace(
                    row_number=2,
                    title="Book",
                    uid="9781234567890",
                    result="imported",
                    message="Imported successfully.",
                    work_id=None,
                    library_item_id=None,
                    review_id=None,
                    session_id=None,
                    created_at=dt.datetime(2026, 2, 14, tzinfo=dt.UTC),
                )
            ],
            None,
        ),
    )

    yield app


def test_create_goodreads_import_job_rejects_non_csv(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("input.txt", b"bad", "text/plain")},
    )
    assert response.status_code == 400
    assert "file must be a .csv" in response.text


def test_create_goodreads_import_job_rejects_empty_file(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"", "text/csv")},
    )
    assert response.status_code == 400
    assert "file is empty" in response.text


def test_create_goodreads_import_job_success(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["job_id"] == "11111111-1111-1111-1111-111111111111"
    assert payload["status"] == "queued"


def test_create_goodreads_import_job_accepts_author_overrides(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"author_overrides": '{"150":"Author Added","151":"Author B"}'},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["job_id"] == "11111111-1111-1111-1111-111111111111"


def test_create_goodreads_import_job_accepts_title_and_shelf_overrides(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={
            "title_overrides": '{"150":"Recovered Title"}',
            "shelf_overrides": '{"150":"read"}',
        },
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["job_id"] == "11111111-1111-1111-1111-111111111111"


def test_create_goodreads_import_job_accepts_skipped_rows_payload(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: dict[str, object] = {}

    async def _capture_process(**kwargs: object) -> None:
        captured.update(kwargs)

    monkeypatch.setattr(
        "app.routers.goodreads_imports.process_goodreads_import_job",
        _capture_process,
    )

    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={
            "skipped_rows": "[150, 151]",
            "skip_reasons": '{"150":"missing_authors"}',
        },
    )
    assert response.status_code == 200
    assert captured["skipped_rows"] == {150, 151}
    assert captured["skip_reasons"] == {150: "missing_authors"}


def test_create_goodreads_import_job_rejects_invalid_skipped_rows_payload(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"skipped_rows": '{"150":"bad"}'},
    )
    assert response.status_code == 400
    assert "skipped_rows must be an array" in response.text


def test_create_goodreads_import_job_rejects_invalid_skip_reasons_payload(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"skip_reasons": '[150, "missing_authors"]'},
    )
    assert response.status_code == 400
    assert "skip_reasons must be an object" in response.text


def test_create_goodreads_import_job_rejects_invalid_author_overrides(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"author_overrides": "{not-json"},
    )
    assert response.status_code == 400
    assert "invalid author_overrides payload" in response.text


def test_create_goodreads_import_job_rejects_author_overrides_not_object(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"author_overrides": "[]"},
    )
    assert response.status_code == 400
    assert "author_overrides must be an object" in response.text


def test_create_goodreads_import_job_rejects_author_overrides_non_string_value(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"author_overrides": '{"150": 1}'},
    )
    assert response.status_code == 400
    assert "author_overrides values must be strings" in response.text


def test_create_goodreads_import_job_rejects_author_overrides_non_numeric_key(
    app: FastAPI,
) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
        data={"author_overrides": '{"abc":"Author"}'},
    )
    assert response.status_code == 400
    assert "author_overrides keys must be row numbers" in response.text


def test_create_goodreads_import_job_returns_existing_active_job(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_active_goodreads_job",
        lambda *_args, **_kwargs: SimpleNamespace(
            id=uuid.UUID("22222222-2222-2222-2222-222222222222"),
            status="running",
            created_at=dt.datetime(2026, 2, 14, tzinfo=dt.UTC),
            updated_at=dt.datetime.now(tz=dt.UTC),
            total_rows=210,
            processed_rows=208,
            imported_rows=207,
            failed_rows=1,
            skipped_rows=0,
        ),
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["job_id"] == "22222222-2222-2222-2222-222222222222"
    assert payload["status"] == "running"
    assert payload["processed_rows"] == 208


def test_create_goodreads_import_job_marks_stale_running_job_failed(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Session:
        def __init__(self) -> None:
            self.commit_calls = 0

        def commit(self) -> None:
            self.commit_calls += 1

    fake_session = _Session()

    def _fake_session_dep() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _fake_session_dep

    stale_job = SimpleNamespace(
        id=uuid.UUID("33333333-3333-3333-3333-333333333333"),
        status="running",
        created_at=dt.datetime(2026, 2, 14, tzinfo=dt.UTC),
        updated_at=dt.datetime.now(tz=dt.UTC) - dt.timedelta(minutes=30),
        total_rows=210,
        processed_rows=208,
        imported_rows=207,
        failed_rows=1,
        skipped_rows=0,
        error_summary=None,
        finished_at=None,
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_active_goodreads_job",
        lambda *_args, **_kwargs: stale_job,
    )

    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["job_id"] == "11111111-1111-1111-1111-111111111111"
    assert payload["status"] == "queued"
    assert stale_job.status == "failed"
    assert stale_job.error_summary == "Import job stalled and was marked failed."
    assert stale_job.finished_at is not None
    assert fake_session.commit_calls == 1


def test_get_goodreads_import_job_status(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(
        "/api/v1/imports/goodreads/11111111-1111-1111-1111-111111111111"
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "running"


def test_get_goodreads_import_job_marks_stale_running_job_failed(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _Session:
        def __init__(self) -> None:
            self.commit_calls = 0

        def commit(self) -> None:
            self.commit_calls += 1

    fake_session = _Session()

    def _fake_session_dep() -> Generator[object, None, None]:
        yield fake_session

    app.dependency_overrides[get_db_session] = _fake_session_dep

    stale_job = SimpleNamespace(
        status="running",
        updated_at=dt.datetime.now(tz=dt.UTC) - dt.timedelta(minutes=10),
        error_summary=None,
        finished_at=None,
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_goodreads_job",
        lambda *_args, **_kwargs: stale_job,
    )

    client = TestClient(app)
    response = client.get(
        "/api/v1/imports/goodreads/11111111-1111-1111-1111-111111111111"
    )
    assert response.status_code == 200
    assert stale_job.status == "failed"
    assert stale_job.error_summary == "Import job stalled and was marked failed."
    assert stale_job.finished_at is not None
    assert fake_session.commit_calls == 1


def test_get_goodreads_import_rows(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.get(
        "/api/v1/imports/goodreads/11111111-1111-1111-1111-111111111111/rows"
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["row_number"] == 2


def test_get_goodreads_missing_authors(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def _fake_fetch(**_kwargs):  # type: ignore[no-untyped-def]
        return SimpleNamespace(
            title="A Small Key",
            authors="Jane Doe",
            source="openlibrary:isbn",
            confidence="high",
        )

    monkeypatch.setattr(
        "app.routers.goodreads_imports.find_missing_required_fields",
        lambda *_args, **_kwargs: [
            SimpleNamespace(
                row_number=150,
                field="authors",
                title="A Small Key",
                uid="9781938660177",
            )
        ],
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports._fetch_metadata_suggestion",
        _fake_fetch,
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports._google_books_enabled_for_user",
        lambda **_kwargs: False,
    )
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads/missing-required",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
    )
    assert response.status_code == 200
    items = response.json()["data"]["items"]
    assert items == [
        {
            "row_number": 150,
            "field": "authors",
            "issue_code": "missing_authors",
            "required": True,
            "title": "A Small Key",
            "uid": "9781938660177",
            "suggested_value": "Jane Doe",
            "suggestion_source": "openlibrary:isbn",
            "suggestion_confidence": "high",
        }
    ]


def test_get_goodreads_missing_authors_uses_row_cache(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[int] = []

    async def _fake_fetch(**_kwargs):  # type: ignore[no-untyped-def]
        calls.append(1)
        return SimpleNamespace(
            title="Recovered Title",
            authors="Recovered Author",
            source="openlibrary:isbn",
            confidence="high",
        )

    monkeypatch.setattr(
        "app.routers.goodreads_imports.find_missing_required_fields",
        lambda *_args, **_kwargs: [
            SimpleNamespace(
                row_number=150, field="authors", title=None, uid="9781938660177"
            ),
            SimpleNamespace(
                row_number=150, field="title", title=None, uid="9781938660177"
            ),
        ],
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports._fetch_metadata_suggestion",
        _fake_fetch,
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports._google_books_enabled_for_user",
        lambda **_kwargs: False,
    )

    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads/missing-required",
        files={"file": ("goodreads.csv", b"Title,Authors\n", "text/csv")},
    )
    assert response.status_code == 200
    assert len(response.json()["data"]["items"]) == 2
    assert len(calls) == 1


def test_goodreads_router_helpers_and_metadata_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _OpenLibrary:
        async def find_work_key_by_isbn(self, *, isbn: str) -> str | None:
            if isbn == "9780000000001":
                return "/works/OL1W"
            return None

        async def fetch_work_bundle(self, *, work_key: str) -> object:
            if work_key == "/works/OL1W":
                return SimpleNamespace(
                    title="From OL ISBN",
                    authors=[{"name": "OL Author"}],
                )
            raise RuntimeError("boom")

        async def search_books(self, *, query: str, limit: int) -> object:
            assert limit == 1
            return SimpleNamespace(
                items=[
                    SimpleNamespace(
                        title="From OL Search", author_names=["OL Search Author"]
                    )
                ]
            )

    class _GoogleBooks:
        async def search_books(self, *, query: str, limit: int) -> object:
            assert limit == 1
            if query.startswith("isbn:"):
                return SimpleNamespace(
                    items=[
                        SimpleNamespace(
                            title="From GB ISBN", author_names=["GB Author"]
                        )
                    ]
                )
            return SimpleNamespace(
                items=[
                    SimpleNamespace(
                        title="From GB Search", author_names=["GB Search Author"]
                    )
                ]
            )

    auth = AuthContext(
        claims={},
        client_id=uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
        user_id=uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"),
    )
    assert (
        goodreads_imports_module._google_books_enabled_for_user(
            auth=auth,
            session=cast(Session, object()),
            settings=cast(
                Settings,
                SimpleNamespace(
                    book_provider_google_enabled=False, google_books_api_key="key"
                ),
            ),
        )
        is False
    )
    assert (
        goodreads_imports_module._google_books_enabled_for_user(
            auth=auth,
            session=cast(Session, object()),
            settings=cast(
                Settings,
                SimpleNamespace(
                    book_provider_google_enabled=True, google_books_api_key=None
                ),
            ),
        )
        is False
    )
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_or_create_profile",
        lambda *_args, **_kwargs: SimpleNamespace(enable_google_books=True),
    )
    assert (
        goodreads_imports_module._google_books_enabled_for_user(
            auth=auth,
            session=cast(Session, object()),
            settings=cast(
                Settings,
                SimpleNamespace(
                    book_provider_google_enabled=True, google_books_api_key="key"
                ),
            ),
        )
        is True
    )

    assert goodreads_imports_module._author_list_to_value([" A ", ""]) == "A"
    assert goodreads_imports_module._author_list_to_value(["", " "]) is None

    assert (
        goodreads_imports_module._parse_row_override_payload(
            None,
            key_name="author_overrides",
        )
        is None
    )

    issue = GoodreadsMissingRequiredField(
        row_number=2,
        field="read_status",
        title="Book",
        uid="9780000000001",
    )
    resolved = goodreads_imports_module._resolve_missing_item(
        issue=issue,
        suggestion=goodreads_imports_module._MetadataSuggestion(
            title="Suggested",
            authors="Suggested Author",
            source="openlibrary:isbn",
            confidence="high",
        ),
    )
    assert resolved["suggested_value"] is None
    assert resolved["issue_code"] == "missing_read_status"
    assert resolved["required"] is True

    ol = cast(OpenLibraryClient, _OpenLibrary())
    gb = cast(GoogleBooksClient, _GoogleBooks())
    direct = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title="Any",
            uid="9780000000001",
            include_google_books=False,
        )
    )
    assert direct.source == "openlibrary:isbn"

    isbn_fallback = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title="Any",
            uid="9780000000002",
            include_google_books=True,
        )
    )
    assert isbn_fallback.source == "googlebooks:isbn"

    search_fallback = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title="Title Only",
            uid=None,
            include_google_books=False,
        )
    )
    assert search_fallback.source == "openlibrary:search"

    no_match = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title=None,
            uid=None,
            include_google_books=False,
        )
    )
    assert no_match.source is None


def test_goodreads_metadata_suggestion_exception_and_search_fallback_paths() -> None:
    class _OpenLibraryAlwaysFails:
        async def find_work_key_by_isbn(self, *, isbn: str) -> str | None:
            raise RuntimeError("lookup failed")

        async def fetch_work_bundle(self, *, work_key: str) -> object:
            raise RuntimeError("bundle failed")

        async def search_books(self, *, query: str, limit: int) -> object:
            if query == "GBOnly":
                return SimpleNamespace(items=[])
            raise RuntimeError("search failed")

    class _GoogleBooksSometimesFails:
        async def search_books(self, *, query: str, limit: int) -> object:
            if query == "GBOnly":
                return SimpleNamespace(
                    items=[
                        SimpleNamespace(title="GB Result", author_names=["GB Author"])
                    ]
                )
            raise RuntimeError("google failed")

    ol = cast(OpenLibraryClient, _OpenLibraryAlwaysFails())
    gb = cast(GoogleBooksClient, _GoogleBooksSometimesFails())

    isbn_none = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title=None,
            uid="9780000000001",
            include_google_books=True,
        )
    )
    assert isbn_none.source is None

    gb_search = asyncio.run(
        goodreads_imports_module._fetch_metadata_suggestion(
            open_library=ol,
            google_books=gb,
            title="GBOnly",
            uid=None,
            include_google_books=True,
        )
    )
    assert gb_search.source == "googlebooks:search"


def test_get_goodreads_missing_authors_rejects_non_csv(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads/missing-required",
        files={"file": ("goodreads.txt", b"Title,Authors\n", "text/plain")},
    )
    assert response.status_code == 400
    assert "file must be a .csv export" in response.text


def test_get_goodreads_missing_authors_rejects_empty_file(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post(
        "/api/v1/imports/goodreads/missing-required",
        files={"file": ("goodreads.csv", b"", "text/csv")},
    )
    assert response.status_code == 400
    assert "file is empty" in response.text


def test_get_goodreads_import_job_not_found(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.goodreads_imports.get_goodreads_job",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("import job not found")
        ),
    )
    client = TestClient(app)
    response = client.get(
        "/api/v1/imports/goodreads/11111111-1111-1111-1111-111111111111"
    )
    assert response.status_code == 404


def test_get_goodreads_import_rows_not_found(
    app: FastAPI, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        "app.routers.goodreads_imports.list_goodreads_job_rows",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            LookupError("import job not found")
        ),
    )
    client = TestClient(app)
    response = client.get(
        "/api/v1/imports/goodreads/11111111-1111-1111-1111-111111111111/rows"
    )
    assert response.status_code == 404
