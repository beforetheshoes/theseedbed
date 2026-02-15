from __future__ import annotations

import datetime as dt
import re
import uuid

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId, SourceRecord
from app.db.models.users import LibraryItem
from app.services.covers import cache_cover_to_storage, cache_edition_cover_from_url
from app.services.google_books import GoogleBooksClient
from app.services.open_library import OpenLibraryClient

_WORD_RE = re.compile(r"[a-z0-9]+")


def _normalize_match_text(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(_WORD_RE.findall(value.lower()))


def _author_search_variants(author: str | None) -> list[str]:
    normalized = _normalize_match_text(author)
    if not normalized:
        return []
    tokens = normalized.split()
    variants: list[str] = []
    raw = author.strip() if isinstance(author, str) else ""
    if raw:
        variants.append(raw)
    variants.append(" ".join(tokens))
    if len(tokens) >= 2:
        last_name = tokens[-1]
        given_tokens = tokens[:-1]
        initials: list[str] = []
        for token in given_tokens:
            if token.isalpha() and len(token) <= 3:
                initials.extend(list(token))
            else:
                initials.append(token[0])
        if initials:
            variants.append(f"{' '.join(initials)} {last_name}")
            variants.append(f"{''.join(initials)} {last_name}")
        if given_tokens and len(given_tokens[0]) > 1:
            variants.append(f"{given_tokens[0]} {last_name}")
        variants.append(last_name)

    deduped: list[str] = []
    seen: set[str] = set()
    for value in variants:
        candidate = value.strip()
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _normalized_isbn_candidates(session: Session, *, work_id: uuid.UUID) -> list[str]:
    values: list[str] = []
    rows = session.execute(
        sa.select(Edition.isbn13, Edition.isbn10)
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(8)
    ).all()
    for isbn13, isbn10 in rows:
        if isinstance(isbn13, str) and isbn13.strip():
            values.append(isbn13.strip())
        if isinstance(isbn10, str) and isbn10.strip():
            values.append(isbn10.strip())
    seen: set[str] = set()
    result: list[str] = []
    for raw in values:
        normalized = raw.replace("-", "").replace(" ", "")
        if len(normalized) not in {10, 13}:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


async def _search_openlibrary_cover_candidates(
    session: Session,
    *,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
) -> list[dict[str, object]]:
    work = session.get(Work, work_id)
    if work is None:
        return []

    title_query = work.title.strip()
    author_query = _first_author_name(session, work_id=work_id)
    search_queries = [
        f"isbn:{isbn}" for isbn in _normalized_isbn_candidates(session, work_id=work_id)
    ]
    if title_query:
        search_queries.append(title_query)

    seen_queries: set[str] = set()
    seen_urls: set[str] = set()
    items: list[dict[str, object]] = []
    for query in search_queries:
        normalized_query = query.strip()
        if not normalized_query or normalized_query in seen_queries:
            continue
        seen_queries.add(normalized_query)
        author_queries = (
            [""]
            if normalized_query.startswith("isbn:")
            else [*_author_search_variants(author_query), ""]
        )
        seen_author_queries: set[str] = set()
        for author_candidate in author_queries:
            normalized_author_candidate = author_candidate.strip().lower()
            if normalized_author_candidate in seen_author_queries:
                continue
            seen_author_queries.add(normalized_author_candidate)
            response = await open_library.search_books(
                query=normalized_query,
                limit=8,
                page=1,
                author=author_candidate or None,
                sort="relevance",
            )
            for candidate in response.items:
                if not candidate.cover_url:
                    continue
                if candidate.cover_url in seen_urls:
                    continue
                seen_urls.add(candidate.cover_url)
                items.append(
                    {
                        "source": "openlibrary",
                        "source_id": candidate.work_key,
                        "thumbnail_url": candidate.cover_url,
                        "image_url": candidate.cover_url,
                        "source_url": candidate.cover_url,
                    }
                )
                if len(items) >= 16:
                    return items
    return items


def _work_has_global_cover(session: Session, *, work_id: uuid.UUID) -> bool:
    work = session.get(Work, work_id)
    if work is not None and work.default_cover_url:
        return True
    any_edition_cover = session.scalar(
        sa.select(Edition.id)
        .where(Edition.work_id == work_id, Edition.cover_url.is_not(None))
        .limit(1)
    )
    return any_edition_cover is not None


async def list_openlibrary_cover_candidates(
    session: Session,
    *,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
) -> list[dict[str, object]]:
    provider_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if provider_id is None:
        return await _search_openlibrary_cover_candidates(
            session, work_id=work_id, open_library=open_library
        )

    cover_ids: list[int] = []
    source = session.scalar(
        sa.select(SourceRecord).where(
            SourceRecord.provider == "openlibrary",
            SourceRecord.entity_type == "work",
            SourceRecord.provider_id == provider_id,
        )
    )
    if source is not None and isinstance(source.raw, dict):
        covers = source.raw.get("covers")
        if isinstance(covers, list):
            for cover_id in covers:
                if isinstance(cover_id, int) and cover_id > 0:
                    cover_ids.append(cover_id)

    if not cover_ids:
        # Fall back to Open Library directly. Some works have covers only on editions.
        cover_ids = await open_library.fetch_cover_ids_for_work(
            work_key=provider_id, editions_limit=50
        )

    seen: set[int] = set()
    items: list[dict[str, object]] = []
    for cover_id in cover_ids:
        if cover_id in seen:
            continue
        seen.add(cover_id)
        items.append(
            {
                "source": "openlibrary",
                "source_id": str(cover_id),
                "cover_id": cover_id,
                "thumbnail_url": f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg",
                "image_url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
                "source_url": f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
            }
        )
    if items:
        return items
    return await _search_openlibrary_cover_candidates(
        session, work_id=work_id, open_library=open_library
    )


def _list_isbn_queries(session: Session, *, work_id: uuid.UUID) -> list[str]:
    rows = session.execute(
        sa.select(Edition.isbn13, Edition.isbn10)
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(8)
    ).all()
    values: list[str] = []
    for isbn13, isbn10 in rows:
        if isinstance(isbn13, str) and isbn13.strip():
            values.append(isbn13.strip().replace("-", ""))
        if isinstance(isbn10, str) and isbn10.strip():
            values.append(isbn10.strip().replace("-", ""))
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def _first_author_name(session: Session, *, work_id: uuid.UUID) -> str | None:
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
    author_name = row[0]
    if isinstance(author_name, str) and author_name.strip():
        return author_name.strip()
    return None


async def list_googlebooks_cover_candidates(
    session: Session,
    *,
    work_id: uuid.UUID,
    google_books: GoogleBooksClient,
) -> list[dict[str, object]]:
    work = session.get(Work, work_id)
    if work is None:
        return []

    items: list[dict[str, object]] = []
    seen_urls: set[str] = set()

    mapped_google_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "googlebooks",
        )
    )
    if isinstance(mapped_google_id, str) and mapped_google_id.strip():
        bundle = await google_books.fetch_work_bundle(
            volume_id=mapped_google_id.strip()
        )
        if bundle.cover_url:
            seen_urls.add(bundle.cover_url)
            items.append(
                {
                    "source": "googlebooks",
                    "source_id": bundle.volume_id,
                    "thumbnail_url": bundle.cover_url,
                    "image_url": bundle.cover_url,
                    "source_url": bundle.cover_url,
                    "attribution": {
                        "text": "Cover image from Google Books",
                        "url": bundle.attribution_url,
                    },
                }
            )

    title_query = work.title.strip()
    author_query = _first_author_name(session, work_id=work_id)
    search_queries = [
        f"isbn:{isbn}" for isbn in _list_isbn_queries(session, work_id=work_id)
    ]
    if title_query:
        search_queries.append(title_query)

    seen_queries: set[str] = set()
    for query in search_queries:
        normalized_query = query.strip()
        if not normalized_query or normalized_query in seen_queries:
            continue
        seen_queries.add(normalized_query)
        author_queries = (
            [""]
            if normalized_query.startswith("isbn:")
            else [*_author_search_variants(author_query), ""]
        )
        seen_author_queries: set[str] = set()
        for author_candidate in author_queries:
            normalized_author_candidate = author_candidate.strip().lower()
            if normalized_author_candidate in seen_author_queries:
                continue
            seen_author_queries.add(normalized_author_candidate)
            response = await google_books.search_books(
                query=normalized_query,
                limit=8,
                page=1,
                author=author_candidate or None,
                sort="relevance",
            )
            for candidate in response.items:
                if not candidate.cover_url:
                    continue
                if candidate.cover_url in seen_urls:
                    continue
                seen_urls.add(candidate.cover_url)
                items.append(
                    {
                        "source": "googlebooks",
                        "source_id": candidate.volume_id,
                        "thumbnail_url": candidate.cover_url,
                        "image_url": candidate.cover_url,
                        "source_url": candidate.cover_url,
                        "attribution": {
                            "text": "Cover image from Google Books",
                            "url": candidate.attribution_url,
                        },
                    }
                )
                if len(items) >= 16:
                    return items
    return items


async def select_cover_from_url(
    session: Session,
    *,
    settings: Settings,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    source_url: str,
) -> dict[str, object]:
    normalized_url = source_url.strip()
    if not normalized_url:
        raise ValueError("source_url is required")

    item = session.scalar(
        sa.select(LibraryItem).where(
            LibraryItem.user_id == user_id,
            LibraryItem.work_id == work_id,
        )
    )
    if item is None:
        raise PermissionError("book must be in your library to set a cover")

    now = dt.datetime.now(tz=dt.UTC)
    if not _work_has_global_cover(session, work_id=work_id):
        edition_id = item.preferred_edition_id
        if edition_id is None:
            edition_id = session.scalar(
                sa.select(Edition.id)
                .where(Edition.work_id == work_id)
                .order_by(Edition.created_at.desc(), Edition.id.desc())
                .limit(1)
            )
        if edition_id is not None:
            result = await cache_edition_cover_from_url(
                session,
                settings=settings,
                edition_id=edition_id,
                source_url=normalized_url,
                user_id=user_id,
            )
            return {"scope": "global", "cover_url": result.cover_url}

        upload = await cache_cover_to_storage(
            settings=settings, source_url=normalized_url
        )
        work = session.get(Work, work_id)
        if work is None:
            raise LookupError("work not found")
        work.default_cover_url = upload.public_url
        work.default_cover_storage_path = upload.path
        work.default_cover_set_by = user_id
        work.default_cover_set_at = now
        session.commit()
        return {"scope": "global", "cover_url": upload.public_url}

    upload = await cache_cover_to_storage(settings=settings, source_url=normalized_url)
    item.cover_override_url = upload.public_url
    item.cover_override_storage_path = upload.path or None
    item.cover_override_set_by = user_id
    item.cover_override_set_at = now
    session.commit()
    return {"scope": "override", "cover_url": upload.public_url}


async def select_openlibrary_cover(
    session: Session,
    *,
    settings: Settings,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    cover_id: int,
) -> dict[str, object]:
    return await select_cover_from_url(
        session,
        settings=settings,
        user_id=user_id,
        work_id=work_id,
        source_url=f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg",
    )
