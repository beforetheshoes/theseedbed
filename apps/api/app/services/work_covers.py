from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Edition, Work
from app.db.models.external_provider import ExternalId, SourceRecord
from app.db.models.users import LibraryItem
from app.services.covers import cache_cover_to_storage, cache_edition_cover_from_url
from app.services.open_library import OpenLibraryClient


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


async def list_openlibrary_cover_candidates(
    session: Session,
    *,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
) -> list[dict[str, object]]:
    provider_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if provider_id is None:
        return []

    cover_ids: list[int] = []
    source = session.scalar(
        sa.select(SourceRecord).where(
            SourceRecord.provider == "openlibrary",
            SourceRecord.entity_type == "work",
            SourceRecord.provider_id == provider_id,
        )
    )
    if source is not None and isinstance(source.raw, dict):
        covers = source.raw.get("covers")
        if isinstance(covers, list):
            for c in covers:
                if isinstance(c, int) and c > 0:
                    cover_ids.append(c)

    if not cover_ids:
        # Fall back to Open Library directly. Some works have covers only on editions.
        cover_ids = await open_library.fetch_cover_ids_for_work(
            work_key=provider_id, editions_limit=50
        )

    # Stable, de-duped ordering.
    seen: set[int] = set()
    items: list[dict[str, object]] = []
    for cover_id in cover_ids:
        if cover_id in seen:
            continue
        seen.add(cover_id)
        items.append(
            {
                "cover_id": cover_id,
                "thumbnail_url": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg",
                "image_url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
            }
        )
    return items


async def select_openlibrary_cover(
    session: Session,
    *,
    settings: Settings,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    cover_id: int,
) -> dict[str, object]:
    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if item is None:
        raise PermissionError("book must be in your library to set a cover")

    source_url = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
    now = dt.datetime.now(tz=dt.UTC)

    if not _work_has_global_cover(session, work_id=work_id):
        edition_id = item.preferred_edition_id
        if edition_id is None:
            edition_id = session.scalar(
                sa.select(Edition.id)
                .where(Edition.work_id == work_id)
                .order_by(Edition.created_at.desc(), Edition.id.desc())
                .limit(1)
            )

        if edition_id is not None:
            result = await cache_edition_cover_from_url(
                session,
                settings=settings,
                edition_id=edition_id,
                source_url=source_url,
                user_id=user_id,
            )
            return {"scope": "global", "cover_url": result.cover_url}

        upload = await cache_cover_to_storage(settings=settings, source_url=source_url)
        work = session.get(Work, work_id)
        if work is None:
            raise LookupError("work not found")
        work.default_cover_url = upload.public_url
        work.default_cover_storage_path = upload.path
        work.default_cover_set_by = user_id
        work.default_cover_set_at = now
        session.commit()
        return {"scope": "global", "cover_url": upload.public_url}

    upload = await cache_cover_to_storage(settings=settings, source_url=source_url)
    item.cover_override_url = upload.public_url
    item.cover_override_storage_path = upload.path or None
    item.cover_override_set_by = user_id
    item.cover_override_set_at = now
    session.commit()
    return {"scope": "override", "cover_url": upload.public_url}
