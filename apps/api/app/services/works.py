from __future__ import annotations

import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor


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
