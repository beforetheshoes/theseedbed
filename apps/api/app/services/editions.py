from __future__ import annotations

import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Edition
from app.db.models.users import LibraryItem


def update_edition_totals(
    session: Session,
    *,
    user_id: uuid.UUID,
    edition_id: uuid.UUID,
    updates: dict[str, int | None],
) -> Edition:
    if not updates:
        raise ValueError(
            "at least one of total_pages or total_audio_minutes is required"
        )

    edition = session.get(Edition, edition_id)
    if edition is None:
        raise LookupError("edition not found")

    has_membership = session.scalar(
        sa.select(LibraryItem.id).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == edition.work_id,
        )
    )
    if has_membership is None:
        raise PermissionError("book must be in your library to update edition totals")

    if "total_pages" in updates:
        total_pages = updates["total_pages"]
        if total_pages is not None and total_pages < 1:
            raise ValueError("total_pages must be at least 1")
        edition.total_pages = total_pages

    if "total_audio_minutes" in updates:
        total_audio_minutes = updates["total_audio_minutes"]
        if total_audio_minutes is not None and total_audio_minutes < 1:
            raise ValueError("total_audio_minutes must be at least 1")
        edition.total_audio_minutes = total_audio_minutes

    session.commit()
    return edition
