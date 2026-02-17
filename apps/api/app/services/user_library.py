from __future__ import annotations

import datetime as dt
import math
import re
import uuid
from typing import Any, Literal, TypeAlias

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId
from app.db.models.users import LibraryItem, ReadingSession, User

LibraryItemStatus: TypeAlias = Literal[
    "to_read",
    "reading",
    "completed",
    "abandoned",
]
LibraryItemVisibility: TypeAlias = Literal["private", "public"]
ProgressUnit: TypeAlias = Literal[
    "pages_read",
    "percent_complete",
    "minutes_listened",
]
DEFAULT_LIBRARY_STATUS: LibraryItemStatus = "to_read"
DEFAULT_LIBRARY_VISIBILITY: LibraryItemVisibility = "private"
DEFAULT_PROGRESS_UNIT: ProgressUnit = "pages_read"
HEX_COLOR_PATTERN = re.compile(r"^#[0-9A-Fa-f]{6}$")
LibraryItemSortMode: TypeAlias = Literal[
    "newest",
    "oldest",
    "title_asc",
    "title_desc",
    "author_asc",
    "author_desc",
    "status_asc",
    "status_desc",
    "rating_asc",
    "rating_desc",
]


def _default_handle(user_id: uuid.UUID) -> str:
    return f"user_{user_id.hex[:8]}"


def get_or_create_profile(session: Session, *, user_id: uuid.UUID) -> User:
    profile = session.get(User, user_id)
    if profile is not None:
        return profile

    profile = User(
        id=user_id,
        handle=_default_handle(user_id),
        display_name=None,
        avatar_url=None,
        enable_google_books=False,
        theme_primary_color=None,
        theme_accent_color=None,
        theme_font_family=None,
        theme_heading_font_family=None,
        default_progress_unit=DEFAULT_PROGRESS_UNIT,
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
    enable_google_books: bool | None,
    theme_primary_color: str | None,
    theme_accent_color: str | None,
    theme_font_family: str | None,
    theme_heading_font_family: str | None,
    default_progress_unit: ProgressUnit | None,
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

    if enable_google_books is not None:
        profile.enable_google_books = enable_google_books

    if theme_primary_color is not None:
        normalized = theme_primary_color.strip()
        if normalized and HEX_COLOR_PATTERN.fullmatch(normalized) is None:
            raise ValueError("theme_primary_color must be a #RRGGBB hex value")
        profile.theme_primary_color = normalized or None

    if theme_accent_color is not None:
        normalized = theme_accent_color.strip()
        if normalized and HEX_COLOR_PATTERN.fullmatch(normalized) is None:
            raise ValueError("theme_accent_color must be a #RRGGBB hex value")
        profile.theme_accent_color = normalized or None

    _ALLOWED_FONTS = {
        "atkinson",
        "ibm_plex_sans",
        "fraunces",
        "inter",
        "averia_libre",
        "dongle",
        "nunito_sans",
        "lora",
        "libre_baskerville",
    }

    if theme_font_family is not None:
        if theme_font_family not in _ALLOWED_FONTS:
            raise ValueError(
                "theme_font_family must be one of: "
                + ", ".join(sorted(_ALLOWED_FONTS))
            )
        profile.theme_font_family = theme_font_family

    if theme_heading_font_family is not None:
        if theme_heading_font_family not in _ALLOWED_FONTS:
            raise ValueError(
                "theme_heading_font_family must be one of: "
                + ", ".join(sorted(_ALLOWED_FONTS))
            )
        profile.theme_heading_font_family = theme_heading_font_family

    if default_progress_unit is not None:
        profile.default_progress_unit = default_progress_unit

    session.commit()
    return profile


def create_or_get_library_item(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    status: LibraryItemStatus | None,
    visibility: LibraryItemVisibility | None,
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
    page: int,
    page_size: int,
    sort: LibraryItemSortMode,
    status: str | None,
    tag: str | None,
    visibility: str | None,
) -> dict[str, Any]:
    last_read_subquery = (
        sa.select(
            ReadingSession.library_item_id.label("library_item_id"),
            sa.func.max(ReadingSession.started_at).label("last_read_at"),
        )
        .where(ReadingSession.user_id == user_id)
        .group_by(ReadingSession.library_item_id)
        .subquery()
    )
    author_sort_subquery = (
        sa.select(
            WorkAuthor.work_id.label("work_id"),
            sa.func.min(sa.func.lower(Author.name)).label("first_author_name"),
        )
        .join(Author, Author.id == WorkAuthor.author_id)
        .group_by(WorkAuthor.work_id)
        .subquery()
    )

    filtered_stmt = (
        sa.select(
            LibraryItem,
            Work.title,
            Work.description,
            sa.func.coalesce(
                LibraryItem.cover_override_url,
                Edition.cover_url,
                Work.default_cover_url,
            ).label("cover_url"),
            last_read_subquery.c.last_read_at,
        )
        .join(Work, Work.id == LibraryItem.work_id)
        .join(Edition, Edition.id == LibraryItem.preferred_edition_id, isouter=True)
        .join(
            author_sort_subquery,
            author_sort_subquery.c.work_id == Work.id,
            isouter=True,
        )
        .join(
            last_read_subquery,
            last_read_subquery.c.library_item_id == LibraryItem.id,
            isouter=True,
        )
        .where(LibraryItem.user_id == user_id)
    )
    if status is not None:
        filtered_stmt = filtered_stmt.where(LibraryItem.status == status)
    if visibility is not None:
        filtered_stmt = filtered_stmt.where(LibraryItem.visibility == visibility)
    if tag is not None:
        filtered_stmt = filtered_stmt.where(
            sa.func.lower(sa.cast(LibraryItem.tags, sa.Text)).like(
                f"%{tag.strip().lower()}%"
            )
        )

    total_count_stmt = sa.select(sa.func.count()).select_from(
        filtered_stmt.order_by(None).subquery()
    )
    total_count = int(session.scalar(total_count_stmt) or 0)

    status_order = sa.case(
        (LibraryItem.status == "abandoned", 1),
        (LibraryItem.status == "completed", 2),
        (LibraryItem.status == "reading", 3),
        (LibraryItem.status == "to_read", 4),
        else_=5,
    )

    order_by: tuple[Any, ...]
    if sort == "newest":
        order_by = (LibraryItem.created_at.desc(), LibraryItem.id.desc())
    elif sort == "oldest":
        order_by = (LibraryItem.created_at.asc(), LibraryItem.id.asc())
    elif sort == "title_asc":
        order_by = (
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "title_desc":
        order_by = (
            sa.func.lower(Work.title).desc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "author_asc":
        order_by = (
            sa.nulls_last(author_sort_subquery.c.first_author_name.asc()),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "author_desc":
        order_by = (
            sa.nulls_last(author_sort_subquery.c.first_author_name.desc()),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "status_asc":
        order_by = (
            status_order.asc(),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "status_desc":
        order_by = (
            status_order.desc(),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    elif sort == "rating_asc":
        order_by = (
            sa.nulls_last(LibraryItem.rating.asc()),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )
    else:
        order_by = (
            sa.nulls_last(LibraryItem.rating.desc()),
            sa.func.lower(Work.title).asc(),
            LibraryItem.created_at.desc(),
            LibraryItem.id.desc(),
        )

    total_pages = math.ceil(total_count / page_size) if total_count else 0
    offset = (page - 1) * page_size
    rows = session.execute(
        filtered_stmt.order_by(*order_by).offset(offset).limit(page_size)
    ).all()
    selected = rows

    # Avoid N+1: fetch author names for the works in the current page in one query.
    author_names_by_work: dict[uuid.UUID, list[str]] = {}
    work_ids = [
        item.work_id
        for item, _work_title, _work_description, _cover_url, _last_read in selected
    ]
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
    for item, work_title, work_description, cover_url, last_read_at in selected:
        items.append(
            {
                "id": str(item.id),
                "work_id": str(item.work_id),
                "work_title": work_title,
                "work_description": work_description,
                "author_names": author_names_by_work.get(item.work_id, []),
                "cover_url": cover_url,
                "status": item.status,
                "visibility": item.visibility,
                "rating": item.rating,
                "tags": item.tags or [],
                "last_read_at": (
                    last_read_at.isoformat()
                    if isinstance(last_read_at, dt.datetime)
                    else None
                ),
                "created_at": item.created_at.isoformat(),
            }
        )

    from_value = offset + 1 if selected else 0
    to_value = offset + len(selected) if selected else 0

    return {
        "items": items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_count": total_count,
            "total_pages": total_pages,
            "from": from_value,
            "to": to_value,
            "has_prev": page > 1 and total_pages > 0,
            "has_next": page < total_pages,
        },
    }


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


def search_library_items(
    session: Session,
    *,
    user_id: uuid.UUID,
    query: str,
    limit: int,
) -> list[dict[str, Any]]:
    trimmed = query.strip()
    if not trimmed:
        return []

    pattern = f"%{trimmed}%"

    stmt = (
        sa.select(
            LibraryItem.work_id,
            Work.title.label("work_title"),
            sa.func.coalesce(
                LibraryItem.cover_override_url,
                Edition.cover_url,
                Work.default_cover_url,
            ).label("cover_url"),
            ExternalId.provider_id.label("openlibrary_work_key"),
        )
        .join(Work, Work.id == LibraryItem.work_id)
        .join(Edition, Edition.id == LibraryItem.preferred_edition_id, isouter=True)
        .join(
            ExternalId,
            sa.and_(
                ExternalId.entity_type == "work",
                ExternalId.entity_id == Work.id,
                ExternalId.provider == "openlibrary",
            ),
            isouter=True,
        )
        .join(WorkAuthor, WorkAuthor.work_id == Work.id, isouter=True)
        .join(Author, Author.id == WorkAuthor.author_id, isouter=True)
        .where(LibraryItem.user_id == user_id)
        .where(
            sa.or_(
                Work.title.ilike(pattern),
                Author.name.ilike(pattern),
                sa.cast(LibraryItem.tags, sa.Text).ilike(pattern),
            )
        )
        # Postgres DISTINCT ON to avoid duplicate rows from author joins.
        .distinct(LibraryItem.work_id)
        .order_by(LibraryItem.work_id, Work.title.asc())
        .limit(limit)
    )

    rows = session.execute(stmt).all()
    work_ids = [work_id for work_id, _title, _cover_url, _key in rows]

    author_names_by_work: dict[uuid.UUID, list[str]] = {}
    if work_ids:
        author_rows = session.execute(
            sa.select(WorkAuthor.work_id, Author.name)
            .join(Author, Author.id == WorkAuthor.author_id)
            .where(WorkAuthor.work_id.in_(work_ids))
        ).all()
        for work_id, author_name in author_rows:
            author_names_by_work.setdefault(work_id, []).append(author_name)
        for work_id, names in author_names_by_work.items():
            author_names_by_work[work_id] = sorted(set(names))

    items: list[dict[str, Any]] = []
    for work_id, work_title, cover_url, openlibrary_work_key in rows:
        items.append(
            {
                "work_id": str(work_id),
                "work_title": work_title,
                "author_names": author_names_by_work.get(work_id, []),
                "cover_url": cover_url,
                "openlibrary_work_key": openlibrary_work_key,
            }
        )
    return items


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
