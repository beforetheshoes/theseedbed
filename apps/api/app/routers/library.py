from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.rate_limit import enforce_client_user_rate_limit
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.session import get_db_session
from app.services.auto_enrichment import (
    enqueue_tasks_for_user_items,
    process_due_tasks,
)
from app.services.google_books import GoogleBooksClient
from app.services.library_merges import apply_library_merge, preview_library_merge
from app.services.open_library import OpenLibraryClient
from app.services.reading_statistics import get_library_item_statistics
from app.services.user_library import (
    LibraryItemStatus,
    LibraryItemVisibility,
    create_or_get_library_item,
    delete_library_item,
    get_library_item_by_work_detail,
    list_library_items,
    update_library_item,
)


class CreateLibraryItemRequest(BaseModel):
    work_id: uuid.UUID
    preferred_edition_id: uuid.UUID | None = None
    status: LibraryItemStatus | None = None
    visibility: LibraryItemVisibility | None = None
    rating: int | None = Field(default=None, ge=0, le=10)
    tags: list[str] | None = None


class UpdateLibraryItemRequest(BaseModel):
    preferred_edition_id: uuid.UUID | None = None
    status: LibraryItemStatus | None = None
    visibility: LibraryItemVisibility | None = None
    rating: int | None = Field(default=None, ge=0, le=10)
    tags: list[str] | None = None


class MergeFieldResolutionRequest(BaseModel):
    status: str | None = None
    visibility: str | None = None
    rating: str | None = None
    preferred_edition_id: str | None = None
    tags: str | None = None

    def as_dict(self) -> dict[str, str]:
        data = self.model_dump(exclude_none=True)
        return {key: str(value) for key, value in data.items()}


class MergeLibraryItemsRequest(BaseModel):
    item_ids: list[uuid.UUID] = Field(min_length=2, max_length=20)
    target_item_id: uuid.UUID
    field_resolution: MergeFieldResolutionRequest = Field(
        default_factory=MergeFieldResolutionRequest
    )


class StatisticsWindow(BaseModel):
    days: int
    tz: str
    start_date: str
    end_date: str


class StatisticsTotals(BaseModel):
    total_pages: int | None
    total_audio_minutes: int | None


class StatisticsCounts(BaseModel):
    total_cycles: int
    completed_cycles: int
    imported_cycles: int
    completed_reads: int
    total_logs: int
    logs_with_canonical: int
    logs_missing_canonical: int


class StatisticsCurrent(BaseModel):
    latest_logged_at: str | None
    canonical_percent: float
    pages_read: float | None
    minutes_listened: float | None


class StatisticsStreak(BaseModel):
    non_zero_days: int
    last_non_zero_date: str | None


class StatisticsProgressPoint(BaseModel):
    date: str
    canonical_percent: float
    pages_read: float | None
    minutes_listened: float | None


class StatisticsDailyDeltaPoint(BaseModel):
    date: str
    canonical_percent_delta: float
    pages_read_delta: float | None
    minutes_listened_delta: float | None


class StatisticsSeries(BaseModel):
    progress_over_time: list[StatisticsProgressPoint]
    daily_delta: list[StatisticsDailyDeltaPoint]


class StatisticsTimelineEntry(BaseModel):
    log_id: str
    logged_at: str
    date: str
    unit: Literal["pages_read", "percent_complete", "minutes_listened"]
    value: float
    note: str | None
    start_value: float
    end_value: float
    session_delta: float


class StatisticsDataQuality(BaseModel):
    has_missing_totals: bool
    unresolved_logs_exist: bool
    unresolved_log_ids: list[str]


class LibraryItemStatisticsResponse(BaseModel):
    library_item_id: str
    window: StatisticsWindow
    totals: StatisticsTotals
    counts: StatisticsCounts
    current: StatisticsCurrent
    streak: StatisticsStreak
    series: StatisticsSeries
    timeline: list[StatisticsTimelineEntry]
    data_quality: StatisticsDataQuality


router = APIRouter(
    prefix="/api/v1/library/items",
    tags=["library"],
    dependencies=[Depends(enforce_client_user_rate_limit)],
)


def get_open_library_client() -> OpenLibraryClient:
    return OpenLibraryClient()


def get_google_books_client(
    settings: Annotated[Settings, Depends(get_settings)],
) -> GoogleBooksClient:
    return GoogleBooksClient(api_key=settings.google_books_api_key)


@router.get("")
async def list_items(
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 25,
    sort: Annotated[
        Literal[
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
        ],
        Query(),
    ] = "newest",
    status: str | None = None,
    tag: str | None = None,
    visibility: str | None = None,
) -> dict[str, object]:
    await process_due_tasks(
        session,
        user_id=auth.user_id,
        limit=settings.enrichment_opportunistic_batch_size,
        settings=settings,
        open_library=open_library,
        google_books=google_books,
    )
    try:
        result = list_library_items(
            session,
            user_id=auth.user_id,
            page=page,
            page_size=page_size,
            sort=sort,
            status=status,
            tag=tag,
            visibility=visibility,
        )
        if settings.enrichment_auto_enabled and result.get("items"):  # pragma: no cover
            item_ids = [
                uuid.UUID(str(item["id"]))
                for item in result["items"][: min(len(result["items"]), page_size)]
                if isinstance(item, dict) and item.get("id")
            ]
            if item_ids:
                enqueue_tasks_for_user_items(
                    session,
                    user_id=auth.user_id,
                    library_item_ids=item_ids,
                    trigger_source="lazy",
                    priority=120,
                    lazy_cooldown_hours=settings.enrichment_lazy_cooldown_hours,
                )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok(result)


@router.post("")
def create_item(
    payload: CreateLibraryItemRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        item, created = create_or_get_library_item(
            session,
            user_id=auth.user_id,
            work_id=payload.work_id,
            preferred_edition_id=payload.preferred_edition_id,
            status=payload.status,
            visibility=payload.visibility,
            rating=payload.rating,
            tags=payload.tags,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ok(
        {
            "id": str(item.id),
            "work_id": str(item.work_id),
            "status": item.status,
            "visibility": item.visibility,
            "rating": item.rating,
            "tags": item.tags or [],
            "created": created,
        }
    )


@router.patch("/{item_id}")
def patch_item(
    item_id: uuid.UUID,
    payload: UpdateLibraryItemRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    updates = payload.model_dump(exclude_unset=True)
    try:
        item = update_library_item(
            session,
            user_id=auth.user_id,
            item_id=item_id,
            updates=updates,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ok(
        {
            "id": str(item.id),
            "work_id": str(item.work_id),
            "preferred_edition_id": (
                str(item.preferred_edition_id) if item.preferred_edition_id else None
            ),
            "status": item.status,
            "visibility": item.visibility,
            "rating": item.rating,
            "tags": item.tags or [],
        }
    )


@router.delete("/{item_id}")
def remove_item(
    item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        delete_library_item(
            session,
            user_id=auth.user_id,
            item_id=item_id,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return ok({"deleted": True})


@router.post("/merge/preview")
def preview_merge(
    payload: MergeLibraryItemsRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        result = preview_library_merge(
            session,
            user_id=auth.user_id,
            item_ids=payload.item_ids,
            target_item_id=payload.target_item_id,
            field_resolution=payload.field_resolution.as_dict(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(result)


@router.post("/merge")
def apply_merge(
    payload: MergeLibraryItemsRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    try:
        result = apply_library_merge(
            session,
            user_id=auth.user_id,
            item_ids=payload.item_ids,
            target_item_id=payload.target_item_id,
            field_resolution=payload.field_resolution.as_dict(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok(result)


@router.get("/by-work/{work_id}")
def get_item_by_work(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
) -> dict[str, object]:
    detail = get_library_item_by_work_detail(
        session, user_id=auth.user_id, work_id=work_id
    )
    if detail is None:
        raise HTTPException(status_code=404, detail="library item not found")
    return ok(detail)


@router.get("/{item_id}/statistics")
def get_item_statistics(
    item_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    tz: str = "UTC",
    days: int = 90,
) -> dict[str, object]:
    try:
        data = get_library_item_statistics(
            session,
            user_id=auth.user_id,
            library_item_id=item_id,
            tz=tz,
            days=days,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ok(LibraryItemStatisticsResponse.model_validate(data).model_dump())
