from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId


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
    cover_url = edition_cover or work.default_cover_url

    return {
        "id": str(work.id),
        "title": work.title,
        "description": work.description,
        "first_publish_year": work.first_publish_year,
        "cover_url": cover_url,
        "authors": [{"id": str(a.id), "name": a.name} for a in authors],
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
