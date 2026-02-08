from __future__ import annotations

import asyncio
import uuid
from typing import Any, cast

import pytest
import sqlalchemy as sa

from app.core.config import Settings
from app.db.models.bibliography import Author, Edition, Work
from app.db.models.external_provider import ExternalId
from app.services.manual_books import create_manual_book
from app.services.storage import StorageUploadResult


class FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.committed = False

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def flush(self) -> None:
        for obj in self.added:
            if getattr(obj, "id", None) is None and hasattr(obj, "id"):
                obj.id = uuid.uuid4()

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        # Author lookups return None (create new authors).
        return None

    def commit(self) -> None:
        self.committed = True


def _settings() -> Settings:
    return Settings(
        supabase_url="https://example.supabase.co",
        supabase_jwt_audience="authenticated",
        supabase_jwt_secret=None,
        supabase_jwks_cache_ttl_seconds=60,
        supabase_service_role_key="service-role",
        supabase_storage_covers_bucket="covers",
        public_highlight_max_chars=280,
        api_version="0.1.0",
    )


def test_create_manual_book_creates_records_and_uploads_cover(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_upload(**_kwargs: Any) -> StorageUploadResult:
        return StorageUploadResult(
            public_url="https://example.supabase.co/storage/v1/object/public/covers/x",
            bucket="covers",
            path="x",
        )

    monkeypatch.setattr("app.services.manual_books.upload_storage_object", fake_upload)

    session = FakeSession()

    result = asyncio.run(
        create_manual_book(
            cast(Any, session),
            settings=_settings(),
            title="Title",
            authors=["Author A"],
            isbn="1234567890",
            cover_bytes=b"img",
            cover_content_type="image/jpeg",
        )
    )

    assert session.committed is True
    assert "work" in result
    assert "edition" in result

    works = [obj for obj in session.added if isinstance(obj, Work)]
    editions = [obj for obj in session.added if isinstance(obj, Edition)]
    authors = [obj for obj in session.added if isinstance(obj, Author)]
    externals = [obj for obj in session.added if isinstance(obj, ExternalId)]
    assert len(works) == 1
    assert len(editions) == 1
    assert len(authors) == 1
    assert any(e.provider == "manual" and e.entity_type == "work" for e in externals)
    assert any(e.provider == "manual" and e.entity_type == "edition" for e in externals)


def test_create_manual_book_validates_inputs() -> None:
    session = FakeSession()
    try:
        asyncio.run(
            create_manual_book(
                cast(Any, session),
                settings=_settings(),
                title="   ",
                authors=["A"],
                isbn=None,
                cover_bytes=None,
                cover_content_type=None,
            )
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for blank title")

    session = FakeSession()
    try:
        asyncio.run(
            create_manual_book(
                cast(Any, session),
                settings=_settings(),
                title="T",
                authors=[],
                isbn=None,
                cover_bytes=None,
                cover_content_type=None,
            )
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for empty authors")
