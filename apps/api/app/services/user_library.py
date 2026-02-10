from __future__ import annotations

import base64
import datetime as dt
import json
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.users import LibraryItem, User

DEFAULT_LIBRARY_STATUS = "to_read"
DEFAULT_LIBRARY_VISIBILITY = "private"


def _default_handle(user_id: uuid.UUID) -> str:
    return f"user_{user_id.hex[:8]}"


def _encode_cursor(created_at: dt.datetime, item_id: uuid.UUID) -> str:
    payload = {"created_at": created_at.isoformat(), "id": str(item_id)}
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decode_cursor(cursor: str) -> tuple[dt.datetime, uuid.UUID]:
    try:
        raw = base64.urlsafe_b64decode(cursor.encode("ascii")).decode("utf-8")
        payload = json.loads(raw)
        return dt.datetime.fromisoformat(payload["created_at"]), uuid.UUID(
            payload["id"]
        )
    except (ValueError, KeyError, json.JSONDecodeError) as exc:
        raise ValueError("invalid cursor") from exc


def get_or_create_profile(session: Session, *, user_id: uuid.UUID) -> User:
    profile = session.get(User, user_id)
    if profile is not None:
        return profile

    profile = User(
        id=user_id,
        handle=_default_handle(user_id),
        display_name=None,
        avatar_url=None,
    )
    session.add(profile)
    session.commit()
    return profile


def update_profile(
    session: Session,
    *,
    user_id: uuid.UUID,
    handle: str | None,
    display_name: str | None,
    avatar_url: str | None,
) -> User:
    profile = get_or_create_profile(session, user_id=user_id)

    if handle is not None:
        normalized = handle.strip()
        if not normalized:
            raise ValueError("handle cannot be blank")
        existing = session.scalar(
            sa.select(User).where(User.handle == normalized, User.id != user_id)
        )
        if existing is not None:
            raise ValueError("handle is already taken")
        profile.handle = normalized

    if display_name is not None:
        profile.display_name = display_name.strip() or None

    if avatar_url is not None:
        profile.avatar_url = avatar_url.strip() or None

    session.commit()
    return profile


def create_or_get_library_item(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    status: str | None,
    visibility: str | None,
    rating: int | None,
    tags: list[str] | None,
    preferred_edition_id: uuid.UUID | None,
) -> tuple[LibraryItem, bool]:
    # Ensure the app-level profile row exists before writing library_items.
    # library_items.user_id references users.id (not auth.users.id directly).
    get_or_create_profile(session, user_id=user_id)

    work_exists = session.scalar(sa.select(Work.id).where(Work.id == work_id))
    if work_exists is None:
        raise LookupError("work not found")

    existing = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if existing is not None:
        return existing, False

    item = LibraryItem(
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=preferred_edition_id,
        status=status or DEFAULT_LIBRARY_STATUS,
        visibility=visibility or DEFAULT_LIBRARY_VISIBILITY,
        rating=rating,
        tags=tags,
    )
    session.add(item)
    session.commit()
    return item, True


def list_library_items(
    session: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    cursor: str | None,
    status: str | None,
    tag: str | None,
    visibility: str | None,
) -> dict[str, Any]:
    stmt = (
        sa.select(
            LibraryItem,
            Work.title,
            sa.func.coalesce(
                LibraryItem.cover_override_url,
                Edition.cover_url,
                Work.default_cover_url,
            ).label("cover_url"),
        )
        .join(Work, Work.id == LibraryItem.work_id)
        .join(Edition, Edition.id == LibraryItem.preferred_edition_id, isouter=True)
        .where(LibraryItem.user_id == user_id)
        .order_by(LibraryItem.created_at.desc(), LibraryItem.id.desc())
    )
    if status is not None:
        stmt = stmt.where(LibraryItem.status == status)
    if visibility is not None:
        stmt = stmt.where(LibraryItem.visibility == visibility)
    if tag is not None:
        stmt = stmt.where(LibraryItem.tags.contains([tag]))

    if cursor:
        cursor_created, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            sa.or_(
                LibraryItem.created_at < cursor_created,
                sa.and_(
                    LibraryItem.created_at == cursor_created,
                    LibraryItem.id < cursor_id,
                ),
            )
        )

    rows = session.execute(stmt.limit(limit + 1)).all()
    has_next = len(rows) > limit
    selected = rows[:limit]

    # Avoid N+1: fetch author names for the works in the current page in one query.
    author_names_by_work: dict[uuid.UUID, list[str]] = {}
    work_ids = [item.work_id for item, _work_title, _cover_url in selected]
    if work_ids:
        author_rows = session.execute(
            sa.select(WorkAuthor.work_id, Author.name)
            .join(Author, Author.id == WorkAuthor.author_id)
            .where(WorkAuthor.work_id.in_(work_ids))
        ).all()
        for work_id, author_name in author_rows:
            author_names_by_work.setdefault(work_id, []).append(author_name)
        for work_id, names in author_names_by_work.items():
            # Stable ordering for UI and tests.
            author_names_by_work[work_id] = sorted(set(names))

    items: list[dict[str, Any]] = []
    for item, work_title, cover_url in selected:
        items.append(
            {
                "id": str(item.id),
                "work_id": str(item.work_id),
                "work_title": work_title,
                "author_names": author_names_by_work.get(item.work_id, []),
                "cover_url": cover_url,
                "status": item.status,
                "visibility": item.visibility,
                "rating": item.rating,
                "tags": item.tags or [],
                "created_at": item.created_at.isoformat(),
            }
        )

    next_cursor = None
    if has_next and selected:
        last_item = selected[-1][0]
        next_cursor = _encode_cursor(last_item.created_at, last_item.id)

    return {"items": items, "next_cursor": next_cursor}


def get_library_item_by_work_detail(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
) -> dict[str, Any] | None:
    row = session.execute(
        sa.select(
            LibraryItem,
            sa.func.coalesce(
                LibraryItem.cover_override_url,
                Edition.cover_url,
                Work.default_cover_url,
            ).label("cover_url"),
        )
        .join(Work, Work.id == LibraryItem.work_id)
        .join(Edition, Edition.id == LibraryItem.preferred_edition_id, isouter=True)
        .where(LibraryItem.user_id == user_id, LibraryItem.work_id == work_id)
        .limit(1)
    ).first()
    if row is None:
        return None
    item, cover_url = row
    return {
        "id": str(item.id),
        "work_id": str(item.work_id),
        "preferred_edition_id": (
            str(item.preferred_edition_id) if item.preferred_edition_id else None
        ),
        "cover_url": cover_url,
        "status": item.status,
        "visibility": item.visibility,
        "rating": item.rating,
        "tags": item.tags or [],
        "created_at": item.created_at.isoformat(),
    }


def get_library_item_by_work(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
) -> LibraryItem | None:
    return session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )


def update_library_item(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_id: uuid.UUID,
    updates: dict[str, Any],
) -> LibraryItem:
    if not updates:
        raise ValueError("at least one field must be provided")

    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.id == item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if item is None:
        raise LookupError("library item not found")

    for field in ("preferred_edition_id", "status", "visibility", "rating", "tags"):
        if field in updates:
            setattr(item, field, updates[field])

    session.commit()
    return item


def delete_library_item(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_id: uuid.UUID,
) -> None:
    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.id == item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if item is None:
        raise LookupError("library item not found")
    session.delete(item)
    session.commit()
