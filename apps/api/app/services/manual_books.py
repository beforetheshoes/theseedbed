from __future__ import annotations

import hashlib
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId
from app.services.storage import upload_storage_object


async def create_manual_book(
    session: Session,
    *,
    settings: Settings,
    title: str,
    authors: list[str],
    isbn: str | None,
    cover_bytes: bytes | None,
    cover_content_type: str | None,
) -> dict[str, Any]:
    normalized_title = title.strip()
    if not normalized_title:
        raise ValueError("title cannot be blank")
    if not authors:
        raise ValueError("authors cannot be empty")

    work = Work(title=normalized_title, description=None, first_publish_year=None)
    session.add(work)
    session.flush()

    session.add(
        ExternalId(
            entity_type="work",
            entity_id=work.id,
            provider="manual",
            provider_id=str(work.id),
        )
    )

    author_models: list[Author] = []
    for name in authors:
        normalized = name.strip()
        if not normalized:
            continue
        existing = session.scalar(sa.select(Author).where(Author.name == normalized))
        if existing is None:
            existing = Author(name=normalized)
            session.add(existing)
            session.flush()
        author_models.append(existing)
        session.add(WorkAuthor(work_id=work.id, author_id=existing.id))

    edition = Edition(
        work_id=work.id,
        isbn10=isbn if isbn and len(isbn) <= 10 else None,
        isbn13=isbn if isbn and len(isbn) > 10 else None,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session.add(edition)
    session.flush()
    session.add(
        ExternalId(
            entity_type="edition",
            entity_id=edition.id,
            provider="manual",
            provider_id=str(edition.id),
        )
    )

    if cover_bytes is not None and cover_content_type is not None:
        digest = hashlib.sha256(cover_bytes).hexdigest()[:32]
        # One cover per edition content hash, deterministic to avoid duplicates.
        path = f"manual/{work.id}/{edition.id}/{digest}"
        upload = await upload_storage_object(
            settings=settings,
            bucket=settings.supabase_storage_covers_bucket,
            path=path,
            content=cover_bytes,
            content_type=cover_content_type,
            upsert=True,
        )
        edition.cover_url = upload.public_url
        work.default_cover_url = upload.public_url

    session.commit()

    return {
        "work": {"id": str(work.id), "title": work.title},
        "edition": {"id": str(edition.id), "cover_url": edition.cover_url},
        "authors": [{"id": str(a.id), "name": a.name} for a in author_models],
    }
