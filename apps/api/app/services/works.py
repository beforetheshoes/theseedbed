from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId, SourceRecord
from app.services.catalog import import_openlibrary_bundle
from app.services.open_library import OpenLibraryClient


def get_work_detail(session: Session, *, work_id: uuid.UUID) -> dict[str, Any]:
    work = session.get(Work, work_id)
    if work is None:
        raise LookupError("work not found")

    authors = (
        session.execute(
            sa.select(Author)
            .join(WorkAuthor, WorkAuthor.author_id == Author.id)
            .where(WorkAuthor.work_id == work_id)
            .order_by(Author.name.asc(), Author.id.asc())
        )
        .scalars()
        .all()
    )

    edition_cover = session.scalar(
        sa.select(Edition.cover_url)
        .where(Edition.work_id == work_id, Edition.cover_url.is_not(None))
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(1)
    )
    selected_edition = session.scalar(
        sa.select(Edition)
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(1)
    )
    cover_url = edition_cover or work.default_cover_url
    asin: str | None = None
    if selected_edition is not None:
        asin = session.scalar(
            sa.select(ExternalId.provider_id)
            .where(
                ExternalId.entity_type == "edition",
                ExternalId.entity_id == selected_edition.id,
                ExternalId.provider.in_(["asin", "amazon"]),
            )
            .limit(1)
        )
    if asin is None:
        asin = session.scalar(
            sa.select(ExternalId.provider_id)
            .where(
                ExternalId.entity_type == "work",
                ExternalId.entity_id == work_id,
                ExternalId.provider.in_(["asin", "amazon"]),
            )
            .limit(1)
        )

    return {
        "id": str(work.id),
        "title": work.title,
        "description": work.description,
        "first_publish_year": work.first_publish_year,
        "cover_url": cover_url,
        "authors": [{"id": str(a.id), "name": a.name} for a in authors],
        "identifiers": {
            "isbn10": selected_edition.isbn10 if selected_edition else None,
            "isbn13": selected_edition.isbn13 if selected_edition else None,
            "asin": asin,
        },
    }


def list_work_editions(
    session: Session,
    *,
    work_id: uuid.UUID,
    limit: int = 20,
) -> list[dict[str, Any]]:
    work = session.get(Work, work_id)
    if work is None:
        raise LookupError("work not found")

    ext = sa.orm.aliased(ExternalId)
    stmt = (
        sa.select(Edition, ext.provider, ext.provider_id)
        .join(
            ext,
            sa.and_(
                ext.entity_type == "edition",
                ext.entity_id == Edition.id,
            ),
            isouter=True,
        )
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(limit)
    )

    rows = session.execute(stmt).all()
    items: list[dict[str, Any]] = []
    for edition, provider, provider_id in rows:
        items.append(
            {
                "id": str(edition.id),
                "work_id": str(edition.work_id),
                "isbn10": edition.isbn10,
                "isbn13": edition.isbn13,
                "publisher": edition.publisher,
                "publish_date": (
                    edition.publish_date.isoformat() if edition.publish_date else None
                ),
                "cover_url": edition.cover_url,
                "created_at": edition.created_at.isoformat(),
                "provider": provider,
                "provider_id": provider_id,
            }
        )
    return items


def get_openlibrary_work_key(session: Session, *, work_id: uuid.UUID) -> str | None:
    return session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )


async def list_related_works(
    session: Session,
    *,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
    limit: int = 12,
) -> list[dict[str, Any]]:
    work_key = get_openlibrary_work_key(session, work_id=work_id)
    if not work_key:
        return []
    raw_work = session.scalar(
        sa.select(SourceRecord.raw).where(
            SourceRecord.provider == "openlibrary",
            SourceRecord.entity_type == "work",
            SourceRecord.provider_id == work_key,
        )
    )
    if not isinstance(raw_work, dict):
        return []
    related = await open_library.fetch_related_works(
        work_payload=raw_work,
        exclude_work_key=work_key,
        max_items=limit,
    )
    return [
        {
            "work_key": item.work_key,
            "title": item.title,
            "cover_url": item.cover_url,
            "first_publish_year": item.first_publish_year,
            "author_names": item.author_names,
        }
        for item in related
    ]


async def get_openlibrary_author_profile(
    session: Session,
    *,
    author_id: uuid.UUID,
    open_library: OpenLibraryClient,
) -> dict[str, Any]:
    author = session.get(Author, author_id)
    if author is None:
        raise LookupError("author not found")
    author_key = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "author",
            ExternalId.entity_id == author_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if not isinstance(author_key, str):
        raise LookupError("author does not have an Open Library mapping")
    profile = await open_library.fetch_author_profile(author_key=author_key)
    return {
        "id": str(author.id),
        "name": profile.name,
        "bio": profile.bio,
        "photo_url": profile.photo_url,
        "openlibrary_author_key": profile.author_key,
        "works": [
            {
                "work_key": work.work_key,
                "title": work.title,
                "cover_url": work.cover_url,
                "first_publish_year": work.first_publish_year,
            }
            for work in profile.top_works
        ],
    }


async def refresh_work_if_stale(
    session: Session,
    *,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
    max_age_days: int = 30,
) -> bool:
    work_key = get_openlibrary_work_key(session, work_id=work_id)
    if not work_key:
        return False
    fetched_at = session.scalar(
        sa.select(SourceRecord.fetched_at).where(
            SourceRecord.provider == "openlibrary",
            SourceRecord.entity_type == "work",
            SourceRecord.provider_id == work_key,
        )
    )
    if isinstance(fetched_at, dt.datetime):
        age = dt.datetime.now(dt.UTC) - fetched_at.astimezone(dt.UTC)
        if age < dt.timedelta(days=max_age_days):
            return False

    bundle = await open_library.fetch_work_bundle(work_key=work_key)
    import_openlibrary_bundle(session, bundle=bundle)
    return True
