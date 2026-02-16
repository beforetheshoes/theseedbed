from __future__ import annotations

import asyncio
import datetime as dt
from collections import Counter
from dataclasses import dataclass
from typing import Any, cast
from uuid import UUID

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId
from app.db.models.imports import StorygraphImportJob, StorygraphImportJobRow
from app.db.session import create_db_session
from app.services.catalog import import_openlibrary_bundle
from app.services.open_library import OpenLibraryClient
from app.services.reading_sessions import get_or_create_import_cycle
from app.services.reviews import upsert_review_for_work
from app.services.storygraph_parser import (
    StorygraphCsvError,
    StorygraphParseIssue,
    StorygraphRow,
    is_valid_isbn,
    parse_storygraph_csv,
)
from app.services.user_library import (
    LibraryItemStatus,
    create_or_get_library_item,
    update_library_item,
)


@dataclass
class JobPreviewRow:
    row_number: int
    title: str | None
    uid: str | None
    result: str
    message: str
    work_id: str | None
    library_item_id: str | None
    review_id: str | None
    session_id: str | None


def _iso(value: dt.datetime | None) -> str | None:
    return value.isoformat() if value else None


def create_storygraph_job(
    session: Session,
    *,
    user_id: UUID,
    filename: str,
) -> StorygraphImportJob:  # pragma: no cover
    job = StorygraphImportJob(
        user_id=user_id,
        filename=filename,
        status="queued",
        total_rows=0,
        processed_rows=0,
        imported_rows=0,
        failed_rows=0,
        skipped_rows=0,
    )
    session.add(job)
    session.commit()
    return job


def get_storygraph_job(  # pragma: no cover
    session: Session, *, user_id: UUID, job_id: UUID
) -> StorygraphImportJob:
    job = session.scalar(
        sa.select(StorygraphImportJob).where(
            StorygraphImportJob.id == job_id,
            StorygraphImportJob.user_id == user_id,
        )
    )
    if job is None:
        raise LookupError("import job not found")
    return job


def get_active_storygraph_job(
    session: Session,
    *,
    user_id: UUID,
) -> StorygraphImportJob | None:
    return session.scalar(
        sa.select(StorygraphImportJob)
        .where(
            StorygraphImportJob.user_id == user_id,
            StorygraphImportJob.status.in_(["queued", "running"]),
        )
        .order_by(StorygraphImportJob.created_at.desc())
        .limit(1)
    )


def list_storygraph_job_rows(
    session: Session,
    *,
    user_id: UUID,
    job_id: UUID,
    limit: int,
    cursor: int | None,
) -> tuple[list[StorygraphImportJobRow], int | None]:  # pragma: no cover
    get_storygraph_job(session, user_id=user_id, job_id=job_id)
    stmt = (
        sa.select(StorygraphImportJobRow)
        .where(
            StorygraphImportJobRow.user_id == user_id,
            StorygraphImportJobRow.job_id == job_id,
        )
        .order_by(StorygraphImportJobRow.row_number.asc())
    )
    if cursor is not None:
        stmt = stmt.where(StorygraphImportJobRow.row_number > cursor)
    rows = list(session.execute(stmt.limit(limit + 1)).scalars().all())
    has_next = len(rows) > limit
    rows = rows[:limit]
    next_cursor = rows[-1].row_number if has_next and rows else None
    return rows, next_cursor


def _job_duration_ms(job: StorygraphImportJob) -> int | None:  # pragma: no cover
    if not job.started_at or not job.finished_at:
        return None
    return int((job.finished_at - job.started_at).total_seconds() * 1000)


def serialize_job(
    session: Session,
    *,
    user_id: UUID,
    job_id: UUID,
    preview_limit: int = 20,
) -> dict[str, Any]:  # pragma: no cover
    job = get_storygraph_job(session, user_id=user_id, job_id=job_id)
    preview_rows = session.execute(
        sa.select(StorygraphImportJobRow)
        .where(
            StorygraphImportJobRow.job_id == job.id,
            StorygraphImportJobRow.user_id == user_id,
            StorygraphImportJobRow.result.in_(["failed", "skipped"]),
        )
        .order_by(StorygraphImportJobRow.row_number.asc())
        .limit(preview_limit)
    ).scalars()

    rows_preview = [
        {
            "row_number": row.row_number,
            "title": row.title,
            "uid": row.uid,
            "result": row.result,
            "message": row.message,
            "work_id": str(row.work_id) if row.work_id else None,
            "library_item_id": (
                str(row.library_item_id) if row.library_item_id else None
            ),
            "review_id": str(row.review_id) if row.review_id else None,
            "session_id": str(row.session_id) if row.session_id else None,
        }
        for row in preview_rows
    ]

    return {
        "job_id": str(job.id),
        "status": job.status,
        "filename": job.filename,
        "created_at": _iso(job.created_at),
        "started_at": _iso(job.started_at),
        "finished_at": _iso(job.finished_at),
        "duration_ms": _job_duration_ms(job),
        "total_rows": job.total_rows,
        "processed_rows": job.processed_rows,
        "imported_rows": job.imported_rows,
        "failed_rows": job.failed_rows,
        "skipped_rows": job.skipped_rows,
        "error_summary": job.error_summary,
        "rows_preview": rows_preview,
    }


def _record_row(
    session: Session,
    *,
    job: StorygraphImportJob,
    row: StorygraphRow,
    result: str,
    message: str,
    work_id: UUID | None = None,
    library_item_id: UUID | None = None,
    review_id: UUID | None = None,
    session_id: UUID | None = None,
) -> None:  # pragma: no cover
    existing = session.scalar(
        sa.select(StorygraphImportJobRow).where(
            StorygraphImportJobRow.job_id == job.id,
            StorygraphImportJobRow.identity_hash == row.identity_hash,
        )
    )
    if existing is None:
        entry = StorygraphImportJobRow(
            job_id=job.id,
            user_id=job.user_id,
            row_number=row.row_number,
            identity_hash=row.identity_hash,
            title=row.title,
            uid=row.uid,
            result=result,
            message=message,
            work_id=work_id,
            library_item_id=library_item_id,
            review_id=review_id,
            session_id=session_id,
        )
        session.add(entry)
    else:
        existing.row_number = row.row_number
        existing.result = result
        existing.message = message
        existing.work_id = work_id
        existing.library_item_id = library_item_id
        existing.review_id = review_id
        existing.session_id = session_id


def _record_issue(
    session: Session,
    *,
    job: StorygraphImportJob,
    issue: StorygraphParseIssue,
    result: str = "failed",
) -> None:
    existing = session.scalar(
        sa.select(StorygraphImportJobRow).where(
            StorygraphImportJobRow.job_id == job.id,
            StorygraphImportJobRow.identity_hash == issue.identity_hash,
        )
    )
    if existing is None:
        session.add(
            StorygraphImportJobRow(
                job_id=job.id,
                user_id=job.user_id,
                row_number=issue.row_number,
                identity_hash=issue.identity_hash,
                title=issue.title,
                uid=issue.uid,
                result=result,
                message=issue.message,
            )
        )
        return
    existing.row_number = issue.row_number
    existing.title = issue.title
    existing.uid = issue.uid
    existing.result = result
    existing.message = issue.message


def _find_work_by_isbn(
    session: Session, *, isbn: str
) -> UUID | None:  # pragma: no cover
    if len(isbn) == 10:
        return session.scalar(
            sa.select(Edition.work_id).where(Edition.isbn10 == isbn).limit(1)
        )
    if len(isbn) == 13:
        return session.scalar(
            sa.select(Edition.work_id).where(Edition.isbn13 == isbn).limit(1)
        )
    return None


def _ensure_author(session: Session, *, name: str) -> Author:  # pragma: no cover
    existing = session.scalar(sa.select(Author).where(Author.name == name))
    if existing is not None:
        return existing
    author = Author(name=name)
    session.add(author)
    session.flush()
    return author


def _manual_external_provider_id(identity_hash: str) -> str:
    return f"storygraph:{identity_hash}"


def _resolve_or_create_manual_work(
    session: Session,
    *,
    row: StorygraphRow,
) -> UUID:  # pragma: no cover
    provider_id = _manual_external_provider_id(row.identity_hash)
    existing_external = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "work",
            ExternalId.provider == "storygraph_manual",
            ExternalId.provider_id == provider_id,
        )
    )
    if existing_external is not None:
        return existing_external.entity_id

    work = Work(title=row.title)
    session.add(work)
    session.flush()
    for name in row.authors:
        author = _ensure_author(session, name=name)
        link_exists = session.scalar(
            sa.select(WorkAuthor).where(
                WorkAuthor.work_id == work.id,
                WorkAuthor.author_id == author.id,
            )
        )
        if link_exists is None:
            session.add(WorkAuthor(work_id=work.id, author_id=author.id))

    session.add(
        ExternalId(
            entity_type="work",
            entity_id=work.id,
            provider="storygraph_manual",
            provider_id=provider_id,
        )
    )

    if row.uid and is_valid_isbn(row.uid):
        edition = Edition(
            work_id=work.id,
            isbn10=row.uid if len(row.uid) == 10 else None,
            isbn13=row.uid if len(row.uid) == 13 else None,
        )
        session.add(edition)

    session.flush()
    return work.id


def _pick_session_bounds(  # pragma: no cover
    row: StorygraphRow,
) -> tuple[dt.datetime, dt.datetime | None] | None:
    start = row.dates_read_start or row.last_date_read or row.date_added
    end = row.dates_read_end or row.last_date_read or start
    if start is None:
        return None
    start_at = dt.datetime.combine(start, dt.time.min, tzinfo=dt.UTC)
    end_at = dt.datetime.combine(end, dt.time.max, tzinfo=dt.UTC) if end else None
    return start_at, end_at


def _safe_rollback(session: Session) -> None:
    try:
        session.rollback()
    except Exception:
        pass


def _mark_job_failed_fresh_session(
    *,
    user_id: UUID,
    job_id: UUID,
    message: str,
) -> None:
    terminal_session = create_db_session()
    try:
        job = get_storygraph_job(terminal_session, user_id=user_id, job_id=job_id)
        job.status = "failed"
        job.error_summary = message
        job.finished_at = dt.datetime.now(tz=dt.UTC)
        job.updated_at = job.finished_at
        terminal_session.commit()
    finally:
        terminal_session.close()


async def process_storygraph_import_job(
    *,
    user_id: UUID,
    job_id: UUID,
    csv_bytes: bytes,
    author_overrides: dict[int, str] | None = None,
    title_overrides: dict[int, str] | None = None,
    status_overrides: dict[int, str] | None = None,
    skipped_rows: set[int] | None = None,
    skip_reasons: dict[int, str] | None = None,
) -> None:  # pragma: no cover
    session = create_db_session()
    open_library = OpenLibraryClient()
    unresolved_required_messages = {
        "title is required": "missing_title",
        "authors are required": "missing_authors",
        "unsupported read status ''": "missing_read_status",
    }
    skipped_row_set = skipped_rows or set()
    skip_reason_map = skip_reasons or {}
    try:
        job = get_storygraph_job(session, user_id=user_id, job_id=job_id)
        now = dt.datetime.now(tz=dt.UTC)
        job.status = "running"
        job.started_at = now
        job.updated_at = now
        session.commit()

        parsed = parse_storygraph_csv(
            csv_bytes,
            author_overrides=author_overrides,
            title_overrides=title_overrides,
            status_overrides=status_overrides,
        )
        job.total_rows = len(parsed.rows) + len(parsed.issues)
        session.commit()

        error_counter: Counter[str] = Counter()

        for issue in parsed.issues:
            issue_code = unresolved_required_messages.get(issue.message)
            issue_result = "skipped" if issue_code is not None else "failed"
            message = issue.message
            if issue_result == "skipped":
                if issue.row_number in skipped_row_set:
                    reason = skip_reason_map.get(issue.row_number, issue_code)
                    message = f"Skipped by user ({reason})."
                else:
                    message = f"Skipped unresolved required field ({issue_code})."
            _record_issue(
                session,
                job=job,
                issue=StorygraphParseIssue(
                    row_number=issue.row_number,
                    title=issue.title,
                    uid=issue.uid,
                    identity_hash=issue.identity_hash,
                    message=message,
                ),
                result=issue_result,
            )
            error_counter[message] += 1
            if issue_result == "skipped":
                job.skipped_rows += 1
            else:
                job.failed_rows += 1
            job.processed_rows += 1
            job.updated_at = dt.datetime.now(tz=dt.UTC)
            session.commit()

        for row in parsed.rows:
            try:
                work_id = (
                    _find_work_by_isbn(session, isbn=row.uid or "") if row.uid else None
                )
                if work_id is None and row.uid and is_valid_isbn(row.uid):
                    work_key = await asyncio.wait_for(
                        open_library.find_work_key_by_isbn(isbn=row.uid),
                        timeout=15.0,
                    )
                    if work_key:
                        bundle = await asyncio.wait_for(
                            open_library.fetch_work_bundle(work_key=work_key),
                            timeout=25.0,
                        )
                        imported = import_openlibrary_bundle(session, bundle=bundle)
                        work_id = UUID(imported["work"]["id"])

                if work_id is None:
                    work_id = _resolve_or_create_manual_work(session, row=row)

                library_item, created = create_or_get_library_item(
                    session,
                    user_id=user_id,
                    work_id=work_id,
                    status=cast(LibraryItemStatus, row.status),
                    visibility=None,
                    rating=row.rating_10,
                    tags=row.tags,
                    preferred_edition_id=None,
                )
                if not created:
                    updates: dict[str, Any] = {
                        "status": row.status,
                        "rating": row.rating_10,
                        "tags": row.tags,
                    }
                    library_item = update_library_item(
                        session,
                        user_id=user_id,
                        item_id=library_item.id,
                        updates=updates,
                    )

                review_id: UUID | None = None
                if row.review:
                    review = upsert_review_for_work(
                        session,
                        user_id=user_id,
                        work_id=work_id,
                        title=None,
                        body=row.review,
                        rating=row.rating_5,
                        visibility="private",
                        edition_id=None,
                    )
                    review_id = review.id

                reading_session_id: UUID | None = None
                session_bounds = _pick_session_bounds(row)
                if session_bounds:
                    started_at, ended_at = session_bounds
                    marker = f"storygraph:{row.identity_hash}"
                    cycle = get_or_create_import_cycle(
                        session,
                        user_id=user_id,
                        library_item_id=library_item.id,
                        marker=marker,
                        started_at=started_at,
                        ended_at=ended_at,
                    )
                    reading_session_id = cycle.id

                _record_row(
                    session,
                    job=job,
                    row=row,
                    result="imported",
                    message="Imported successfully.",
                    work_id=work_id,
                    library_item_id=library_item.id,
                    review_id=review_id,
                    session_id=reading_session_id,
                )
                job.imported_rows += 1
            except Exception as exc:
                message = str(exc) or "row import failed"
                error_counter[message] += 1
                _safe_rollback(session)
                session.expunge_all()
                job = get_storygraph_job(session, user_id=user_id, job_id=job_id)
                _record_row(
                    session,
                    job=job,
                    row=row,
                    result="failed",
                    message=message,
                )
                job.failed_rows += 1
            finally:
                job.processed_rows += 1
                job.updated_at = dt.datetime.now(tz=dt.UTC)
                try:
                    session.commit()
                except Exception as exc:
                    _safe_rollback(session)
                    _mark_job_failed_fresh_session(
                        user_id=user_id,
                        job_id=job_id,
                        message=str(exc) or "import failed while saving progress",
                    )
                    return

        if job.failed_rows > 0 and error_counter:
            top_error, count = error_counter.most_common(1)[0]
            job.error_summary = f"{top_error} ({count} rows)"
        job.status = "completed"
        job.finished_at = dt.datetime.now(tz=dt.UTC)
        job.updated_at = job.finished_at
        session.commit()
    except StorygraphCsvError as exc:
        _safe_rollback(session)
        _mark_job_failed_fresh_session(
            user_id=user_id,
            job_id=job_id,
            message=str(exc),
        )
    except Exception as exc:
        _safe_rollback(session)
        _mark_job_failed_fresh_session(
            user_id=user_id,
            job_id=job_id,
            message=str(exc) or "import failed",
        )
    finally:
        session.close()


def serialize_job_rows(rows: list[StorygraphImportJobRow]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for row in rows:
        result.append(
            {
                "row_number": row.row_number,
                "title": row.title,
                "uid": row.uid,
                "result": row.result,
                "message": row.message,
                "work_id": str(row.work_id) if row.work_id else None,
                "library_item_id": (
                    str(row.library_item_id) if row.library_item_id else None
                ),
                "review_id": str(row.review_id) if row.review_id else None,
                "session_id": str(row.session_id) if row.session_id else None,
                "created_at": row.created_at.isoformat(),
            }
        )
    return result
