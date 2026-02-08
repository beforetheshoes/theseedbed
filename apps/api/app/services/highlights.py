from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.content import Highlight
from app.db.models.users import LibraryItem

HIGHLIGHT_VISIBILITIES = {"private", "unlisted", "public"}


def _ensure_library_item_owned(
    session: Session, *, user_id: uuid.UUID, library_item_id: uuid.UUID
) -> None:
    exists = session.scalar(
        sa.select(LibraryItem.id).where(
            LibraryItem.id == library_item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if exists is None:
        raise LookupError("library item not found")


def _enforce_public_quote_limit(*, quote: str, visibility: str, max_chars: int) -> str:
    if visibility == "public" and len(quote) > max_chars:
        raise ValueError("public highlight exceeds character limit")
    return quote


def _normalize_quote_for_response(
    *, quote: str, visibility: str, max_chars: int
) -> str:
    # Defensive: never return more than max_chars for public highlights.
    if visibility == "public" and len(quote) > max_chars:
        return quote[:max_chars]
    return quote


def list_highlights(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    limit: int,
    max_public_chars: int,
) -> list[dict[str, Any]]:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    rows = session.execute(
        sa.select(Highlight)
        .where(
            Highlight.user_id == user_id,
            Highlight.library_item_id == library_item_id,
        )
        .order_by(Highlight.created_at.desc(), Highlight.id.desc())
        .limit(limit)
    ).scalars()
    return [
        {
            "id": str(row.id),
            "library_item_id": str(row.library_item_id),
            "quote": _normalize_quote_for_response(
                quote=row.quote,
                visibility=row.visibility,
                max_chars=max_public_chars,
            ),
            "visibility": row.visibility,
            "location": row.location,
            "location_type": row.location_type,
            "location_sort": (
                float(row.location_sort) if row.location_sort is not None else None
            ),
            "created_at": row.created_at.isoformat(),
            "updated_at": row.updated_at.isoformat(),
        }
        for row in rows
    ]


def create_highlight(
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    quote: str,
    visibility: str,
    location: dict[str, object] | None,
    location_type: str | None,
    location_sort: float | None,
    max_public_chars: int,
) -> Highlight:
    _ensure_library_item_owned(
        session, user_id=user_id, library_item_id=library_item_id
    )
    normalized_visibility = visibility.strip().lower()
    if normalized_visibility not in HIGHLIGHT_VISIBILITIES:
        raise ValueError("invalid visibility")
    normalized_quote = quote.strip()
    if not normalized_quote:
        raise ValueError("quote cannot be blank")
    _enforce_public_quote_limit(
        quote=normalized_quote,
        visibility=normalized_visibility,
        max_chars=max_public_chars,
    )

    model = Highlight(
        user_id=user_id,
        library_item_id=library_item_id,
        quote=normalized_quote,
        visibility=normalized_visibility,
        location=location,
        location_type=location_type,
        location_sort=location_sort,
        created_at=dt.datetime.now(tz=dt.UTC),
        updated_at=dt.datetime.now(tz=dt.UTC),
    )
    session.add(model)
    session.commit()
    return model


def update_highlight(
    session: Session,
    *,
    user_id: uuid.UUID,
    highlight_id: uuid.UUID,
    quote: str | None,
    visibility: str | None,
    location: dict[str, object] | None,
    location_type: str | None,
    location_sort: float | None,
    max_public_chars: int,
) -> Highlight:
    model = session.scalar(
        sa.select(Highlight).where(
            Highlight.id == highlight_id,
            Highlight.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("highlight not found")

    effective_visibility = model.visibility
    if visibility is not None:
        normalized_visibility = visibility.strip().lower()
        if normalized_visibility not in HIGHLIGHT_VISIBILITIES:
            raise ValueError("invalid visibility")
        effective_visibility = normalized_visibility
        model.visibility = normalized_visibility

    if quote is not None:
        normalized_quote = quote.strip()
        if not normalized_quote:
            raise ValueError("quote cannot be blank")
        model.quote = normalized_quote

    if location is not None:
        model.location = location
    if location_type is not None:
        model.location_type = location_type
    if location_sort is not None:
        model.location_sort = location_sort

    _enforce_public_quote_limit(
        quote=model.quote,
        visibility=effective_visibility,
        max_chars=max_public_chars,
    )

    model.updated_at = dt.datetime.now(tz=dt.UTC)
    session.commit()
    return model


def delete_highlight(
    session: Session, *, user_id: uuid.UUID, highlight_id: uuid.UUID
) -> None:
    model = session.scalar(
        sa.select(Highlight).where(
            Highlight.id == highlight_id,
            Highlight.user_id == user_id,
        )
    )
    if model is None:
        raise LookupError("highlight not found")
    session.delete(model)
    session.commit()
