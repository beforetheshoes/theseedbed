from __future__ import annotations

import asyncio
import io
import uuid
from typing import Any

import pytest
from PIL import Image

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.services import manual_covers
from app.services.covers import CoverCacheResult
from app.services.manual_covers import (
    cache_edition_cover_from_source_url,
    set_edition_cover_from_upload,
)
from app.services.storage import StorageUploadResult


class FakeSession:
    def __init__(self) -> None:
        self._editions: dict[uuid.UUID, Edition] = {}
        self._works: dict[uuid.UUID, Work] = {}
        self.scalar_values: list[Any] = []
        self.committed = False

    def get(self, model: object, ident: uuid.UUID) -> Any:
        if model is Edition:
            return self._editions.get(ident)
        if model is Work:
            return self._works.get(ident)
        return None

    def scalar(self, _stmt: object) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
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


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (20, 30), (10, 20, 30))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_cache_cover_rejects_unapproved_source_host() -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    work_id = uuid.uuid4()
    session._editions[edition_id] = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session._works[work_id] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    # Membership exists
    session.scalar_values = [uuid.uuid4()]

    async def run() -> None:
        await cache_edition_cover_from_source_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=uuid.uuid4(),
            edition_id=edition_id,
            source_url="https://evil.example.com/x.jpg",
        )

    with pytest.raises(ValueError, match="approved host"):
        asyncio.run(run())


def test_set_cover_from_upload_updates_work_and_edition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    work_id = uuid.uuid4()
    user_id = uuid.uuid4()

    session._editions[edition_id] = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session._works[work_id] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    # Membership exists
    session.scalar_values = [uuid.uuid4()]

    async def fake_upload_storage_object(**_kwargs: Any) -> StorageUploadResult:
        return StorageUploadResult(
            public_url="https://example.supabase.co/storage/v1/object/public/covers/manual/x.jpg",
            bucket="covers",
            path="manual/x.jpg",
        )

    monkeypatch.setattr(
        manual_covers, "upload_storage_object", fake_upload_storage_object
    )

    async def run() -> None:
        await set_edition_cover_from_upload(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=user_id,
            edition_id=edition_id,
            content=_jpeg_bytes(),
            content_type="image/jpeg",
        )

    asyncio.run(run())
    edition = session._editions[edition_id]
    work = session._works[work_id]
    assert edition.cover_url is not None
    assert work.default_cover_url == edition.cover_url
    assert edition.cover_set_by == user_id
    assert work.default_cover_set_by == user_id
    assert session.committed is True


def test_set_cover_requires_library_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    work_id = uuid.uuid4()

    session._editions[edition_id] = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session._works[work_id] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = [None]

    async def run() -> None:
        await set_edition_cover_from_upload(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=uuid.uuid4(),
            edition_id=edition_id,
            content=_jpeg_bytes(),
            content_type="image/jpeg",
        )

    with pytest.raises(PermissionError):
        asyncio.run(run())


def test_cache_cover_updates_provenance_and_storage_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    edition_id = uuid.uuid4()
    work_id = uuid.uuid4()
    user_id = uuid.uuid4()

    session._editions[edition_id] = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session._works[work_id] = Work(
        id=work_id,
        title="Book",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.scalar_values = [uuid.uuid4()]

    async def fake_cache(*_args: Any, **_kwargs: Any) -> CoverCacheResult:
        session._editions[edition_id].cover_url = (
            "https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg"
        )
        return CoverCacheResult(
            cached=True,
            cover_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
            storage=StorageUploadResult(
                public_url="https://example.supabase.co/storage/v1/object/public/covers/openlibrary/x.jpg",
                bucket="covers",
                path="openlibrary/x.jpg",
            ),
        )

    monkeypatch.setattr(manual_covers, "cache_edition_cover_from_url", fake_cache)

    async def run() -> None:
        result = await cache_edition_cover_from_source_url(
            session,  # type: ignore[arg-type]
            settings=_settings(),
            user_id=user_id,
            edition_id=edition_id,
            source_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        )
        assert result["cached"] is True

    asyncio.run(run())
    edition = session._editions[edition_id]
    work = session._works[work_id]
    assert edition.cover_set_by == user_id
    assert edition.cover_storage_path == "openlibrary/x.jpg"
    assert work.default_cover_storage_path == "openlibrary/x.jpg"
    assert work.default_cover_url == edition.cover_url
    assert session.committed is True
