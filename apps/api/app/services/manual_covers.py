from __future__ import annotations

import datetime as dt
import hashlib
import uuid
from urllib.parse import urlparse

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.db.models.users import LibraryItem
from app.services.covers import cache_cover_to_storage, cache_edition_cover_from_url
from app.services.images import ImageValidationError, normalize_cover_image
from app.services.storage import upload_storage_object

_MAX_COVER_BYTES = 10 * 1024 * 1024
_MAX_COVER_DIMENSION = 4000


def _require_library_membership(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
) -> None:
    exists = session.scalar(
        sa.select(LibraryItem.id).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if exists is None:
        raise PermissionError("book must be in your library to set a cover")


def _work_has_global_cover(session: Session, *, work_id: uuid.UUID) -> bool:
    work = session.get(Work, work_id)
    if work is not None and work.default_cover_url:
        return True
    any_edition_cover = session.scalar(
        sa.select(Edition.id)
        .where(Edition.work_id == work_id, Edition.cover_url.is_not(None))
        .limit(1)
    )
    return any_edition_cover is not None


def _require_library_item(
    session: Session, *, user_id: uuid.UUID, work_id: uuid.UUID
) -> LibraryItem:
    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if item is None:
        raise PermissionError("book must be in your library to set a cover")
    return item


def _is_allowed_cover_source(*, settings: Settings, source_url: str) -> bool:
    parsed = urlparse(source_url)
    if parsed.scheme not in {"http", "https"}:
        return False

    # Host allowlists are brittle in practice; safety checks are enforced centrally
    # when we fetch/cache the image (see cache_cover_to_storage()).
    return bool(parsed.hostname)


async def set_edition_cover_from_upload(
    session: Session,
    *,
    settings: Settings,
    user_id: uuid.UUID,
    edition_id: uuid.UUID,
    content: bytes,
    content_type: str | None,
) -> dict[str, str]:
    edition = session.get(Edition, edition_id)
    if edition is None:
        raise LookupError("edition not found")

    _require_library_membership(session, user_id=user_id, work_id=edition.work_id)

    normalized_bytes, out_content_type = normalize_cover_image(
        content=content,
        content_type=content_type,
        max_bytes=_MAX_COVER_BYTES,
        max_dimension=_MAX_COVER_DIMENSION,
    )
    digest = hashlib.sha256(content).hexdigest()[:16]
    now = dt.datetime.now(tz=dt.UTC)

    if _work_has_global_cover(session, work_id=edition.work_id):
        item = _require_library_item(session, user_id=user_id, work_id=edition.work_id)
        path = f"manual-overrides/{user_id}/{edition.work_id}/{digest}.jpg"
        upload = await upload_storage_object(
            settings=settings,
            bucket=settings.supabase_storage_covers_bucket,
            path=path,
            content=normalized_bytes,
            content_type=out_content_type,
            upsert=True,
        )
        item.cover_override_url = upload.public_url
        item.cover_override_storage_path = upload.path
        item.cover_override_set_by = user_id
        item.cover_override_set_at = now
        session.commit()
        return {"cover_url": upload.public_url}

    path = f"manual/{edition.work_id}/{edition.id}/{digest}.jpg"

    upload = await upload_storage_object(
        settings=settings,
        bucket=settings.supabase_storage_covers_bucket,
        path=path,
        content=normalized_bytes,
        content_type=out_content_type,
        upsert=True,
    )

    edition.cover_url = upload.public_url
    edition.cover_storage_path = upload.path
    edition.cover_set_by = user_id
    edition.cover_set_at = now

    work = session.get(Work, edition.work_id)
    if work is not None:
        work.default_cover_url = upload.public_url
        work.default_cover_storage_path = upload.path
        work.default_cover_set_by = user_id
        work.default_cover_set_at = now

    session.commit()
    return {"cover_url": upload.public_url}


async def cache_edition_cover_from_source_url(
    session: Session,
    *,
    settings: Settings,
    user_id: uuid.UUID,
    edition_id: uuid.UUID,
    source_url: str,
) -> dict[str, str | bool | None]:
    if not _is_allowed_cover_source(settings=settings, source_url=source_url):
        raise ValueError("source_url must be an http(s) URL")

    edition = session.get(Edition, edition_id)
    if edition is None:
        raise LookupError("edition not found")

    _require_library_membership(session, user_id=user_id, work_id=edition.work_id)

    if _work_has_global_cover(session, work_id=edition.work_id):
        item = _require_library_item(session, user_id=user_id, work_id=edition.work_id)
        upload = await cache_cover_to_storage(settings=settings, source_url=source_url)
        now = dt.datetime.now(tz=dt.UTC)
        item.cover_override_url = upload.public_url
        item.cover_override_storage_path = upload.path or None
        item.cover_override_set_by = user_id
        item.cover_override_set_at = now
        session.commit()
        return {"cached": True, "cover_url": upload.public_url}

    result = await cache_edition_cover_from_url(
        session,
        settings=settings,
        edition_id=edition_id,
        source_url=source_url,
        user_id=user_id,
    )

    # Ensure user-triggered provenance even if cover already cached.
    if result.cover_url:
        edition = session.get(Edition, edition_id)
        if edition is not None:
            now = dt.datetime.now(tz=dt.UTC)
            edition.cover_set_by = user_id
            edition.cover_set_at = now
            if result.storage is not None:
                edition.cover_storage_path = result.storage.path

            work = session.get(Work, edition.work_id)
            if work is not None:
                work.default_cover_url = result.cover_url
                work.default_cover_set_by = user_id
                work.default_cover_set_at = now
                if result.storage is not None:
                    work.default_cover_storage_path = result.storage.path
            session.commit()

    return {"cached": result.cached, "cover_url": result.cover_url}


__all__ = [
    "ImageValidationError",
    "cache_edition_cover_from_source_url",
    "set_edition_cover_from_upload",
]
