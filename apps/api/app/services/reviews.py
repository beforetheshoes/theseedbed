from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.content import Review
from app.db.models.users import LibraryItem

REVIEW_VISIBILITIES = {"private", "unlisted", "public"}


def list_public_reviews_for_work(
    session: Session,
    *,
    work_id: uuid.UUID,
    limit: int,
) -> list[dict[str, Any]]:
    rows = session.execute(
        sa.select(Review, LibraryItem.work_id)
        .join(LibraryItem, LibraryItem.id == Review.library_item_id)
        .where(
            LibraryItem.work_id == work_id,
            Review.visibility == "public",
        )
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(limit)
    ).all()
    items: list[dict[str, Any]] = []
    for review, _work_id in rows:
        items.append(
            {
                "id": str(review.id),
                "user_id": str(review.user_id),
                "title": review.title,
                "body": review.body,
                "rating": review.rating,
                "created_at": review.created_at.isoformat(),
            }
        )
    return items


def list_reviews_for_user(
    session: Session, *, user_id: uuid.UUID, limit: int
) -> list[dict[str, Any]]:
    rows = session.execute(
        sa.select(Review, LibraryItem.work_id, LibraryItem.preferred_edition_id)
        .join(LibraryItem, LibraryItem.id == Review.library_item_id)
        .where(Review.user_id == user_id)
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(limit)
    ).all()
    items: list[dict[str, Any]] = []
    for review, work_id, edition_id in rows:
        items.append(
            {
                "id": str(review.id),
                "work_id": str(work_id),
                "edition_id": str(edition_id) if edition_id else None,
                "title": review.title,
                "body": review.body,
                "rating": review.rating,
                "visibility": review.visibility,
                "created_at": review.created_at.isoformat(),
                "updated_at": review.updated_at.isoformat(),
            }
        )
    return items


def upsert_review_for_work(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    title: str | None,
    body: str,
    rating: int | None,
    visibility: str,
    edition_id: uuid.UUID | None,
) -> Review:
    normalized_visibility = visibility.strip().lower()
    if normalized_visibility not in REVIEW_VISIBILITIES:
        raise ValueError("invalid visibility")
    if rating is not None and not (1 <= rating <= 5):
        raise ValueError("rating must be between 1 and 5")

    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if item is None:
        raise LookupError("library item not found for work")

    if edition_id is not None:
        item.preferred_edition_id = edition_id

    model = session.scalar(
        sa.select(Review)
        .where(
            Review.user_id == user_id,
            Review.library_item_id == item.id,
        )
        .order_by(Review.created_at.desc(), Review.id.desc())
        .limit(1)
    )
    now = dt.datetime.now(tz=dt.UTC)
    if model is None:
        model = Review(
            user_id=user_id,
            library_item_id=item.id,
            title=title.strip() if title else None,
            body=body,
            rating=rating,
            visibility=normalized_visibility,
            created_at=now,
            updated_at=now,
        )
        session.add(model)
    else:
        model.title = title.strip() if title else None
        model.body = body
        model.rating = rating
        model.visibility = normalized_visibility
        model.updated_at = now

    session.commit()
    return model


def delete_review(
    session: Session, *, user_id: uuid.UUID, review_id: uuid.UUID
) -> None:
    model = session.scalar(
        sa.select(Review).where(Review.id == review_id, Review.user_id == user_id)
    )
    if model is None:
        raise LookupError("review not found")
    session.delete(model)
    session.commit()
