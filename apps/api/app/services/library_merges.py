from __future__ import annotations

import uuid
from typing import Any, Literal, TypeAlias

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.content import Highlight, Note, Review
from app.db.models.users import (
    LibraryItem,
    LibraryItemMergeEvent,
    ReadingProgressLog,
    ReadingSession,
)

ScalarFieldName: TypeAlias = Literal[
    "status",
    "visibility",
    "rating",
    "preferred_edition_id",
]
FieldName: TypeAlias = Literal[
    "status",
    "visibility",
    "rating",
    "preferred_edition_id",
    "tags",
]


_DEPENDENCY_COUNT_KEYS: tuple[str, ...] = (
    "read_cycles",
    "progress_logs",
    "notes",
    "highlights",
    "reviews",
)


def _normalize_item_ids(item_ids: list[uuid.UUID]) -> list[uuid.UUID]:
    seen: set[uuid.UUID] = set()
    normalized: list[uuid.UUID] = []
    for item_id in item_ids:
        if item_id in seen:
            continue
        seen.add(item_id)
        normalized.append(item_id)
    if len(normalized) < 2:
        raise ValueError("at least two unique item_ids are required")
    if len(normalized) > 20:
        raise ValueError("item_ids cannot exceed 20 entries")
    return normalized


def _parse_keep_strategy(value: str, *, field_name: str) -> uuid.UUID:
    if not value.startswith("keep:"):
        raise ValueError(f"{field_name} must use keep:<item_id>")
    raw_item_id = value.removeprefix("keep:").strip()
    if not raw_item_id:
        raise ValueError(f"{field_name} keep strategy requires item_id")
    try:
        return uuid.UUID(raw_item_id)
    except ValueError as exc:
        raise ValueError(f"{field_name} keep strategy has invalid item_id") from exc


def _validate_resolution_item(
    *, field_name: str, selected_item_id: uuid.UUID, allowed_item_ids: set[uuid.UUID]
) -> None:
    if selected_item_id not in allowed_item_ids:
        raise ValueError(f"{field_name} must reference one of the selected items")


def _candidate_fields(item: LibraryItem) -> dict[str, Any]:
    return {
        "status": item.status,
        "visibility": item.visibility,
        "rating": item.rating,
        "preferred_edition_id": (
            str(item.preferred_edition_id) if item.preferred_edition_id else None
        ),
        "tags": item.tags or [],
    }


def _ensure_owned_items(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    for_update: bool,
) -> list[LibraryItem]:
    stmt = sa.select(LibraryItem).where(
        LibraryItem.user_id == user_id,
        LibraryItem.id.in_(item_ids),
    )
    if for_update:
        stmt = stmt.with_for_update()
    rows = session.execute(stmt).scalars().all()
    by_id = {row.id: row for row in rows}
    missing = [item_id for item_id in item_ids if item_id not in by_id]
    if missing:
        raise LookupError("one or more library items were not found")
    return [by_id[item_id] for item_id in item_ids]


def _count_by_library_item(
    session: Session,
    *,
    model: type[Any],
    user_id: uuid.UUID,
    item_ids: list[uuid.UUID],
) -> dict[uuid.UUID, int]:
    rows = session.execute(
        sa.select(model.library_item_id, sa.func.count())
        .where(model.user_id == user_id, model.library_item_id.in_(item_ids))
        .group_by(model.library_item_id)
    ).all()
    return {library_item_id: int(count) for library_item_id, count in rows}


def _build_dependency_counts(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_ids: list[uuid.UUID],
) -> dict[uuid.UUID, dict[str, int]]:
    per_item: dict[uuid.UUID, dict[str, int]] = {
        item_id: {key: 0 for key in _DEPENDENCY_COUNT_KEYS} for item_id in item_ids
    }

    cycle_counts = _count_by_library_item(
        session,
        model=ReadingSession,
        user_id=user_id,
        item_ids=item_ids,
    )
    log_counts = _count_by_library_item(
        session,
        model=ReadingProgressLog,
        user_id=user_id,
        item_ids=item_ids,
    )
    note_counts = _count_by_library_item(
        session,
        model=Note,
        user_id=user_id,
        item_ids=item_ids,
    )
    highlight_counts = _count_by_library_item(
        session,
        model=Highlight,
        user_id=user_id,
        item_ids=item_ids,
    )
    review_counts = _count_by_library_item(
        session,
        model=Review,
        user_id=user_id,
        item_ids=item_ids,
    )

    for item_id, value in cycle_counts.items():
        per_item[item_id]["read_cycles"] = value
    for item_id, value in log_counts.items():
        per_item[item_id]["progress_logs"] = value
    for item_id, value in note_counts.items():
        per_item[item_id]["notes"] = value
    for item_id, value in highlight_counts.items():
        per_item[item_id]["highlights"] = value
    for item_id, value in review_counts.items():
        per_item[item_id]["reviews"] = value

    return per_item


def _empty_totals() -> dict[str, int]:
    return {key: 0 for key in _DEPENDENCY_COUNT_KEYS}


def _parse_field_resolution(
    *,
    item_ids: list[uuid.UUID],
    target_item_id: uuid.UUID,
    field_resolution: dict[str, str],
) -> dict[str, str]:
    selected_ids = set(item_ids)
    parsed: dict[str, str] = {}

    for field_name in ("status", "visibility", "rating", "preferred_edition_id"):
        raw = field_resolution.get(field_name, f"keep:{target_item_id}")
        keep_item_id = _parse_keep_strategy(raw, field_name=field_name)
        _validate_resolution_item(
            field_name=field_name,
            selected_item_id=keep_item_id,
            allowed_item_ids=selected_ids,
        )
        parsed[field_name] = f"keep:{keep_item_id}"

    tags_raw = field_resolution.get("tags", "combine")
    if tags_raw == "combine":
        parsed["tags"] = "combine"
    else:
        keep_item_id = _parse_keep_strategy(tags_raw, field_name="tags")
        _validate_resolution_item(
            field_name="tags",
            selected_item_id=keep_item_id,
            allowed_item_ids=selected_ids,
        )
        parsed["tags"] = f"keep:{keep_item_id}"

    return parsed


def preview_library_merge(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    target_item_id: uuid.UUID,
    field_resolution: dict[str, str],
) -> dict[str, Any]:
    normalized_item_ids = _normalize_item_ids(item_ids)
    if target_item_id not in normalized_item_ids:
        raise ValueError("target_item_id must be one of item_ids")

    items = _ensure_owned_items(
        session,
        user_id=user_id,
        item_ids=normalized_item_ids,
        for_update=False,
    )
    by_id = {item.id: item for item in items}

    resolved = _parse_field_resolution(
        item_ids=normalized_item_ids,
        target_item_id=target_item_id,
        field_resolution=field_resolution,
    )

    candidates: dict[str, dict[str, Any]] = {
        "status": {},
        "visibility": {},
        "rating": {},
        "preferred_edition_id": {},
        "tags": {},
    }
    for item_id in normalized_item_ids:
        item = by_id[item_id]
        values = _candidate_fields(item)
        for field_name, value in values.items():
            candidates[field_name][str(item_id)] = value

    dependency_counts_by_item = _build_dependency_counts(
        session,
        user_id=user_id,
        item_ids=normalized_item_ids,
    )
    dependency_by_item_payload = {
        str(item_id): counts for item_id, counts in dependency_counts_by_item.items()
    }

    dependency_totals = _empty_totals()
    source_item_ids = [
        item_id for item_id in normalized_item_ids if item_id != target_item_id
    ]
    for item_id in source_item_ids:
        for key in _DEPENDENCY_COUNT_KEYS:
            dependency_totals[key] += dependency_counts_by_item[item_id][key]

    return {
        "selection": {
            "target_item_id": str(target_item_id),
            "source_item_ids": [str(item_id) for item_id in source_item_ids],
            "selected_item_ids": [str(item_id) for item_id in normalized_item_ids],
        },
        "fields": {
            "candidates": candidates,
            "resolution": resolved,
            "defaults": {
                "status": f"keep:{target_item_id}",
                "visibility": f"keep:{target_item_id}",
                "rating": f"keep:{target_item_id}",
                "preferred_edition_id": f"keep:{target_item_id}",
                "tags": "combine",
            },
        },
        "dependencies": {
            "by_item": dependency_by_item_payload,
            "totals_for_sources": dependency_totals,
        },
        "warnings": [],
    }


def _combine_tags(items: list[LibraryItem]) -> list[str]:
    combined: list[str] = []
    seen: set[str] = set()
    for item in items:
        for tag in item.tags or []:
            normalized = tag.strip()
            if not normalized:
                continue
            key = normalized.lower()
            if key in seen:
                continue
            seen.add(key)
            combined.append(normalized)
    return combined


def _resolve_scalar_value(
    *,
    field_name: ScalarFieldName,
    resolution: dict[str, str],
    by_item_id: dict[uuid.UUID, LibraryItem],
) -> Any:
    keep_item_id = _parse_keep_strategy(
        resolution[field_name],
        field_name=field_name,
    )
    item = by_item_id.get(keep_item_id)
    if item is None:
        raise ValueError(f"{field_name} strategy references an unselected item")
    return getattr(item, field_name)


def apply_library_merge(
    session: Session,
    *,
    user_id: uuid.UUID,
    item_ids: list[uuid.UUID],
    target_item_id: uuid.UUID,
    field_resolution: dict[str, str],
) -> dict[str, Any]:
    normalized_item_ids = _normalize_item_ids(item_ids)
    if target_item_id not in normalized_item_ids:
        raise ValueError("target_item_id must be one of item_ids")

    resolved = _parse_field_resolution(
        item_ids=normalized_item_ids,
        target_item_id=target_item_id,
        field_resolution=field_resolution,
    )

    items = _ensure_owned_items(
        session,
        user_id=user_id,
        item_ids=normalized_item_ids,
        for_update=True,
    )
    by_item_id = {item.id: item for item in items}
    target_item = by_item_id[target_item_id]
    source_item_ids = [
        item_id for item_id in normalized_item_ids if item_id != target_item_id
    ]

    source_items = [by_item_id[item_id] for item_id in source_item_ids]
    cycle_ids_to_move = list(
        session.execute(
            sa.select(ReadingSession.id).where(
                ReadingSession.user_id == user_id,
                ReadingSession.library_item_id.in_(source_item_ids),
            )
        ).scalars()
    )

    moved_counts = {
        "read_cycles": int(
            session.scalar(
                sa.select(sa.func.count())
                .select_from(ReadingSession)
                .where(
                    ReadingSession.user_id == user_id,
                    ReadingSession.library_item_id.in_(source_item_ids),
                )
            )
            or 0
        ),
        "progress_logs": int(
            session.scalar(
                sa.select(sa.func.count())
                .select_from(ReadingProgressLog)
                .where(
                    ReadingProgressLog.user_id == user_id,
                    sa.or_(
                        ReadingProgressLog.library_item_id.in_(source_item_ids),
                        (
                            ReadingProgressLog.reading_session_id.in_(cycle_ids_to_move)
                            if cycle_ids_to_move
                            else sa.false()
                        ),
                    ),
                )
            )
            or 0
        ),
        "notes": int(
            session.scalar(
                sa.select(sa.func.count())
                .select_from(Note)
                .where(
                    Note.user_id == user_id, Note.library_item_id.in_(source_item_ids)
                )
            )
            or 0
        ),
        "highlights": int(
            session.scalar(
                sa.select(sa.func.count())
                .select_from(Highlight)
                .where(
                    Highlight.user_id == user_id,
                    Highlight.library_item_id.in_(source_item_ids),
                )
            )
            or 0
        ),
        "reviews": int(
            session.scalar(
                sa.select(sa.func.count())
                .select_from(Review)
                .where(
                    Review.user_id == user_id,
                    Review.library_item_id.in_(source_item_ids),
                )
            )
            or 0
        ),
    }

    before_fields = _candidate_fields(target_item)

    target_item.status = _resolve_scalar_value(
        field_name="status",
        resolution=resolved,
        by_item_id=by_item_id,
    )
    target_item.visibility = _resolve_scalar_value(
        field_name="visibility",
        resolution=resolved,
        by_item_id=by_item_id,
    )
    target_item.rating = _resolve_scalar_value(
        field_name="rating",
        resolution=resolved,
        by_item_id=by_item_id,
    )
    target_item.preferred_edition_id = _resolve_scalar_value(
        field_name="preferred_edition_id",
        resolution=resolved,
        by_item_id=by_item_id,
    )

    if resolved["tags"] == "combine":
        target_item.tags = _combine_tags([target_item, *source_items])
    else:
        tags_keep_item_id = _parse_keep_strategy(resolved["tags"], field_name="tags")
        tags_keep_item = by_item_id.get(tags_keep_item_id)
        if tags_keep_item is None:
            raise ValueError("tags strategy references an unselected item")
        target_item.tags = tags_keep_item.tags or []

    session.execute(
        sa.update(ReadingSession)
        .where(
            ReadingSession.user_id == user_id,
            ReadingSession.library_item_id.in_(source_item_ids),
        )
        .values(library_item_id=target_item_id)
    )

    log_relocation_predicate: Any = ReadingProgressLog.library_item_id.in_(
        source_item_ids
    )
    if cycle_ids_to_move:
        log_relocation_predicate = sa.or_(
            log_relocation_predicate,
            ReadingProgressLog.reading_session_id.in_(cycle_ids_to_move),
        )

    session.execute(
        sa.update(ReadingProgressLog)
        .where(
            ReadingProgressLog.user_id == user_id,
            log_relocation_predicate,
        )
        .values(library_item_id=target_item_id)
    )
    session.execute(
        sa.update(Note)
        .where(Note.user_id == user_id, Note.library_item_id.in_(source_item_ids))
        .values(library_item_id=target_item_id)
    )
    session.execute(
        sa.update(Highlight)
        .where(
            Highlight.user_id == user_id, Highlight.library_item_id.in_(source_item_ids)
        )
        .values(library_item_id=target_item_id)
    )
    session.execute(
        sa.update(Review)
        .where(Review.user_id == user_id, Review.library_item_id.in_(source_item_ids))
        .values(library_item_id=target_item_id)
    )

    session.execute(
        sa.delete(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.id.in_(source_item_ids),
        )
    )

    after_fields = _candidate_fields(target_item)
    merge_event = LibraryItemMergeEvent(
        user_id=user_id,
        target_library_item_id=target_item_id,
        source_library_item_ids=source_item_ids,
        field_resolution=resolved,
        result_summary={
            "selection": {
                "target_item_id": str(target_item_id),
                "source_item_ids": [str(item_id) for item_id in source_item_ids],
            },
            "moved_counts": moved_counts,
            "fields": {"before": before_fields, "after": after_fields},
        },
    )
    session.add(merge_event)
    session.commit()

    message = (
        f"Merged {len(normalized_item_ids)} books into 1. "
        f"Moved {sum(moved_counts.values())} dependent records."
    )

    return {
        "merge_event_id": str(merge_event.id),
        "target_item_id": str(target_item_id),
        "merged_source_item_ids": [str(item_id) for item_id in source_item_ids],
        "moved_counts": moved_counts,
        "fields": {
            "before": before_fields,
            "after": after_fields,
        },
        "message": message,
    }
