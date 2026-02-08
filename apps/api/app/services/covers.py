from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.services.storage import StorageUploadResult, upload_storage_object


@dataclass(frozen=True)
class CoverCacheResult:
    cached: bool
    cover_url: str | None
    storage: StorageUploadResult | None = None


def _is_supabase_storage_url(*, settings: Settings, url: str) -> bool:
    if not settings.supabase_url:
        return False
    return url.startswith(f"{settings.supabase_url.rstrip('/')}/storage/v1/")


def _guess_extension(url: str) -> str:
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        if path.endswith(ext):
            return ext
    return ".jpg"


async def cache_edition_cover_from_url(
    session: Session,
    *,
    settings: Settings,
    edition_id: uuid.UUID,
    source_url: str | None,
    user_id: uuid.UUID | None = None,
    transport: httpx.AsyncBaseTransport | None = None,
    storage_transport: httpx.AsyncBaseTransport | None = None,
) -> CoverCacheResult:
    if not source_url:
        return CoverCacheResult(cached=False, cover_url=None)
    if _is_supabase_storage_url(settings=settings, url=source_url):
        return CoverCacheResult(cached=False, cover_url=source_url)

    edition = session.scalar(sa.select(Edition).where(Edition.id == edition_id))
    if edition is None:
        raise LookupError("edition not found")

    if edition.cover_url and _is_supabase_storage_url(
        settings=settings, url=edition.cover_url
    ):
        return CoverCacheResult(cached=False, cover_url=edition.cover_url)

    async with httpx.AsyncClient(timeout=20.0, transport=transport) as client:
        response = await client.get(
            source_url, headers={"User-Agent": "TheSeedbed/0.1"}
        )
    response.raise_for_status()

    content_type = response.headers.get("Content-Type", "image/jpeg").split(";")[0]
    ext = _guess_extension(source_url)
    digest = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:32]
    path = f"openlibrary/{digest}{ext}"

    upload = await upload_storage_object(
        settings=settings,
        bucket=settings.supabase_storage_covers_bucket,
        path=path,
        content=response.content,
        content_type=content_type,
        upsert=True,
        transport=storage_transport,
    )

    edition.cover_url = upload.public_url
    edition.cover_storage_path = upload.path
    edition.cover_set_by = user_id
    edition.cover_set_at = dt.datetime.now(tz=dt.UTC)

    work = session.get(Work, edition.work_id)
    if work is not None:
        work.default_cover_url = upload.public_url
        work.default_cover_storage_path = upload.path
        work.default_cover_set_by = user_id
        work.default_cover_set_at = dt.datetime.now(tz=dt.UTC)
    session.commit()

    return CoverCacheResult(cached=True, cover_url=upload.public_url, storage=upload)
