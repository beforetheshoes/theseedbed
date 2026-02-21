from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.enrichment import (
    EnrichmentNoMatchCache,
    EnrichmentProviderDailyUsage,
    LibraryItemEnrichmentAuditLog,
    LibraryItemEnrichmentTask,
)
from app.db.models.users import LibraryItem
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient
from app.services.user_library import get_or_create_profile
from app.services.work_metadata_enrichment import (
    FIELD_DEFINITIONS,
    apply_enrichment_selections,
    get_enrichment_candidates,
)

ACTIVE_TASK_STATUSES = {"pending", "in_progress", "needs_review"}
DEFAULT_MAX_ATTEMPTS = 3


def _now() -> dt.datetime:  # pragma: no cover
    return dt.datetime.now(tz=dt.UTC)


def _value_present(value: Any) -> bool:  # pragma: no cover
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _compute_missing_fields(  # pragma: no cover
    *,
    work: Work,
    preferred_edition: Edition | None,
) -> list[str]:
    values = {
        "work.cover_url": work.default_cover_url,
        "work.description": work.description,
        "work.first_publish_year": work.first_publish_year,
        "edition.publisher": preferred_edition.publisher if preferred_edition else None,
        "edition.publish_date": (
            preferred_edition.publish_date if preferred_edition else None
        ),
        "edition.isbn10": preferred_edition.isbn10 if preferred_edition else None,
        "edition.isbn13": preferred_edition.isbn13 if preferred_edition else None,
        "edition.language": preferred_edition.language if preferred_edition else None,
        "edition.format": preferred_edition.format if preferred_edition else None,
    }
    return [key for key, value in values.items() if not _value_present(value)]


def _idempotency_key(  # pragma: no cover
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    missing_fields: list[str],
) -> str:
    fields = ",".join(sorted(set(missing_fields)))
    return f"{user_id}:{library_item_id}:{fields}"


def _serialize_task(
    task: LibraryItemEnrichmentTask,
) -> dict[str, Any]:  # pragma: no cover
    work_title = None
    if isinstance(task.match_details, dict):
        raw_title = task.match_details.get("work_title")
        if isinstance(raw_title, str):
            work_title = raw_title

    suggested_values: dict[str, Any] = {}
    if isinstance(task.match_details, dict):
        raw_suggested = task.match_details.get("suggested_values")
        if isinstance(raw_suggested, dict):
            suggested_values = {str(k): v for k, v in raw_suggested.items()}

    return {
        "id": str(task.id),
        "library_item_id": str(task.library_item_id),
        "work_id": str(task.work_id),
        "work_title": work_title,
        "edition_id": str(task.edition_id) if task.edition_id else None,
        "trigger_source": task.trigger_source,
        "status": task.status,
        "confidence": task.confidence,
        "priority": task.priority,
        "missing_fields": task.missing_fields,
        "providers_attempted": task.providers_attempted,
        "fields_applied": task.fields_applied,
        "attempt_count": task.attempt_count,
        "max_attempts": task.max_attempts,
        "next_attempt_after": task.next_attempt_after.isoformat(),
        "last_error": task.last_error,
        "created_at": task.created_at.isoformat(),
        "updated_at": task.updated_at.isoformat(),
        "started_at": task.started_at.isoformat() if task.started_at else None,
        "finished_at": task.finished_at.isoformat() if task.finished_at else None,
        "suggested_values": suggested_values,
        # Display fields populated by list_enrichment_tasks for UI rendering.
        "cover_url": None,
        "authors": [],
        "first_publish_year": None,
        "publisher": None,
        "publish_date": None,
        "language": None,
        "format": None,
        "isbn10": None,
        "isbn13": None,
    }


def _normalize_preview_value(  # pragma: no cover
    field_key: str,
    value: Any,
) -> Any | None:
    if value is None:
        return None
    if field_key == "edition.publish_date" and isinstance(value, dt.date):
        return value.isoformat()
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    if isinstance(value, (int, float, bool)):
        return value
    return None


def _build_suggested_preview(  # pragma: no cover
    fields: list[dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, str]]:
    suggested_values: dict[str, Any] = {}
    suggested_providers: dict[str, str] = {}
    for field in fields:
        field_key = str(field.get("field_key"))
        if field_key not in FIELD_DEFINITIONS:
            continue
        candidates = field.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            continue
        selected = _first_candidate(candidates)
        if selected is None:
            continue
        normalized = _normalize_preview_value(field_key, selected.get("value"))
        if not _value_present(normalized):
            continue
        suggested_values[field_key] = normalized
        provider = selected.get("provider")
        if isinstance(provider, str) and provider.strip():
            suggested_providers[field_key] = provider.strip()
    return suggested_values, suggested_providers


def enqueue_task_for_library_item(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    trigger_source: str,
    priority: int,
    import_source: str | None = None,
    import_job_id: uuid.UUID | None = None,
    lazy_cooldown_hours: int = 24,
) -> LibraryItemEnrichmentTask | None:
    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.id == library_item_id,
            LibraryItem.user_id == user_id,
        )
    )
    if item is None:
        return None

    work = session.get(Work, item.work_id)
    if work is None:
        return None

    edition = None
    if item.preferred_edition_id is not None:
        edition = session.get(Edition, item.preferred_edition_id)

    missing_fields = _compute_missing_fields(work=work, preferred_edition=edition)
    if not missing_fields:
        return None

    existing = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.user_id == user_id,
            LibraryItemEnrichmentTask.library_item_id == item.id,
            LibraryItemEnrichmentTask.status.in_(sorted(ACTIVE_TASK_STATUSES)),
        )
    )
    if existing is not None:
        return existing

    # Cooldown for lazy trigger so list loads do not re-enqueue repeatedly.
    if trigger_source == "lazy":
        cooldown_cutoff = _now() - dt.timedelta(hours=max(lazy_cooldown_hours, 1))
        recent = session.scalar(
            sa.select(LibraryItemEnrichmentTask)
            .where(
                LibraryItemEnrichmentTask.user_id == user_id,
                LibraryItemEnrichmentTask.library_item_id == item.id,
                LibraryItemEnrichmentTask.updated_at >= cooldown_cutoff,
            )
            .order_by(LibraryItemEnrichmentTask.updated_at.desc())
            .limit(1)
        )
        if recent is not None:
            return None

    idempotency_key = _idempotency_key(
        user_id=user_id,
        library_item_id=item.id,
        missing_fields=missing_fields,
    )
    duplicate = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.idempotency_key == idempotency_key,
            LibraryItemEnrichmentTask.status.in_(sorted(ACTIVE_TASK_STATUSES)),
        )
    )
    if duplicate is not None:
        return duplicate

    task = LibraryItemEnrichmentTask(
        user_id=user_id,
        library_item_id=item.id,
        work_id=item.work_id,
        edition_id=item.preferred_edition_id,
        trigger_source=trigger_source,
        import_source=import_source,
        import_job_id=import_job_id,
        status="pending",
        confidence="none",
        priority=priority,
        missing_fields=missing_fields,
        providers_attempted=[],
        fields_applied=[],
        attempt_count=0,
        max_attempts=DEFAULT_MAX_ATTEMPTS,
        next_attempt_after=_now(),
        idempotency_key=idempotency_key,
        updated_at=_now(),
        match_details={"work_title": work.title},
    )
    session.add(task)
    session.commit()
    return task


def enqueue_tasks_for_user_items(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_ids: list[uuid.UUID],
    trigger_source: str,
    priority: int,
    lazy_cooldown_hours: int = 24,
) -> int:
    created = 0
    for item_id in library_item_ids:
        task = enqueue_task_for_library_item(
            session,
            user_id=user_id,
            library_item_id=item_id,
            trigger_source=trigger_source,
            priority=priority,
            lazy_cooldown_hours=lazy_cooldown_hours,
        )
        if task is not None:
            created += 1
    return created


def enqueue_import_task(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    library_item_id: uuid.UUID,
    source: str,
    job_id: uuid.UUID,
) -> None:
    enqueue_task_for_library_item(
        session,
        user_id=user_id,
        library_item_id=library_item_id,
        trigger_source="post_import",
        priority=100,
        import_source=source,
        import_job_id=job_id,
    )


def get_enrichment_summary(
    session: Session, *, user_id: uuid.UUID
) -> dict[str, int]:  # pragma: no cover
    rows = session.execute(
        sa.select(LibraryItemEnrichmentTask.status, sa.func.count())
        .where(LibraryItemEnrichmentTask.user_id == user_id)
        .group_by(LibraryItemEnrichmentTask.status)
    ).all()
    summary = {
        "pending": 0,
        "in_progress": 0,
        "complete": 0,
        "needs_review": 0,
        "failed": 0,
        "skipped": 0,
    }
    for status, count in rows:
        summary[str(status)] = int(count)
    return summary


def list_enrichment_tasks(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    status: str | None,
    limit: int,
    cursor: dt.datetime | None,
) -> tuple[list[dict[str, Any]], str | None]:
    stmt = (
        sa.select(LibraryItemEnrichmentTask, Work.title)
        .join(Work, Work.id == LibraryItemEnrichmentTask.work_id)
        .where(LibraryItemEnrichmentTask.user_id == user_id)
    )
    if status:
        stmt = stmt.where(LibraryItemEnrichmentTask.status == status)
    if cursor is not None:
        stmt = stmt.where(LibraryItemEnrichmentTask.created_at < cursor)
    stmt = stmt.order_by(
        LibraryItemEnrichmentTask.created_at.desc(),
        LibraryItemEnrichmentTask.id.desc(),
    )
    rows = list(session.execute(stmt.limit(limit + 1)).all())
    has_more = len(rows) > limit
    rows = rows[:limit]
    items: list[dict[str, Any]] = []
    library_item_ids: list[uuid.UUID] = []
    work_ids: list[uuid.UUID] = []
    for task, work_title in rows:
        payload = _serialize_task(task)
        payload["work_title"] = work_title
        items.append(payload)
        library_item_ids.append(task.library_item_id)
        work_ids.append(task.work_id)

    author_map: dict[uuid.UUID, list[str]] = {}
    if work_ids:
        author_rows = session.execute(
            sa.select(
                WorkAuthor.work_id,
                sa.func.array_agg(sa.distinct(Author.name)).label("authors"),
            )
            .join(Author, Author.id == WorkAuthor.author_id)
            .where(WorkAuthor.work_id.in_(work_ids))
            .group_by(WorkAuthor.work_id)
        ).all()
        for work_id, authors in author_rows:
            if isinstance(authors, list):
                author_map[work_id] = [
                    str(name).strip()
                    for name in authors
                    if isinstance(name, str) and name.strip()
                ]

    details_map: dict[uuid.UUID, dict[str, Any]] = {}
    if library_item_ids:
        detail_rows = session.execute(
            sa.select(
                LibraryItem.id,
                sa.func.coalesce(
                    LibraryItem.cover_override_url,
                    Edition.cover_url,
                    Work.default_cover_url,
                ).label("cover_url"),
                Work.first_publish_year,
                Edition.publisher,
                Edition.publish_date,
                Edition.language,
                Edition.format,
                Edition.isbn10,
                Edition.isbn13,
            )
            .join(Work, Work.id == LibraryItem.work_id)
            .outerjoin(Edition, Edition.id == LibraryItem.preferred_edition_id)
            .where(
                LibraryItem.user_id == user_id,
                LibraryItem.id.in_(library_item_ids),
            )
        ).all()
        for (
            library_item_id,
            cover_url,
            first_publish_year,
            publisher,
            publish_date,
            language,
            format_value,
            isbn10,
            isbn13,
        ) in detail_rows:
            details_map[library_item_id] = {
                "cover_url": cover_url,
                "first_publish_year": first_publish_year,
                "publisher": publisher,
                "publish_date": (
                    publish_date.isoformat() if publish_date is not None else None
                ),
                "language": language,
                "format": format_value,
                "isbn10": isbn10,
                "isbn13": isbn13,
            }

    for payload in items:
        work_id_raw = payload.get("work_id")
        item_id_raw = payload.get("library_item_id")
        try:
            work_id = uuid.UUID(str(work_id_raw))
        except (TypeError, ValueError):
            work_id = None
        try:
            library_item_id = uuid.UUID(str(item_id_raw))
        except (TypeError, ValueError):
            library_item_id = None
        if work_id is not None:
            payload["authors"] = author_map.get(work_id, [])
        if library_item_id is not None and library_item_id in details_map:
            payload.update(details_map[library_item_id])

    next_cursor = items[-1]["created_at"] if has_more and items else None
    return items, next_cursor


def get_import_enrichment_counts(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    source: str,
    job_id: uuid.UUID,
) -> dict[str, int]:
    rows = session.execute(
        sa.select(LibraryItemEnrichmentTask.status, sa.func.count())
        .where(
            LibraryItemEnrichmentTask.user_id == user_id,
            LibraryItemEnrichmentTask.import_source == source,
            LibraryItemEnrichmentTask.import_job_id == job_id,
        )
        .group_by(LibraryItemEnrichmentTask.status)
    ).all()
    counts = {
        "enrichment_queued": 0,
        "enrichment_completed": 0,
        "enrichment_needs_review": 0,
    }
    for status, count in rows:
        if status in {"pending", "in_progress"}:
            counts["enrichment_queued"] += int(count)
        if status == "complete":
            counts["enrichment_completed"] += int(count)
        if status == "needs_review":
            counts["enrichment_needs_review"] += int(count)
    return counts


def _candidate_confidence(
    fields: list[dict[str, Any]],
) -> tuple[str, float]:  # pragma: no cover
    has_cover_candidate = False
    has_identifier_candidate = False
    metadata_candidates = 0
    for field in fields:
        field_key = str(field.get("field_key"))
        candidates = field.get("candidates") or []
        if not isinstance(candidates, list):
            continue
        if field_key == "work.cover_url" and candidates:
            has_cover_candidate = True
        if field_key in {"edition.isbn10", "edition.isbn13"} and candidates:
            has_identifier_candidate = True
        if field_key != "work.cover_url" and candidates:
            metadata_candidates += 1
    if has_cover_candidate and has_identifier_candidate:
        return "high", 0.94
    if has_cover_candidate and metadata_candidates:
        return "medium", 0.78
    if has_cover_candidate:
        return "low", 0.62
    if metadata_candidates:
        return "low", 0.40
    return "none", 0.0


def _first_candidate(
    candidates: list[dict[str, Any]],
) -> dict[str, Any] | None:  # pragma: no cover
    providers = {"openlibrary": 0, "googlebooks": 1}
    sorted_candidates = sorted(
        candidates,
        key=lambda candidate: providers.get(str(candidate.get("provider")), 99),
    )
    return sorted_candidates[0] if sorted_candidates else None


def _build_auto_selections(  # pragma: no cover
    *,
    fields: list[dict[str, Any]],
    confidence: str,
    auto_apply_covers: bool,
    auto_apply_metadata: bool,
    include_metadata_for_approval: bool = False,
) -> list[dict[str, Any]]:
    selections: list[dict[str, Any]] = []
    for field in fields:
        field_key = str(field.get("field_key"))
        if field_key not in FIELD_DEFINITIONS:
            continue
        current = field.get("current_value")
        if _value_present(current):
            continue
        candidates = field.get("candidates")
        if not isinstance(candidates, list) or not candidates:
            continue

        is_cover = field_key == "work.cover_url"
        if is_cover and not auto_apply_covers:
            continue
        if (
            is_cover
            and not include_metadata_for_approval
            and confidence
            not in {
                "high",
                "medium",
            }
        ):
            continue
        if not is_cover and not include_metadata_for_approval:
            if confidence != "high":
                continue
            if not auto_apply_metadata:
                continue

        selected = _first_candidate(candidates)
        if selected is None:
            continue
        selections.append(
            {
                "field_key": field_key,
                "provider": selected.get("provider"),
                "provider_id": selected.get("provider_id"),
                "value": selected.get("value"),
            }
        )
    return selections


def _has_metadata_candidates_for_review(  # pragma: no cover
    fields: list[dict[str, Any]],
) -> bool:
    for field in fields:
        field_key = str(field.get("field_key"))
        if field_key not in FIELD_DEFINITIONS or field_key == "work.cover_url":
            continue
        if _value_present(field.get("current_value")):
            continue
        candidates = field.get("candidates")
        if isinstance(candidates, list) and candidates:
            return True
    return False


def _has_any_candidates_for_review(  # pragma: no cover
    fields: list[dict[str, Any]],
) -> bool:
    for field in fields:
        field_key = str(field.get("field_key"))
        if field_key not in FIELD_DEFINITIONS:
            continue
        if _value_present(field.get("current_value")):
            continue
        candidates = field.get("candidates")
        if isinstance(candidates, list) and candidates:
            return True
    return False


def _audit(  # pragma: no cover
    session: Session,
    *,
    task: LibraryItemEnrichmentTask,
    action: str,
    provider: str | None,
    fields_changed: dict[str, object] | None,
    details: dict[str, object] | None,
) -> None:
    session.add(
        LibraryItemEnrichmentAuditLog(
            task_id=task.id,
            user_id=task.user_id,
            library_item_id=task.library_item_id,
            work_id=task.work_id,
            action=action,
            provider=provider,
            confidence=task.confidence,
            fields_changed=fields_changed,
            details=details,
        )
    )


def _consume_provider_daily_budget(  # pragma: no cover
    session: Session,
    *,
    provider: str,
    user_id: uuid.UUID,
    per_user_limit: int,
    global_limit: int,
) -> bool:
    today = dt.date.today()

    global_count = int(
        session.scalar(
            sa.select(
                sa.func.coalesce(
                    sa.func.sum(EnrichmentProviderDailyUsage.request_count), 0
                )
            ).where(
                EnrichmentProviderDailyUsage.usage_date == today,
                EnrichmentProviderDailyUsage.provider == provider,
            )
        )
        or 0
    )
    if global_count >= global_limit:
        return False

    row = session.scalar(
        sa.select(EnrichmentProviderDailyUsage).where(
            EnrichmentProviderDailyUsage.usage_date == today,
            EnrichmentProviderDailyUsage.provider == provider,
            EnrichmentProviderDailyUsage.user_id == user_id,
        )
    )
    if row is None:
        row = EnrichmentProviderDailyUsage(
            usage_date=today,
            provider=provider,
            user_id=user_id,
            request_count=1,
            updated_at=_now(),
        )
        session.add(row)
        return True

    if row.request_count >= per_user_limit:
        return False

    row.request_count += 1
    row.updated_at = _now()
    return True


def _is_no_match_active(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    provider: str,
) -> bool:
    row = session.scalar(
        sa.select(EnrichmentNoMatchCache).where(
            EnrichmentNoMatchCache.user_id == user_id,
            EnrichmentNoMatchCache.work_id == work_id,
            EnrichmentNoMatchCache.provider == provider,
            EnrichmentNoMatchCache.expires_at > _now(),
        )
    )
    return row is not None


def _set_no_match(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    provider: str,
    ttl: dt.timedelta,
    reason: str,
) -> None:
    row = session.scalar(
        sa.select(EnrichmentNoMatchCache).where(
            EnrichmentNoMatchCache.user_id == user_id,
            EnrichmentNoMatchCache.work_id == work_id,
            EnrichmentNoMatchCache.provider == provider,
        )
    )
    expires_at = _now() + ttl
    if row is None:
        session.add(
            EnrichmentNoMatchCache(
                user_id=user_id,
                work_id=work_id,
                provider=provider,
                reason=reason,
                expires_at=expires_at,
                updated_at=_now(),
            )
        )
        return
    row.reason = reason
    row.expires_at = expires_at
    row.updated_at = _now()


async def process_due_tasks(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    limit: int,
    settings: Settings,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
    allow_when_disabled: bool = False,
    bypass_daily_budget: bool = False,
) -> dict[str, int]:
    empty_result: dict[str, int] = {
        "processed": 0,
        "covers_applied": 0,
        "metadata_applied": 0,
        "needs_review": 0,
        "skipped": 0,
        "failed": 0,
    }
    if not settings.enrichment_processing_enabled and not allow_when_disabled:
        return empty_result

    now = _now()
    stale_cutoff = now - dt.timedelta(minutes=10)
    stale_rows = (
        session.execute(
            sa.select(LibraryItemEnrichmentTask)
            .where(
                LibraryItemEnrichmentTask.user_id == user_id,
                LibraryItemEnrichmentTask.status == "in_progress",
                LibraryItemEnrichmentTask.updated_at < stale_cutoff,
            )
            .limit(limit)
        )
        .scalars()
        .all()
    )
    for stale in stale_rows:
        stale.status = "pending"
        stale.updated_at = now
        stale.last_error = "stale task reclaimed"

    profile = get_or_create_profile(session, user_id=user_id)
    raw_preferred_language = getattr(profile, "default_source_language", None)
    preferred_language = (
        raw_preferred_language.strip().lower()
        if isinstance(raw_preferred_language, str) and raw_preferred_language.strip()
        else None
    )
    google_enabled = (
        settings.book_provider_google_enabled
        and bool(settings.google_books_api_key)
        and bool(profile.enable_google_books)
    )

    tasks = (
        session.execute(
            sa.select(LibraryItemEnrichmentTask)
            .where(
                LibraryItemEnrichmentTask.user_id == user_id,
                LibraryItemEnrichmentTask.status.in_(["pending", "failed"]),
                LibraryItemEnrichmentTask.next_attempt_after <= now,
            )
            .order_by(
                LibraryItemEnrichmentTask.priority.asc(),
                LibraryItemEnrichmentTask.created_at.asc(),
            )
            .limit(limit)
        )
        .scalars()
        .all()
    )

    result = dict(empty_result)
    for task in tasks:
        task.status = "in_progress"
        task.attempt_count += 1
        task.started_at = _now()
        task.updated_at = task.started_at
        session.commit()

        try:
            edition = session.get(Edition, task.edition_id) if task.edition_id else None
            has_isbn = bool(
                edition is not None
                and (
                    (edition.isbn10 and edition.isbn10.strip())
                    or (edition.isbn13 and edition.isbn13.strip())
                )
            )
            no_match_ttl = dt.timedelta(days=7 if has_isbn else 1)

            ol_no_match = _is_no_match_active(
                session,
                user_id=task.user_id,
                work_id=task.work_id,
                provider="openlibrary",
            )
            google_no_match = not google_enabled or _is_no_match_active(
                session,
                user_id=task.user_id,
                work_id=task.work_id,
                provider="googlebooks",
            )

            # Only skip the entire task if ALL providers have active
            # no-match caches.  Previously this skipped when just OL had
            # a no-match, which prevented Google Books from being tried.
            if ol_no_match and google_no_match:
                task.status = "skipped"
                task.last_error = "all providers no-match TTL active"
                task.next_attempt_after = _now() + dt.timedelta(hours=24)
                task.finished_at = _now()
                task.updated_at = task.finished_at
                _audit(
                    session,
                    task=task,
                    action="skipped",
                    provider=None,
                    fields_changed=None,
                    details={"reason": "no_match_ttl"},
                )
                session.commit()
                result["processed"] += 1
                result["skipped"] += 1
                continue

            # Consume OL budget only if OL is not cached as no-match.
            skip_ol = ol_no_match
            if not skip_ol:
                if (not bypass_daily_budget) and not _consume_provider_daily_budget(
                    session,
                    provider="openlibrary",
                    user_id=task.user_id,
                    per_user_limit=settings.enrichment_per_user_daily_budget,
                    global_limit=settings.enrichment_global_daily_budget,
                ):
                    # If OL budget is exhausted but Google is available,
                    # continue with Google only.  If Google is also
                    # unavailable, defer the task.
                    if google_no_match:
                        task.status = "pending"
                        task.last_error = "openlibrary daily budget exhausted"
                        task.next_attempt_after = _now() + dt.timedelta(hours=12)
                        task.updated_at = _now()
                        session.commit()
                        continue
                    skip_ol = True

            task_google_enabled = google_enabled
            if task_google_enabled and not google_no_match:
                if (not bypass_daily_budget) and not _consume_provider_daily_budget(
                    session,
                    provider="googlebooks",
                    user_id=task.user_id,
                    per_user_limit=settings.enrichment_per_user_daily_budget,
                    global_limit=settings.enrichment_global_daily_budget,
                ):
                    task_google_enabled = False

            candidates = await get_enrichment_candidates(
                session,
                user_id=task.user_id,
                work_id=task.work_id,
                open_library=open_library,
                google_books=google_books,
                google_enabled=task_google_enabled,
                skip_openlibrary=skip_ol,
                preferred_language=preferred_language,
            )
            fields = candidates.get("fields")
            if not isinstance(fields, list):
                fields = []
            confidence, score = _candidate_confidence(fields)
            suggested_values, suggested_providers = _build_suggested_preview(fields)
            task.confidence = confidence
            existing_details: dict[str, Any] = (
                task.match_details if isinstance(task.match_details, dict) else {}
            )
            task.match_details = {
                **existing_details,
                "confidence_score": score,
                "providers": candidates.get("providers"),
                "suggested_values": suggested_values,
                "suggested_providers": suggested_providers,
            }
            if "work_title" not in task.match_details:
                task.match_details["work_title"] = None
            provider_attempts = candidates.get("providers") or {}
            attempted = (
                provider_attempts.get("attempted")
                if isinstance(provider_attempts, dict)
                else []
            )
            task.providers_attempted = (
                [str(x) for x in attempted] if isinstance(attempted, list) else []
            )

            selections = _build_auto_selections(
                fields=fields,
                confidence=confidence,
                auto_apply_covers=settings.enrichment_auto_apply_covers,
                auto_apply_metadata=settings.enrichment_auto_apply_metadata,
            )

            if selections:
                apply_result = await apply_enrichment_selections(
                    session,
                    user_id=task.user_id,
                    work_id=task.work_id,
                    selections=selections,
                    edition_id=task.edition_id,
                    open_library=open_library,
                    google_books=google_books,
                    google_enabled=google_enabled,
                )
                updated = apply_result.get("updated")
                task.fields_applied = (
                    [str(v) for v in updated] if isinstance(updated, list) else []
                )
                needs_review_after_apply = (
                    confidence == "medium"
                    and _has_metadata_candidates_for_review(fields)
                )
                task.status = "needs_review" if needs_review_after_apply else "complete"
                task.finished_at = _now()
                task.updated_at = task.finished_at
                _audit(
                    session,
                    task=task,
                    action="auto_applied",
                    provider=selections[0].get("provider"),
                    fields_changed={"updated": task.fields_applied},
                    details={"confidence": confidence},
                )
                if needs_review_after_apply:
                    _audit(
                        session,
                        task=task,
                        action="queued_review",
                        provider=None,
                        fields_changed=None,
                        details={"confidence": confidence},
                    )
                    result["needs_review"] += 1
                else:
                    applied_fields = task.fields_applied or []
                    if any(f == "work.cover_url" for f in applied_fields):
                        result["covers_applied"] += 1
                    non_cover = [f for f in applied_fields if f != "work.cover_url"]
                    if non_cover:
                        result["metadata_applied"] += 1
            else:
                has_review_candidates = _has_any_candidates_for_review(fields)
                if confidence in {"medium", "low"} or (
                    confidence == "high" and has_review_candidates
                ):
                    task.status = "needs_review"
                    if confidence == "high" and has_review_candidates:
                        task.last_error = "match found but no fields were auto-applied; review required"
                    _audit(
                        session,
                        task=task,
                        action="queued_review",
                        provider=None,
                        fields_changed=None,
                        details={"confidence": confidence},
                    )
                    result["needs_review"] += 1
                else:
                    task.status = "skipped"
                    task.next_attempt_after = _now() + dt.timedelta(hours=24)
                    # Build a human-readable error from provider failures
                    provider_failures = candidates.get("providers", {})
                    failed_providers = (
                        provider_failures.get("failed")
                        if isinstance(provider_failures, dict)
                        else []
                    ) or []
                    if failed_providers:
                        msgs = []
                        for pf in failed_providers:
                            p_name = str(pf.get("provider", ""))
                            p_msg = str(pf.get("message", ""))
                            if "circuit breaker" in p_msg.lower():
                                msgs.append(
                                    f"{p_name}: temporarily unavailable (rate limited)"
                                )
                            elif "unavailable" in p_msg.lower():
                                msgs.append(f"{p_name}: service unavailable")
                            elif "not_found" in str(pf.get("code", "")):
                                msgs.append(f"{p_name}: no match found")
                            else:
                                msgs.append(f"{p_name}: {p_msg}" if p_msg else p_name)
                        task.last_error = "; ".join(msgs) if msgs else None
                    else:
                        task.last_error = None
                    _audit(
                        session,
                        task=task,
                        action="skipped",
                        provider=None,
                        fields_changed=None,
                        details={"reason": "no_candidates"},
                    )
                    for provider in {"openlibrary", "googlebooks"}:
                        if provider in task.providers_attempted:
                            _set_no_match(
                                session,
                                user_id=task.user_id,
                                work_id=task.work_id,
                                provider=provider,
                                ttl=no_match_ttl,
                                reason="no_candidates",
                            )
                    result["skipped"] += 1
                task.finished_at = _now()
                task.updated_at = task.finished_at

            session.commit()
            result["processed"] += 1
        except Exception as exc:
            session.rollback()
            recovered_task = session.get(LibraryItemEnrichmentTask, task.id)
            if recovered_task is None:
                continue
            recovered_task.last_error = str(exc)
            if recovered_task.attempt_count >= recovered_task.max_attempts:
                recovered_task.status = "failed"
                recovered_task.finished_at = _now()
                result["failed"] += 1
            else:
                recovered_task.status = "pending"
                recovered_task.next_attempt_after = _now() + dt.timedelta(
                    seconds=min(300, 2 ** max(recovered_task.attempt_count, 1))
                )
            recovered_task.updated_at = _now()
            _audit(
                session,
                task=recovered_task,
                action="failed",
                provider=None,
                fields_changed=None,
                details={"error": str(exc)},
            )
            session.commit()

    return result


async def approve_needs_review_task(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    selections: list[dict[str, Any]] | None,
    settings: Settings,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
) -> dict[str, Any]:
    task = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.id == task_id,
            LibraryItemEnrichmentTask.user_id == user_id,
        )
    )
    if task is None:
        raise LookupError("enrichment task not found")

    profile = get_or_create_profile(session, user_id=user_id)
    raw_preferred_language = getattr(profile, "default_source_language", None)
    preferred_language = (
        raw_preferred_language.strip().lower()
        if isinstance(raw_preferred_language, str) and raw_preferred_language.strip()
        else None
    )
    google_enabled = (
        settings.book_provider_google_enabled
        and bool(settings.google_books_api_key)
        and bool(profile.enable_google_books)
    )

    chosen = selections
    # Only fetch fresh candidates when selections are omitted.
    # An explicit empty list means "apply exactly what user selected" and should
    # not trigger expensive provider matching calls.
    if chosen is None:
        candidates = await get_enrichment_candidates(
            session,
            user_id=user_id,
            work_id=task.work_id,
            open_library=open_library,
            google_books=google_books,
            google_enabled=google_enabled,
            preferred_language=preferred_language,
        )
        fields = candidates.get("fields")
        chosen = _build_auto_selections(
            fields=fields if isinstance(fields, list) else [],
            confidence="high",
            auto_apply_covers=True,
            auto_apply_metadata=True,
            include_metadata_for_approval=True,
        )

    result = await apply_enrichment_selections(
        session,
        user_id=user_id,
        work_id=task.work_id,
        selections=chosen,
        edition_id=task.edition_id,
        open_library=open_library,
        google_books=google_books,
        google_enabled=google_enabled,
        persist_provider_sources=False,
    )
    updated = result.get("updated")
    task.fields_applied = [str(v) for v in updated] if isinstance(updated, list) else []
    task.status = "complete"
    task.finished_at = _now()
    task.updated_at = task.finished_at
    _audit(
        session,
        task=task,
        action="approved",
        provider=None,
        fields_changed={"updated": task.fields_applied},
        details={"manual": True},
    )
    session.commit()
    return _serialize_task(task)


def dismiss_task(  # pragma: no cover
    session: Session, *, user_id: uuid.UUID, task_id: uuid.UUID
) -> dict[str, Any]:
    task = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.id == task_id,
            LibraryItemEnrichmentTask.user_id == user_id,
        )
    )
    if task is None:
        raise LookupError("enrichment task not found")
    task.status = "skipped"
    task.finished_at = _now()
    task.updated_at = task.finished_at
    _audit(
        session,
        task=task,
        action="dismissed",
        provider=None,
        fields_changed=None,
        details=None,
    )
    session.commit()
    return _serialize_task(task)


def retry_task(  # pragma: no cover
    session: Session, *, user_id: uuid.UUID, task_id: uuid.UUID
) -> dict[str, Any]:
    task = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.id == task_id,
            LibraryItemEnrichmentTask.user_id == user_id,
        )
    )
    if task is None:
        raise LookupError("enrichment task not found")
    task.status = "pending"
    task.attempt_count = 0
    task.next_attempt_after = _now()
    task.last_error = None
    task.finished_at = None
    task.started_at = None
    task.updated_at = _now()
    session.commit()
    return _serialize_task(task)


async def retry_and_process_now(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    task_id: uuid.UUID,
    settings: Settings,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
) -> dict[str, Any]:
    """Reset a task, clear its no-match caches, process it immediately, and
    return the updated task with outcome so the frontend can show results
    inline without a full page refresh."""
    task = session.scalar(
        sa.select(LibraryItemEnrichmentTask).where(
            LibraryItemEnrichmentTask.id == task_id,
            LibraryItemEnrichmentTask.user_id == user_id,
        )
    )
    if task is None:
        raise LookupError("enrichment task not found")

    # 1. Reset the task
    task.status = "pending"
    task.attempt_count = 0
    task.next_attempt_after = _now()
    task.last_error = None
    task.finished_at = None
    task.started_at = None
    task.fields_applied = []
    task.confidence = "none"
    task.updated_at = _now()
    # Give it highest priority so process_due_tasks picks it first
    original_priority = task.priority
    task.priority = 0

    # 2. Clear no-match caches for this work so providers are retried fresh
    session.execute(
        sa.delete(EnrichmentNoMatchCache).where(
            EnrichmentNoMatchCache.user_id == user_id,
            EnrichmentNoMatchCache.work_id == task.work_id,
        )
    )
    session.commit()

    # 3. Process immediately (limit=1 with priority=0 ensures this task)
    await process_due_tasks(
        session,
        user_id=user_id,
        limit=1,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
        allow_when_disabled=True,
        bypass_daily_budget=True,
    )

    # 4. Restore original priority and return updated task
    session.refresh(task)
    task.priority = original_priority
    task.updated_at = _now()
    session.commit()

    # Return enriched task data with work title for display
    work = session.get(Work, task.work_id)
    result = _serialize_task(task)
    if work:
        result["work_title"] = work.title
    return result


def list_recent_results(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Return recently completed/skipped/failed tasks for display."""
    cutoff = _now() - dt.timedelta(hours=24)
    stmt = (
        sa.select(LibraryItemEnrichmentTask, Work.title)
        .join(Work, Work.id == LibraryItemEnrichmentTask.work_id)
        .where(
            LibraryItemEnrichmentTask.user_id == user_id,
            LibraryItemEnrichmentTask.status.in_(["complete", "skipped", "failed"]),
            LibraryItemEnrichmentTask.finished_at >= cutoff,
        )
        .order_by(LibraryItemEnrichmentTask.finished_at.desc())
        .limit(limit)
    )
    rows = list(session.execute(stmt).all())
    items: list[dict[str, Any]] = []
    for task, work_title in rows:
        items.append(
            {
                "id": str(task.id),
                "work_id": str(task.work_id),
                "work_title": work_title,
                "status": task.status,
                "confidence": task.confidence,
                "fields_applied": task.fields_applied or [],
                "finished_at": (
                    task.finished_at.isoformat() if task.finished_at else None
                ),
            }
        )
    return items


def reset_skipped_and_failed_tasks(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
) -> int:
    """Reset all skipped/failed tasks back to pending and clear their
    no-match caches so the next batch run retries them fresh."""
    tasks = list(
        session.execute(
            sa.select(LibraryItemEnrichmentTask).where(
                LibraryItemEnrichmentTask.user_id == user_id,
                LibraryItemEnrichmentTask.status.in_(["skipped", "failed"]),
            )
        )
        .scalars()
        .all()
    )
    if not tasks:
        return 0
    now = _now()
    work_ids = set()
    for task in tasks:
        task.status = "pending"
        task.confidence = "none"
        task.next_attempt_after = now
        task.last_error = None
        task.finished_at = None
        task.fields_applied = []
        task.updated_at = now
        work_ids.add(task.work_id)
    # Clear all no-match caches for these works so providers are tried fresh
    if work_ids:
        session.execute(
            sa.delete(EnrichmentNoMatchCache).where(
                EnrichmentNoMatchCache.user_id == user_id,
                EnrichmentNoMatchCache.work_id.in_(work_ids),
            )
        )
    session.commit()
    return len(tasks)


def trigger_all_missing_for_user(  # pragma: no cover
    session: Session,
    *,
    user_id: uuid.UUID,
    priority: int = 60,
    lazy_cooldown_hours: int = 24,
) -> int:
    rows = session.execute(
        sa.select(LibraryItem.id).where(LibraryItem.user_id == user_id)
    ).all()
    return enqueue_tasks_for_user_items(
        session,
        user_id=user_id,
        library_item_ids=[row[0] for row in rows],
        trigger_source="manual_bulk",
        priority=priority,
        lazy_cooldown_hours=lazy_cooldown_hours,
    )
