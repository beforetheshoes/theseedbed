from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Annotated

import httpx
import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.responses import ok
from app.core.security import AuthContext, require_auth_context
from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId, SourceRecord
from app.db.models.users import LibraryItem
from app.db.session import get_db_session
from app.services.catalog import import_openlibrary_bundle
from app.services.google_books import GoogleBooksClient, GoogleBooksWorkBundle
from app.services.open_library import OpenLibraryClient, OpenLibraryWorkBundle
from app.services.storage import StorageNotConfiguredError
from app.services.user_library import get_or_create_profile
from app.services.work_covers import (
    list_googlebooks_cover_candidates,
    list_openlibrary_cover_candidates,
    select_cover_from_url,
    select_openlibrary_cover,
)
from app.services.work_metadata_enrichment import (
    apply_enrichment_selections,
    get_enrichment_candidates,
)
from app.services.works import (
    get_work_detail,
    list_related_works,
    list_work_editions,
    refresh_work_if_stale,
)

router = APIRouter(tags=["works"])


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


@router.get("/api/v1/works/{work_id}")
async def get_work(
    work_id: uuid.UUID,
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
) -> dict[str, object]:
    try:
        await refresh_work_if_stale(session, work_id=work_id, open_library=open_library)
        detail = get_work_detail(session, work_id=work_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError:
        # Best-effort refresh; continue with existing local data.
        detail = get_work_detail(session, work_id=work_id)
    return ok(detail)


@router.get("/api/v1/works/{work_id}/editions")
def list_editions(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> dict[str, object]:
    try:
        items = list_work_editions(session, work_id=work_id, limit=limit)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return ok({"items": items})


@router.get("/api/v1/works/{work_id}/covers")
async def list_work_covers(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        items = await list_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=open_library
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc

    if _google_books_enabled_for_user(auth=auth, session=session, settings=settings):
        try:
            items.extend(
                await list_googlebooks_cover_candidates(
                    session,
                    work_id=work_id,
                    google_books=google_books,
                )
            )
        except httpx.HTTPError:
            # Open Library remains the baseline provider. Ignore Google failures.
            pass
    return ok({"items": items})


@router.get("/api/v1/works/{work_id}/related")
async def related_works(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    limit: Annotated[int, Query(ge=1, le=24)] = 12,
) -> dict[str, object]:
    try:
        items = await list_related_works(
            session,
            work_id=work_id,
            open_library=open_library,
            limit=limit,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    return ok({"items": items})


class SelectCoverRequest(BaseModel):
    cover_id: int | None = Field(default=None, ge=1)
    source_url: str | None = Field(default=None, min_length=1)

    @model_validator(mode="after")
    def _validate_one_selector(self) -> SelectCoverRequest:
        has_cover_id = self.cover_id is not None
        has_source_url = bool(self.source_url and self.source_url.strip())
        if has_cover_id == has_source_url:
            raise ValueError("Provide exactly one of cover_id or source_url.")
        return self


class ApplyEnrichmentRequest(BaseModel):
    edition_id: uuid.UUID | None = None
    selections: list[dict[str, object]] = Field(default_factory=list)


class ImportOpenLibraryEditionRequest(BaseModel):
    edition_key: str = Field(min_length=3)
    work_key: str | None = Field(default=None, min_length=3)
    set_preferred: bool = True


FIELD_LABELS: dict[str, str] = {
    "work.description": "Description",
    "work.cover_url": "Cover",
    "work.first_publish_year": "First Published",
    "edition.publisher": "Publisher",
    "edition.publish_date": "Publish Date",
    "edition.isbn10": "ISBN-10",
    "edition.isbn13": "ISBN-13",
    "edition.language": "Language",
    "edition.format": "Format",
    "edition.total_pages": "Total Pages",
    "edition.total_audio_minutes": "Total Audiobook Minutes",
}


def _field_label(field_key: str) -> str:
    return FIELD_LABELS.get(field_key, field_key)


def _openlibrary_work_key_for_work(
    session: Session, *, work_id: uuid.UUID
) -> str | None:
    provider_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if not isinstance(provider_id, str) or not provider_id.strip():
        return None
    return provider_id.strip()


def _work_title_for_lookup(session: Session, *, work_id: uuid.UUID) -> str | None:
    work = session.get(Work, work_id)
    if work is None or not work.title.strip():
        return None
    return work.title.strip()


def _first_author_for_lookup(session: Session, *, work_id: uuid.UUID) -> str | None:
    row = session.execute(
        sa.select(Author.name)
        .select_from(WorkAuthor)
        .join(Author, Author.id == WorkAuthor.author_id)
        .where(WorkAuthor.work_id == work_id)
        .order_by(Author.name.asc())
        .limit(1)
    ).first()
    if row is None:
        return None
    name = row[0]
    if isinstance(name, str) and name.strip():
        return name.strip()
    return None


def _work_authors_for_lookup(session: Session, *, work_id: uuid.UUID) -> list[str]:
    rows = session.execute(
        sa.select(Author.name)
        .select_from(WorkAuthor)
        .join(Author, Author.id == WorkAuthor.author_id)
        .where(WorkAuthor.work_id == work_id)
        .order_by(Author.name.asc())
    ).all()
    names: list[str] = []
    seen: set[str] = set()
    for row in rows:
        name = row[0]
        if not isinstance(name, str):
            continue
        normalized = name.strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        names.append(normalized)
    return names


def _ensure_openlibrary_work_mapping(
    session: Session,
    *,
    work_id: uuid.UUID,
    work_key: str,
) -> None:
    existing_mapping = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )
    conflicting_mapping = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "work",
            ExternalId.provider == "openlibrary",
            ExternalId.provider_id == work_key,
        )
    )
    if conflicting_mapping is not None and conflicting_mapping.entity_id != work_id:
        raise HTTPException(
            status_code=409,
            detail="Open Library work key is already linked to a different work.",
        )

    if existing_mapping is None:
        session.add(
            ExternalId(
                entity_type="work",
                entity_id=work_id,
                provider="openlibrary",
                provider_id=work_key,
            )
        )
    else:
        existing_mapping.provider_id = work_key


def _first_string(values: object) -> str | None:
    if not isinstance(values, list):
        return None
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_source_title(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    title = raw.get("title")
    if isinstance(title, str) and title.strip():
        return title.strip()
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        value = volume_info.get("title")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_source_authors(raw: object) -> list[str]:
    if not isinstance(raw, dict):
        return []
    if isinstance(raw.get("author_name"), list):
        return [name for name in raw["author_name"] if isinstance(name, str)]
    authors = raw.get("authors")
    if isinstance(authors, list):
        return [name for name in authors if isinstance(name, str)]
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        value = volume_info.get("authors")
        if isinstance(value, list):
            return [name for name in value if isinstance(name, str)]
    return []


def _extract_source_cover(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    if isinstance(raw.get("covers"), list):
        for cover_id in raw["covers"]:
            if isinstance(cover_id, int) and cover_id > 0:
                return f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        image_links = volume_info.get("imageLinks")
        if isinstance(image_links, dict):
            for key in ("thumbnail", "smallThumbnail"):
                value = image_links.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip().replace("http://", "https://", 1)
    return None


def _extract_source_language(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    if isinstance(raw.get("languages"), list):
        for entry in raw["languages"]:
            if isinstance(entry, dict):
                key = entry.get("key")
                if isinstance(key, str) and key.startswith("/languages/"):
                    return key.removeprefix("/languages/")
            if isinstance(entry, str) and entry.strip():
                return entry.strip()
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        value = volume_info.get("language")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_source_publisher(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    value = _first_string(raw.get("publishers"))
    if value:
        return value
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        publisher = volume_info.get("publisher")
        if isinstance(publisher, str) and publisher.strip():
            return publisher.strip()
    return None


def _extract_source_publish_date(raw: object) -> str | None:
    if not isinstance(raw, dict):
        return None
    value = raw.get("publish_date")
    if isinstance(value, str) and value.strip():
        return value.strip()
    volume_info = raw.get("volumeInfo")
    if isinstance(volume_info, dict):
        published_date = volume_info.get("publishedDate")
        if isinstance(published_date, str) and published_date.strip():
            return published_date.strip()
    return None


def _extract_source_identifier(raw: object, fallback: str) -> str:
    if isinstance(raw, dict):
        isbn13 = _first_string(raw.get("isbn_13"))
        if isbn13:
            return isbn13
        isbn10 = _first_string(raw.get("isbn_10"))
        if isbn10:
            return isbn10
        volume_info = raw.get("volumeInfo")
        if isinstance(volume_info, dict):
            identifiers = volume_info.get("industryIdentifiers")
            if isinstance(identifiers, list):
                for identifier in identifiers:
                    if not isinstance(identifier, dict):
                        continue
                    value = identifier.get("identifier")
                    if isinstance(value, str) and value.strip():
                        return value.strip()
    return fallback


_TOKEN_RE = re.compile(r"[a-z0-9]+")


def _normalize_text_tokens(value: str | None) -> list[str]:
    if not isinstance(value, str):
        return []
    return _TOKEN_RE.findall(value.lower())


def _title_match_score(expected_title: str, candidate_title: str) -> int:
    expected_tokens = _normalize_text_tokens(expected_title)
    candidate_tokens = _normalize_text_tokens(candidate_title)
    if not expected_tokens or not candidate_tokens:
        return 0
    expected_joined = " ".join(expected_tokens)
    candidate_joined = " ".join(candidate_tokens)
    if expected_joined == candidate_joined:
        return 100
    overlap = len(set(expected_tokens) & set(candidate_tokens))
    coverage = overlap / max(len(set(expected_tokens)), 1)
    # Strong coverage of work-title tokens is required to avoid unrelated volumes.
    if coverage >= 0.95:
        return 80
    if coverage >= 0.75:
        return 60
    if expected_joined in candidate_joined:
        return 50
    return 0


def _author_match_score(
    expected_author: str | None, candidate_authors: list[str]
) -> int:
    if not expected_author:
        return 0
    expected_tokens = _normalize_text_tokens(expected_author)
    if not expected_tokens:
        return 0
    expected_last = expected_tokens[-1]
    for candidate in candidate_authors:
        candidate_tokens = _normalize_text_tokens(candidate)
        if not candidate_tokens:
            continue
        if expected_last and expected_last in candidate_tokens:
            return 30
        overlap = len(set(expected_tokens) & set(candidate_tokens))
        if overlap >= 2:
            return 25
        if overlap == 1:
            return 15
    return 0


async def _collect_google_source_tiles(
    *,
    work_id: uuid.UUID,
    auth: AuthContext,
    session: Session,
    google_books: GoogleBooksClient,
    settings: Settings,
    limit: int,
    language: str | None,
) -> list[dict[str, object]]:
    profile = get_or_create_profile(session, user_id=auth.user_id)
    if not profile.enable_google_books:
        return []
    work = session.get(Work, work_id)
    if work is None:
        return []
    title = work.title.strip()
    if not title:
        return []

    volume_ids: list[str] = []
    mapped_google_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "googlebooks",
        )
    )
    if isinstance(mapped_google_id, str) and mapped_google_id.strip():
        volume_ids.append(mapped_google_id.strip())

    first_author = _first_author_for_lookup(session, work_id=work_id)
    author_queries = [first_author or "", ""]
    seen_authors: set[str] = set()
    for author_query in author_queries:
        normalized_author = author_query.strip().lower()
        if normalized_author in seen_authors:
            continue
        seen_authors.add(normalized_author)
        search = await google_books.search_books(
            query=title,
            limit=min(limit, 10),
            page=1,
            author=author_query or None,
            language=language,
        )
        for search_item in search.items:
            if search_item.volume_id not in volume_ids:
                volume_ids.append(search_item.volume_id)
            if len(volume_ids) >= max(limit * 2, 20):
                break
        if len(volume_ids) >= max(limit * 2, 20):
            break

    scored_tiles: list[tuple[int, dict[str, object]]] = []
    seen_volume_ids: set[str] = set()
    for volume_id in volume_ids:
        if volume_id in seen_volume_ids:
            continue
        seen_volume_ids.add(volume_id)
        try:
            bundle = await google_books.fetch_work_bundle(volume_id=volume_id)
        except Exception:
            continue
        edition = bundle.edition if isinstance(bundle.edition, dict) else {}
        publish_date = edition.get("publish_date")
        publish_date_value = (
            publish_date.isoformat()
            if isinstance(publish_date, (date, datetime))
            else publish_date
        )
        score = _title_match_score(title, bundle.title) + _author_match_score(
            first_author, bundle.authors
        )
        # Empirically, Google print-edition records for this workflow commonly use
        # ...ACAAJ volume IDs and are better edition representatives than QBAJ/epub entries.
        if bundle.volume_id.endswith("ACAAJ"):
            score += 10
        if score < 60:
            continue
        scored_tiles.append(
            (
                score,
                {
                    "provider": "googlebooks",
                    "source_id": bundle.volume_id,
                    "title": bundle.title,
                    "authors": bundle.authors,
                    "publisher": edition.get("publisher"),
                    "publish_date": publish_date_value,
                    "language": edition.get("language"),
                    "identifier": edition.get("isbn13")
                    or edition.get("isbn10")
                    or bundle.volume_id,
                    "cover_url": bundle.cover_url,
                    "source_label": "Google Books",
                },
            )
        )
    scored_tiles.sort(key=lambda entry: entry[0], reverse=True)
    max_google_tiles = min(limit, 2)
    return [item for _, item in scored_tiles[:max_google_tiles]]


def _tile_sort_key(item: dict[str, object]) -> tuple[int, str]:
    provider = str(item.get("provider") or "")
    title = str(item.get("title") or "").lower()
    priority = 0 if provider == "openlibrary" else 1
    return (priority, title)


def _has_selected_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _selected_values_from_openlibrary_bundle(
    *,
    bundle: OpenLibraryWorkBundle,
) -> dict[str, object]:
    edition = bundle.edition if isinstance(bundle.edition, dict) else {}
    raw_edition = bundle.raw_edition if isinstance(bundle.raw_edition, dict) else {}
    return {
        "work.description": bundle.description,
        "work.cover_url": bundle.cover_url,
        "work.first_publish_year": bundle.first_publish_year,
        "edition.publisher": edition.get("publisher"),
        "edition.publish_date": edition.get("publish_date_iso")
        or edition.get("publish_date"),
        "edition.isbn10": edition.get("isbn10"),
        "edition.isbn13": edition.get("isbn13"),
        "edition.language": edition.get("language"),
        "edition.format": edition.get("format"),
        "edition.total_pages": edition.get("total_pages")
        or raw_edition.get("number_of_pages"),
        "edition.total_audio_minutes": edition.get("total_audio_minutes")
        or raw_edition.get("duration"),
    }


def _selected_values_from_google_bundle(
    *,
    bundle: GoogleBooksWorkBundle,
) -> dict[str, object]:
    edition = bundle.edition if isinstance(bundle.edition, dict) else {}
    return {
        "work.description": bundle.description,
        "work.cover_url": bundle.cover_url,
        "work.first_publish_year": bundle.first_publish_year,
        "edition.publisher": edition.get("publisher"),
        "edition.publish_date": edition.get("publish_date_iso"),
        "edition.isbn10": edition.get("isbn10"),
        "edition.isbn13": edition.get("isbn13"),
        "edition.language": edition.get("language"),
        "edition.format": edition.get("format"),
        "edition.total_pages": edition.get("total_pages"),
        "edition.total_audio_minutes": edition.get("total_audio_minutes"),
    }


def _resolve_openlibrary_work_key_for_source(
    *,
    session: Session,
    work_id: uuid.UUID,
    source_id: str,
) -> str | None:
    if source_id.startswith("/works/"):
        return source_id
    if source_id.startswith("/books/"):
        raw = session.scalar(
            sa.select(SourceRecord.raw).where(
                SourceRecord.provider == "openlibrary",
                SourceRecord.entity_type == "edition",
                SourceRecord.provider_id == source_id,
            )
        )
        if isinstance(raw, dict):
            works = raw.get("works")
            if isinstance(works, list):
                for item in works:
                    if not isinstance(item, dict):
                        continue
                    key = item.get("key")
                    if isinstance(key, str) and key.startswith("/works/"):
                        return key
    return _openlibrary_work_key_for_work(session, work_id=work_id)


def _openlibrary_edition_raw_has_compare_fields(raw: object) -> bool:
    if not isinstance(raw, dict):
        return False
    # We require at least one edition-specific metadata field and covers to avoid
    # stale partial rows forcing work-level fallback values in compare payloads.
    has_edition_data = any(
        _has_selected_value(value)
        for value in (
            _first_string(raw.get("publishers")),
            raw.get("publish_date") if isinstance(raw.get("publish_date"), str) else None,
            _first_string(raw.get("isbn_10")),
            _first_string(raw.get("isbn_13")),
            _extract_source_language(raw),
        )
    )
    covers = raw.get("covers")
    has_cover = isinstance(covers, list) and any(
        isinstance(cover_id, int) and cover_id > 0 for cover_id in covers
    )
    return has_edition_data and has_cover


def _upsert_source_record(
    session: Session,
    *,
    provider: str,
    entity_type: str,
    provider_id: str,
    raw: object,
) -> None:
    if not isinstance(raw, dict):
        return
    existing = session.scalar(
        sa.select(SourceRecord).where(
            SourceRecord.provider == provider,
            SourceRecord.entity_type == entity_type,
            SourceRecord.provider_id == provider_id,
        )
    )
    if existing is None:
        session.add(
            SourceRecord(
                provider=provider,
                entity_type=entity_type,
                provider_id=provider_id,
                raw=raw,
            )
        )
    else:
        existing.raw = raw


def _parse_openlibrary_description(raw_work: object) -> str | None:
    if not isinstance(raw_work, dict):
        return None
    description = raw_work.get("description")
    if isinstance(description, str) and description.strip():
        return description.strip()
    if isinstance(description, dict):
        value = description.get("value")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _parse_openlibrary_first_publish_year(raw_work: object) -> int | None:
    if not isinstance(raw_work, dict):
        return None
    for key in ("first_publish_year", "first_publish_date"):
        value = raw_work.get(key)
        if isinstance(value, int) and 0 < value < 10000:
            return value
        if isinstance(value, str):
            match = re.search(r"\b(\d{4})\b", value)
            if match:
                year = int(match.group(1))
                if 0 < year < 10000:
                    return year
    return None


def _parse_openlibrary_cover_url(raw_work: object, raw_edition: object) -> str | None:
    # Prefer the selected edition cover; fall back to work cover when absent.
    for raw in (raw_edition, raw_work):
        if not isinstance(raw, dict):
            continue
        covers = raw.get("covers")
        if not isinstance(covers, list):
            continue
        for cover_id in covers:
            if isinstance(cover_id, int) and cover_id > 0:
                return f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
    return None


def _parse_openlibrary_selected_values(
    *,
    raw_work: object,
    raw_edition: object,
) -> dict[str, object]:
    edition = raw_edition if isinstance(raw_edition, dict) else {}
    return {
        "work.description": _parse_openlibrary_description(raw_work),
        "work.cover_url": _parse_openlibrary_cover_url(raw_work, raw_edition),
        "work.first_publish_year": _parse_openlibrary_first_publish_year(raw_work),
        "edition.publisher": _first_string(edition.get("publishers")),
        "edition.publish_date": (
            edition.get("publish_date")
            if isinstance(edition.get("publish_date"), str)
            else None
        ),
        "edition.isbn10": _first_string(edition.get("isbn_10")),
        "edition.isbn13": _first_string(edition.get("isbn_13")),
        "edition.language": _extract_source_language(edition),
        "edition.format": (
            edition.get("physical_format")
            if isinstance(edition.get("physical_format"), str)
            else None
        ),
        "edition.total_pages": (
            edition.get("number_of_pages")
            if isinstance(edition.get("number_of_pages"), int)
            else None
        ),
        "edition.total_audio_minutes": (
            edition.get("duration")
            if isinstance(edition.get("duration"), (int, float, str))
            else None
        ),
    }


def _parse_google_selected_values(raw_volume: object) -> dict[str, object]:
    if not isinstance(raw_volume, dict):
        return {}
    volume_info = raw_volume.get("volumeInfo")
    if not isinstance(volume_info, dict):
        volume_info = {}
    published_date = (
        volume_info.get("publishedDate")
        if isinstance(volume_info.get("publishedDate"), str)
        else None
    )
    publish_year = None
    if published_date:
        match = re.search(r"\b(\d{4})\b", published_date)
        if match:
            publish_year = int(match.group(1))
    image_links = volume_info.get("imageLinks")
    cover_url = None
    if isinstance(image_links, dict):
        for key in ("thumbnail", "smallThumbnail"):
            value = image_links.get(key)
            if isinstance(value, str) and value.strip():
                cover_url = value.strip().replace("http://", "https://", 1)
                break
    raw_identifiers = volume_info.get("industryIdentifiers")
    identifiers: list[object] = (
        raw_identifiers if isinstance(raw_identifiers, list) else []
    )
    isbn10 = _first_string(
        [
            item.get("identifier")
            for item in identifiers
            if isinstance(item, dict)
            and str(item.get("type") or "").upper() == "ISBN_10"
            and isinstance(item.get("identifier"), str)
        ]
    )
    isbn13 = _first_string(
        [
            item.get("identifier")
            for item in identifiers
            if isinstance(item, dict)
            and str(item.get("type") or "").upper() == "ISBN_13"
            and isinstance(item.get("identifier"), str)
        ]
    )
    return {
        "work.description": (
            volume_info.get("description")
            if isinstance(volume_info.get("description"), str)
            else None
        ),
        "work.cover_url": cover_url,
        "work.first_publish_year": publish_year,
        "edition.publisher": (
            volume_info.get("publisher")
            if isinstance(volume_info.get("publisher"), str)
            else None
        ),
        "edition.publish_date": published_date,
        "edition.isbn10": isbn10,
        "edition.isbn13": isbn13,
        "edition.language": (
            volume_info.get("language")
            if isinstance(volume_info.get("language"), str)
            else None
        ),
        "edition.format": (
            volume_info.get("printType")
            if isinstance(volume_info.get("printType"), str)
            else None
        ),
        "edition.total_pages": (
            volume_info.get("pageCount")
            if isinstance(volume_info.get("pageCount"), int)
            else None
        ),
        "edition.total_audio_minutes": None,
    }


def _resolve_edition_target_for_compare(
    *,
    session: Session,
    work_id: uuid.UUID,
    user_id: uuid.UUID,
    edition_id: uuid.UUID | None,
) -> Edition | None:
    if edition_id is not None:
        return session.scalar(
            sa.select(Edition).where(
                Edition.id == edition_id,
                Edition.work_id == work_id,
            )
        )
    preferred = session.scalar(
        sa.select(LibraryItem.preferred_edition_id).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if isinstance(preferred, uuid.UUID):
        edition = session.scalar(
            sa.select(Edition).where(
                Edition.id == preferred,
                Edition.work_id == work_id,
            )
        )
        if edition is not None:
            return edition
    return session.scalar(
        sa.select(Edition)
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(1)
    )


def _current_field_values_for_compare(
    *,
    session: Session,
    work_id: uuid.UUID,
    user_id: uuid.UUID,
    edition_id: uuid.UUID | None,
) -> dict[str, object]:
    work = session.get(Work, work_id)
    if work is None:
        raise HTTPException(status_code=404, detail="work not found")
    edition = _resolve_edition_target_for_compare(
        session=session,
        work_id=work_id,
        user_id=user_id,
        edition_id=edition_id,
    )
    return {
        "work.description": work.description,
        "work.cover_url": work.default_cover_url,
        "work.first_publish_year": work.first_publish_year,
        "edition.publisher": edition.publisher if edition else None,
        "edition.publish_date": edition.publish_date if edition else None,
        "edition.isbn10": edition.isbn10 if edition else None,
        "edition.isbn13": edition.isbn13 if edition else None,
        "edition.language": edition.language if edition else None,
        "edition.format": edition.format if edition else None,
        "edition.total_pages": edition.total_pages if edition else None,
        "edition.total_audio_minutes": (
            edition.total_audio_minutes if edition else None
        ),
    }


async def _build_cover_metadata_compare_payload(
    *,
    session: Session,
    auth: AuthContext,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
    provider: str,
    source_id: str,
    edition_id: uuid.UUID | None,
) -> dict[str, object]:
    normalized_provider = provider.strip().lower()
    if normalized_provider not in {"openlibrary", "googlebooks"}:
        raise HTTPException(status_code=400, detail="provider must be supported")
    normalized_source_id = source_id.strip()
    if not normalized_source_id:
        raise HTTPException(status_code=400, detail="source_id is required")

    current_values = _current_field_values_for_compare(
        session=session,
        work_id=work_id,
        user_id=auth.user_id,
        edition_id=edition_id,
    )

    selected_source_label = None
    selected_values: dict[str, object] = {}
    selected_provider_ids: dict[str, str] = {}
    should_commit = False

    if normalized_provider == "openlibrary":
        work_key = _resolve_openlibrary_work_key_for_source(
            session=session,
            work_id=work_id,
            source_id=normalized_source_id,
        )
        if not work_key:
            raise HTTPException(
                status_code=404,
                detail="Unable to resolve Open Library work for selected source.",
            )
        edition_key = (
            normalized_source_id if normalized_source_id.startswith("/books/") else None
        )
        raw_work = session.scalar(
            sa.select(SourceRecord.raw).where(
                SourceRecord.provider == "openlibrary",
                SourceRecord.entity_type == "work",
                SourceRecord.provider_id == work_key,
            )
        )
        raw_edition = None
        if edition_key:
            raw_edition = session.scalar(
                sa.select(SourceRecord.raw).where(
                    SourceRecord.provider == "openlibrary",
                    SourceRecord.entity_type == "edition",
                    SourceRecord.provider_id == edition_key,
                )
            )
        edition_requires_refresh = bool(
            edition_key and not _openlibrary_edition_raw_has_compare_fields(raw_edition)
        )
        if (
            not isinstance(raw_work, dict)
            or (edition_key and not isinstance(raw_edition, dict))
            or edition_requires_refresh
        ):
            openlibrary_bundle = await open_library.fetch_work_bundle(
                work_key=work_key,
                edition_key=edition_key,
            )
            _upsert_source_record(
                session,
                provider="openlibrary",
                entity_type="work",
                provider_id=openlibrary_bundle.work_key,
                raw=openlibrary_bundle.raw_work,
            )
            should_commit = True
            raw_work = openlibrary_bundle.raw_work
            if openlibrary_bundle.raw_edition and edition_key:
                _upsert_source_record(
                    session,
                    provider="openlibrary",
                    entity_type="edition",
                    provider_id=edition_key,
                    raw=openlibrary_bundle.raw_edition,
                )
                should_commit = True
                raw_edition = openlibrary_bundle.raw_edition
        selected_values = _parse_openlibrary_selected_values(
            raw_work=raw_work,
            raw_edition=raw_edition,
        )
        selected_source_label = f"Open Library {normalized_source_id.removeprefix('/works/').removeprefix('/books/')}"
        for field_key in FIELD_LABELS:
            provider_id = work_key
            if field_key.startswith("edition.") and edition_key:
                provider_id = edition_key
            selected_provider_ids[field_key] = provider_id
    else:
        raw_volume = session.scalar(
            sa.select(SourceRecord.raw).where(
                SourceRecord.provider == "googlebooks",
                SourceRecord.entity_type == "edition",
                SourceRecord.provider_id == normalized_source_id,
            )
        )
        if not isinstance(raw_volume, dict):
            google_bundle = await google_books.fetch_work_bundle(
                volume_id=normalized_source_id
            )
            _upsert_source_record(
                session,
                provider="googlebooks",
                entity_type="work",
                provider_id=google_bundle.volume_id,
                raw=google_bundle.raw_volume,
            )
            _upsert_source_record(
                session,
                provider="googlebooks",
                entity_type="edition",
                provider_id=google_bundle.volume_id,
                raw=google_bundle.raw_volume,
            )
            should_commit = True
            raw_volume = google_bundle.raw_volume
        selected_values = _parse_google_selected_values(raw_volume)
        selected_source_label = f"Google Books {normalized_source_id}"
        for field_key in FIELD_LABELS:
            selected_provider_ids[field_key] = normalized_source_id

    if should_commit:
        session.commit()

    compared_fields: list[dict[str, object]] = []
    for field_key in FIELD_LABELS:
        selected_value = selected_values.get(field_key)
        selected_available = _has_selected_value(selected_value)
        compared_fields.append(
            {
                "field_key": field_key,
                "field_label": _field_label(field_key),
                "current_value": current_values.get(field_key),
                "selected_value": selected_value if selected_available else None,
                "selected_available": selected_available,
                "provider": normalized_provider,
                "provider_id": selected_provider_ids.get(
                    field_key, normalized_source_id
                ),
            }
        )

    return {
        "selected_source": {
            "provider": normalized_provider,
            "source_id": normalized_source_id,
            "source_label": selected_source_label
            or (
                "Open Library"
                if normalized_provider == "openlibrary"
                else "Google Books"
            ),
            "edition_id": str(edition_id) if edition_id else None,
        },
        "fields": compared_fields,
    }


@router.post("/api/v1/works/{work_id}/covers/select")
async def select_cover(
    work_id: uuid.UUID,
    payload: SelectCoverRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        if payload.cover_id is not None:
            result = await select_openlibrary_cover(
                session,
                settings=settings,
                user_id=auth.user_id,
                work_id=work_id,
                cover_id=payload.cover_id,
            )
        else:
            result = await select_cover_from_url(
                session,
                settings=settings,
                user_id=auth.user_id,
                work_id=work_id,
                source_url=(payload.source_url or "").strip(),
            )
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "cover_cache_failed",
                "message": "Unable to cache cover image right now. Please try again shortly.",
            },
        ) from exc
    except StorageNotConfiguredError as exc:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "cover_upload_unavailable",
                "message": "Cover uploads are temporarily unavailable. Please try again later.",
            },
        ) from exc

    return ok(result)


@router.get("/api/v1/works/{work_id}/cover-metadata/sources")
async def list_cover_metadata_sources(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
    language: str | None = Query(default=None, min_length=1, max_length=32),
    include_prefetch_compare: bool = Query(default=False),
    prefetch_limit: Annotated[int, Query(ge=1, le=6)] = 3,
) -> dict[str, object]:
    mapped_work_key = _openlibrary_work_key_for_work(session, work_id=work_id)
    work_author_names = _work_authors_for_lookup(session, work_id=work_id)
    if mapped_work_key and not work_author_names:
        try:
            mapped_bundle = await open_library.fetch_work_bundle(
                work_key=mapped_work_key
            )
            bundle_authors = (
                mapped_bundle.authors if isinstance(mapped_bundle.authors, list) else []
            )
            names: list[str] = []
            for author in bundle_authors:
                if not isinstance(author, dict):
                    continue
                name = author.get("name")
                if isinstance(name, str) and name.strip():
                    names.append(name.strip())
            if names:
                work_author_names = names
        except Exception:
            pass
    candidate_works: list[tuple[str, str, list[str]]] = []
    if mapped_work_key:
        candidate_works.append(
            (mapped_work_key, "Mapped Open Library work", work_author_names)
        )
    else:
        lookup_title = _work_title_for_lookup(session, work_id=work_id)
        if lookup_title:
            lookup_author = _first_author_for_lookup(session, work_id=work_id)
            matches = await open_library.search_books(
                query=lookup_title,
                limit=min(5, limit),
                page=1,
                author=lookup_author,
                language=language,
                sort="relevance",
            )
            seen_work_keys: set[str] = set()
            for match_item in matches.items:
                normalized_work_key = match_item.work_key.strip()
                if not normalized_work_key or normalized_work_key in seen_work_keys:
                    continue
                seen_work_keys.add(normalized_work_key)
                candidate_works.append(
                    (
                        normalized_work_key,
                        match_item.title,
                        match_item.author_names,
                    )
                )
                if len(candidate_works) >= 3:
                    break

    openlibrary_items: list[dict[str, object]] = []
    seen_openlibrary_ids: set[str] = set()
    per_work_limit = max(5, min(limit, 20))
    for work_key, work_title, work_authors in candidate_works:
        editions = await open_library.fetch_work_editions(
            work_key=work_key,
            limit=per_work_limit,
            language=language,
        )
        for entry in editions:
            if entry.key in seen_openlibrary_ids:
                continue
            seen_openlibrary_ids.add(entry.key)
            openlibrary_items.append(
                {
                    "provider": "openlibrary",
                    "source_id": entry.key,
                    "title": entry.title or work_title,
                    "authors": work_authors or work_author_names,
                    "publisher": entry.publisher,
                    "publish_date": entry.publish_date,
                    "language": entry.language,
                    "identifier": entry.isbn13 or entry.isbn10 or entry.key,
                    "cover_url": entry.cover_url,
                    "source_label": "Open Library",
                }
            )
            if len(openlibrary_items) >= limit:
                break
        if len(openlibrary_items) >= limit:
            break

    google_items = await _collect_google_source_tiles(
        work_id=work_id,
        auth=auth,
        session=session,
        google_books=google_books,
        settings=settings,
        limit=limit,
        language=language,
    )

    deduped: list[dict[str, object]] = []
    seen_keys: set[tuple[str, str]] = set()
    for source_item in [*openlibrary_items, *google_items]:
        provider = str(source_item.get("provider") or "")
        source_id = str(source_item.get("source_id") or "")
        if not provider or not source_id:
            continue
        key = (provider, source_id)
        if key in seen_keys:
            continue
        seen_keys.add(key)
        deduped.append(source_item)
    deduped.sort(key=_tile_sort_key)

    source_records = session.execute(
        sa.select(
            SourceRecord.provider, SourceRecord.provider_id, SourceRecord.raw
        ).where(SourceRecord.provider.in_(["openlibrary", "googlebooks"]))
    ).all()
    source_lookup = {
        (provider, provider_id): raw
        for provider, provider_id, raw in source_records
        if isinstance(provider, str) and isinstance(provider_id, str)
    }
    for source_item in deduped:
        provider = str(source_item.get("provider") or "")
        source_id = str(source_item.get("source_id") or "")
        raw = source_lookup.get((provider, source_id))
        if not source_item.get("title"):
            source_item["title"] = _extract_source_title(raw) or "Untitled"
        if not isinstance(source_item.get("authors"), list):
            source_item["authors"] = _extract_source_authors(raw)
        if not source_item.get("publisher"):
            source_item["publisher"] = _extract_source_publisher(raw)
        if not source_item.get("publish_date"):
            source_item["publish_date"] = _extract_source_publish_date(raw)
        if not source_item.get("language"):
            source_item["language"] = _extract_source_language(raw)
        if not source_item.get("cover_url"):
            source_item["cover_url"] = _extract_source_cover(raw)
        identifier = str(source_item.get("identifier") or "").strip()
        if not identifier:
            source_item["identifier"] = _extract_source_identifier(raw, source_id)

    items = deduped[:limit]
    prefetch_compare: dict[str, object] = {}
    if include_prefetch_compare:
        for source_item in items[:prefetch_limit]:
            provider = str(source_item.get("provider") or "").strip().lower()
            source_id = str(source_item.get("source_id") or "").strip()
            if not provider or not source_id:
                continue
            payload = await _build_cover_metadata_compare_payload(
                session=session,
                auth=auth,
                work_id=work_id,
                open_library=open_library,
                google_books=google_books,
                provider=provider,
                source_id=source_id,
                edition_id=None,
            )
            prefetch_compare[f"{provider}:{source_id}"] = payload

    return ok(
        {
            "items": items,
            "prefetch_compare": prefetch_compare,
        }
    )


@router.get("/api/v1/works/{work_id}/cover-metadata/compare")
async def compare_cover_metadata_source(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    provider: Annotated[str, Query(min_length=1, max_length=32)],
    source_id: Annotated[str, Query(min_length=1, max_length=255)],
    edition_id: uuid.UUID | None = None,
) -> dict[str, object]:
    payload = await _build_cover_metadata_compare_payload(
        session=session,
        auth=auth,
        work_id=work_id,
        open_library=open_library,
        google_books=google_books,
        provider=provider,
        source_id=source_id,
        edition_id=edition_id,
    )
    return ok(payload)


@router.get("/api/v1/works/{work_id}/provider-editions/openlibrary")
async def list_openlibrary_editions(
    work_id: uuid.UUID,
    _auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    language: str | None = Query(default=None, min_length=1, max_length=32),
) -> dict[str, object]:
    mapped_work_key = _openlibrary_work_key_for_work(session, work_id=work_id)
    candidate_works: list[tuple[str, str, list[str]]] = []
    if mapped_work_key:
        candidate_works.append((mapped_work_key, "Mapped Open Library work", []))
    else:
        lookup_title = _work_title_for_lookup(session, work_id=work_id)
        if lookup_title:
            lookup_author = _first_author_for_lookup(session, work_id=work_id)
            matches = await open_library.search_books(
                query=lookup_title,
                limit=min(5, limit),
                page=1,
                author=lookup_author,
                language=language,
                sort="relevance",
            )
            seen_work_keys: set[str] = set()
            for item in matches.items:
                normalized_work_key = item.work_key.strip()
                if not normalized_work_key or normalized_work_key in seen_work_keys:
                    continue
                seen_work_keys.add(normalized_work_key)
                candidate_works.append(
                    (normalized_work_key, item.title, item.author_names)
                )
                if len(candidate_works) >= 3:
                    break

    items: list[dict[str, object | None]] = []
    seen_edition_keys: set[str] = set()
    per_work_limit = max(5, min(limit, 20))
    for work_key, work_title, work_authors in candidate_works:
        editions = await open_library.fetch_work_editions(
            work_key=work_key,
            limit=per_work_limit,
            language=language,
        )
        for entry in editions:
            if entry.key in seen_edition_keys:
                continue
            seen_edition_keys.add(entry.key)
            items.append(
                {
                    "work_key": work_key,
                    "work_title": work_title,
                    "work_authors": work_authors,
                    "edition_key": entry.key,
                    "title": entry.title,
                    "publisher": entry.publisher,
                    "publish_date": entry.publish_date,
                    "language": entry.language,
                    "isbn10": entry.isbn10,
                    "isbn13": entry.isbn13,
                    "cover_url": entry.cover_url,
                }
            )
            if len(items) >= limit:
                break
        if len(items) >= limit:
            break

    edition_keys = [str(entry["edition_key"]) for entry in items]
    imported_lookup: dict[str, str] = {}
    if edition_keys:
        imported_rows = session.execute(
            sa.select(ExternalId.provider_id, ExternalId.entity_id)
            .join(Edition, Edition.id == ExternalId.entity_id)
            .where(
                ExternalId.entity_type == "edition",
                ExternalId.provider == "openlibrary",
                ExternalId.provider_id.in_(edition_keys),
                Edition.work_id == work_id,
            )
        ).all()
        imported_lookup = {
            provider_id: str(entity_id) for provider_id, entity_id in imported_rows
        }

    return ok(
        {
            "items": [
                {
                    **entry,
                    "imported_edition_id": imported_lookup.get(
                        str(entry["edition_key"])
                    ),
                }
                for entry in items
            ],
            "mapped_work_key": mapped_work_key,
        }
    )


@router.post("/api/v1/works/{work_id}/provider-editions/openlibrary/import")
async def import_openlibrary_edition(
    work_id: uuid.UUID,
    payload: ImportOpenLibraryEditionRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
) -> dict[str, object]:
    payload_work_key = (payload.work_key or "").strip()
    existing_work_key = _openlibrary_work_key_for_work(session, work_id=work_id)
    openlibrary_work_key = payload_work_key or existing_work_key
    if not openlibrary_work_key:
        raise HTTPException(
            status_code=400,
            detail="Select an Open Library work before importing an edition.",
        )

    _ensure_openlibrary_work_mapping(
        session,
        work_id=work_id,
        work_key=openlibrary_work_key,
    )

    bundle = await open_library.fetch_work_bundle(
        work_key=openlibrary_work_key,
        edition_key=payload.edition_key,
    )
    result = import_openlibrary_bundle(session, bundle=bundle)
    imported_edition = result.get("edition")
    imported_edition_id = (
        imported_edition.get("id")
        if isinstance(imported_edition, dict)
        and isinstance(imported_edition.get("id"), str)
        else None
    )

    if payload.set_preferred and imported_edition_id is not None:
        item = session.scalar(
            sa.select(LibraryItem).where(
                LibraryItem.user_id == auth.user_id,
                LibraryItem.work_id == work_id,
            )
        )
        if item is not None:
            item.preferred_edition_id = uuid.UUID(imported_edition_id)
            session.commit()

    return ok(
        {
            "imported_edition_id": imported_edition_id,
            "edition": imported_edition,
        }
    )


@router.get("/api/v1/works/{work_id}/enrichment/candidates")
async def list_enrichment_candidates(
    work_id: uuid.UUID,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await get_enrichment_candidates(
            session,
            user_id=auth.user_id,
            work_id=work_id,
            open_library=open_library,
            google_books=google_books,
            # Enrichment should always attempt Google as a best-effort fallback
            # when Open Library data is sparse.
            google_enabled=True,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ok(result)


@router.post("/api/v1/works/{work_id}/enrichment/apply")
async def apply_enrichment(
    work_id: uuid.UUID,
    payload: ApplyEnrichmentRequest,
    auth: Annotated[AuthContext, Depends(require_auth_context)],
    session: Annotated[Session, Depends(get_db_session)],
    open_library: Annotated[OpenLibraryClient, Depends(get_open_library_client)],
    google_books: Annotated[GoogleBooksClient, Depends(get_google_books_client)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    try:
        result = await apply_enrichment_selections(
            session,
            user_id=auth.user_id,
            work_id=work_id,
            selections=payload.selections,
            edition_id=payload.edition_id,
            open_library=open_library,
            google_books=google_books,
            google_enabled=True,
        )
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "open_library_unavailable",
                "message": "Open Library is unavailable. Please try again shortly.",
            },
        ) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return ok(result)
