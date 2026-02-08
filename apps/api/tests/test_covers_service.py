from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx
import sqlalchemy as sa

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.services.covers import cache_edition_cover_from_url


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.get_values: list[Any] = []
        self.committed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def get(self, _model: object, _id: object) -> Any:
        if self.get_values:
            return self.get_values.pop(0)
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


def test_cache_cover_noops_when_already_supabase_url() -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://example.supabase.co/storage/v1/object/public/covers/x.jpg",
        )
    )
    assert result.cached is False
    assert result.cover_url is not None
    assert session.committed is False


def test_cache_cover_downloads_uploads_and_updates_edition() -> None:
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=uuid.uuid4(),
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    work = Work(
        id=edition.work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session = FakeSession()
    session.scalar_values = [edition]
    session.get_values = [work]

    def download_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "GET"
        return httpx.Response(
            200,
            headers={"Content-Type": "image/jpeg"},
            content=b"img",
        )

    def upload_handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "PUT"
        assert request.headers["authorization"] == "Bearer service-role"
        return httpx.Response(200, json={"Key": "ok"})

    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
            transport=httpx.MockTransport(download_handler),
            storage_transport=httpx.MockTransport(upload_handler),
        )
    )

    assert result.cached is True
    assert edition.cover_url is not None
    assert edition.cover_url.startswith(
        "https://example.supabase.co/storage/v1/object/public/covers/openlibrary/"
    )
    assert work.default_cover_url == edition.cover_url
    assert session.committed is True


def test_cache_cover_raises_when_edition_missing() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    try:
        asyncio.run(
            cache_edition_cover_from_url(
                session,  # type: ignore[arg-type]
                settings=_settings(),
                edition_id=uuid.uuid4(),
                source_url="https://covers.openlibrary.org/b/id/1-L.png",
            )
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")


def test_cache_cover_noops_when_edition_cover_already_cached() -> None:
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=uuid.uuid4(),
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url="https://example.supabase.co/storage/v1/object/public/covers/already.jpg",
    )
    session = FakeSession()
    session.scalar_values = [edition]
    result = asyncio.run(
        cache_edition_cover_from_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        )
    )
    assert result.cached is False
    assert result.cover_url == edition.cover_url
