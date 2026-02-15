from __future__ import annotations

import datetime as dt
import json
import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.models.imports import StorygraphImportJob
from app.db.session import get_db_session
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient
from app.services.storygraph_imports import (
    create_storygraph_job,
    get_active_storygraph_job,
    get_storygraph_job,
    list_storygraph_job_rows,
    process_storygraph_import_job,
    serialize_job,
    serialize_job_rows,
)
from app.services.storygraph_parser import (
    StorygraphMissingRequiredField,
    find_missing_required_fields,
    is_valid_isbn,
)
from app.services.user_library import get_or_create_profile

router = APIRouter(
    prefix="/api/v1/imports/storygraph",
    tags=["storygraph-imports"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


def get_google_books_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleBooksClient:
    return GoogleBooksClient(api_key=settings.google_books_api_key)


def _google_books_enabled_for_user(
    *,
    auth: AuthContext,
    session: Session,
    settings: Settings,
) -> bool:
    if not settings.book_provider_google_enabled:
        return False
    if not settings.google_books_api_key:
        return False
    profile = get_or_create_profile(session, user_id=auth.user_id)
    return bool(profile.enable_google_books)


def _parse_row_override_payload(
    value: str | None,
    *,
    key_name: str,
) -> dict[int, str] | None:
    if not value:
        return None
    try:
        raw = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"invalid {key_name} payload"
        ) from exc
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail=f"{key_name} must be an object")

    parsed: dict[int, str] = {}
    for key, item in raw.items():
        if not isinstance(item, str):
            raise HTTPException(
                status_code=400,
                detail=f"{key_name} values must be strings",
            )
        try:
            row_number = int(key)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"{key_name} keys must be row numbers",
            ) from exc
        parsed[row_number] = item
    return parsed


def _parse_row_number_list_payload(
    value: str | None,
    *,
    key_name: str,
) -> set[int] | None:
    if not value:
        return None
    try:
        raw = json.loads(value)
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail=f"invalid {key_name} payload"
        ) from exc
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail=f"{key_name} must be an array")

    parsed: set[int] = set()
    for item in raw:
        try:
            parsed.add(int(item))
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail=f"{key_name} values must be row numbers",
            ) from exc
    return parsed


def _issue_code_for_field(field: str) -> str:
    if field == "authors":
        return "missing_authors"
    if field == "title":
        return "missing_title"
    return "missing_read_status"


@dataclass(frozen=True)
class _MetadataSuggestion:
    title: str | None
    authors: str | None
    source: str | None
    confidence: str | None


def _author_list_to_value(authors: list[str]) -> str | None:
    values = [name.strip() for name in authors if name.strip()]
    if not values:
        return None
    return ", ".join(values)


async def _fetch_metadata_suggestion(
    *,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
    title: str | None,
    uid: str | None,
    include_google_books: bool,
) -> _MetadataSuggestion:
    if uid and is_valid_isbn(uid):
        try:
            work_key = await open_library.find_work_key_by_isbn(isbn=uid)
            if work_key:
                bundle = await open_library.fetch_work_bundle(work_key=work_key)
                return _MetadataSuggestion(
                    title=bundle.title.strip() or None,
                    authors=_author_list_to_value(
                        [author["name"] for author in bundle.authors]
                    ),
                    source="openlibrary:isbn",
                    confidence="high",
                )
        except Exception:
            pass

        if include_google_books:
            try:
                gb_search = await google_books.search_books(
                    query=f"isbn:{uid}", limit=1
                )
                if gb_search.items:
                    first_gb = gb_search.items[0]
                    return _MetadataSuggestion(
                        title=first_gb.title.strip() or None,
                        authors=_author_list_to_value(first_gb.author_names),
                        source="googlebooks:isbn",
                        confidence="high",
                    )
            except Exception:
                pass

    if title:
        try:
            ol_search = await open_library.search_books(query=title, limit=1)
            if ol_search.items:
                first_ol = ol_search.items[0]
                return _MetadataSuggestion(
                    title=first_ol.title.strip() or None,
                    authors=_author_list_to_value(first_ol.author_names),
                    source="openlibrary:search",
                    confidence="medium",
                )
        except Exception:
            pass

        if include_google_books:
            try:
                gb_search = await google_books.search_books(query=title, limit=1)
                if gb_search.items:
                    first_gb = gb_search.items[0]
                    return _MetadataSuggestion(
                        title=first_gb.title.strip() or None,
                        authors=_author_list_to_value(first_gb.author_names),
                        source="googlebooks:search",
                        confidence="medium",
                    )
            except Exception:
                pass

    return _MetadataSuggestion(
        title=None,
        authors=None,
        source=None,
        confidence=None,
    )


def _resolve_missing_item(
    *,
    issue: StorygraphMissingRequiredField,
    suggestion: _MetadataSuggestion,
) -> dict[str, object]:
    suggested_value: str | None = None
    if issue.field == "authors":
        suggested_value = suggestion.authors
    elif issue.field == "title":
        suggested_value = suggestion.title

    return {
        "row_number": issue.row_number,
        "field": issue.field,
        "issue_code": _issue_code_for_field(issue.field),
        "required": True,
        "title": issue.title,
        "uid": issue.uid,
        "suggested_value": suggested_value,
        "suggestion_source": suggestion.source,
        "suggestion_confidence": suggestion.confidence,
    }


def _mark_job_failed_if_stale(session: Session, *, job: StorygraphImportJob) -> bool:
    stale_cutoff = dt.datetime.now(tz=dt.UTC) - dt.timedelta(minutes=3)
    if job.status != "running":
        return False
    updated_at = job.updated_at
    if updated_at is None or updated_at >= stale_cutoff:
        return False
    job.status = "failed"
    job.error_summary = "Import job stalled and was marked failed."
    job.finished_at = dt.datetime.now(tz=dt.UTC)
    job.updated_at = job.finished_at
    session.commit()
    return True


@router.post("")
async def create_import_job(
    background_tasks: BackgroundTasks,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    file: Annotated[UploadFile, File(...)],
    author_overrides: Annotated[str | None, Form()] = None,
    title_overrides: Annotated[str | None, Form()] = None,
    status_overrides: Annotated[str | None, Form()] = None,
    skipped_rows: Annotated[str | None, Form()] = None,
    skip_reasons: Annotated[str | None, Form()] = None,
) -> dict[str, object]:
    filename = (file.filename or "storygraph.csv").strip()
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="file must be a .csv export")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="file is empty")
    parsed_author_overrides = _parse_row_override_payload(
        author_overrides, key_name="author_overrides"
    )
    parsed_title_overrides = _parse_row_override_payload(
        title_overrides, key_name="title_overrides"
    )
    parsed_status_overrides = _parse_row_override_payload(
        status_overrides, key_name="status_overrides"
    )
    parsed_skipped_rows = _parse_row_number_list_payload(
        skipped_rows, key_name="skipped_rows"
    )
    parsed_skip_reasons = _parse_row_override_payload(
        skip_reasons, key_name="skip_reasons"
    )

    active_job = get_active_storygraph_job(session, user_id=auth.user_id)
    if active_job is not None:
        if not _mark_job_failed_if_stale(session, job=active_job):
            return ok(
                {
                    "job_id": str(active_job.id),
                    "status": active_job.status,
                    "created_at": active_job.created_at.isoformat(),
                    "total_rows": active_job.total_rows,
                    "processed_rows": active_job.processed_rows,
                    "imported_rows": active_job.imported_rows,
                    "failed_rows": active_job.failed_rows,
                    "skipped_rows": active_job.skipped_rows,
                }
            )

    job = create_storygraph_job(session, user_id=auth.user_id, filename=filename)
    background_tasks.add_task(
        process_storygraph_import_job,
        user_id=auth.user_id,
        job_id=job.id,
        csv_bytes=payload,
        author_overrides=parsed_author_overrides,
        title_overrides=parsed_title_overrides,
        status_overrides=parsed_status_overrides,
        skipped_rows=parsed_skipped_rows,
        skip_reasons=parsed_skip_reasons,
    )

    return ok(
        {
            "job_id": str(job.id),
            "status": job.status,
            "created_at": job.created_at.isoformat(),
            "total_rows": job.total_rows,
            "processed_rows": job.processed_rows,
            "imported_rows": job.imported_rows,
            "failed_rows": job.failed_rows,
            "skipped_rows": job.skipped_rows,
        }
    )


@router.post("/missing-authors")
async def get_missing_authors(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    file: Annotated[UploadFile, File(...)],
) -> dict[str, object]:
    filename = (file.filename or "storygraph.csv").strip()
    if not filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="file must be a .csv export")

    payload = await file.read()
    if not payload:
        raise HTTPException(status_code=400, detail="file is empty")

    include_google_books = _google_books_enabled_for_user(
        auth=auth,
        session=session,
        settings=settings,
    )
    required_issues = find_missing_required_fields(payload)
    metadata_cache: dict[int, _MetadataSuggestion] = {}
    items: list[dict[str, object]] = []
    for issue in required_issues:
        suggestion = metadata_cache.get(issue.row_number)
        if suggestion is None:
            suggestion = await _fetch_metadata_suggestion(
                open_library=open_library,
                google_books=google_books,
                title=issue.title,
                uid=issue.uid,
                include_google_books=include_google_books,
            )
            metadata_cache[issue.row_number] = suggestion
        items.append(_resolve_missing_item(issue=issue, suggestion=suggestion))

    return ok({"items": items})


@router.get("/{job_id}")
def get_import_job(
    job_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        job = get_storygraph_job(session, user_id=auth.user_id, job_id=job_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    _mark_job_failed_if_stale(session, job=job)
    return ok(serialize_job(session, user_id=auth.user_id, job_id=job_id))


@router.get("/{job_id}/rows")
def get_import_job_rows(
    job_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    cursor: Annotated[int | None, Query(ge=0)] = None,
) -> dict[str, object]:
    try:
        rows, next_cursor = list_storygraph_job_rows(
            session,
            user_id=auth.user_id,
            job_id=job_id,
            limit=limit,
            cursor=cursor,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ok({"items": serialize_job_rows(rows), "next_cursor": next_cursor})
