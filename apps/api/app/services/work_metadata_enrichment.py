from __future__ import annotations

import datetime as dt
import re
import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Literal

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId, SourceRecord
from app.db.models.users import LibraryItem
from app.services.google_books import GoogleBooksClient, GoogleBooksWorkBundle
from app.services.open_library import OpenLibraryClient, OpenLibraryWorkBundle

Provider = Literal["openlibrary", "googlebooks"]
FieldScope = Literal["work", "edition"]


@dataclass(frozen=True)
class FieldDefinition:
    key: str
    scope: FieldScope


FIELD_DEFINITIONS: dict[str, FieldDefinition] = {
    "work.description": FieldDefinition("work.description", "work"),
    "work.cover_url": FieldDefinition("work.cover_url", "work"),
    "work.first_publish_year": FieldDefinition("work.first_publish_year", "work"),
    "edition.publisher": FieldDefinition("edition.publisher", "edition"),
    "edition.publish_date": FieldDefinition("edition.publish_date", "edition"),
    "edition.isbn10": FieldDefinition("edition.isbn10", "edition"),
    "edition.isbn13": FieldDefinition("edition.isbn13", "edition"),
    "edition.language": FieldDefinition("edition.language", "edition"),
    "edition.format": FieldDefinition("edition.format", "edition"),
}

_WORD_RE = re.compile(r"[a-z0-9]+")


def _get_work(session: Session, *, work_id: uuid.UUID) -> Work:
    work = session.get(Work, work_id)
    if work is None:
        raise LookupError("work not found")
    return work


def _get_openlibrary_work_key(session: Session, *, work_id: uuid.UUID) -> str | None:
    return session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )


def _get_google_work_volume_id(session: Session, *, work_id: uuid.UUID) -> str | None:
    return session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "googlebooks",
        )
    )


def _list_isbn_queries(
    session: Session,
    *,
    work_id: uuid.UUID,
    edition_target: Edition | None,
) -> list[str]:
    values: list[str] = []
    if edition_target is not None:
        if isinstance(edition_target.isbn13, str) and edition_target.isbn13.strip():
            values.append(edition_target.isbn13.strip())
        if isinstance(edition_target.isbn10, str) and edition_target.isbn10.strip():
            values.append(edition_target.isbn10.strip())

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

    result: list[str] = []
    seen: set[str] = set()
    for raw in values:
        normalized = raw.replace("-", "").replace(" ", "")
        if len(normalized) not in {10, 13}:
            continue
        if normalized in seen:
            continue
        seen.add(normalized)
        result.append(normalized)
    return result


def _first_author_name(session: Session, *, work_id: uuid.UUID) -> str | None:
    return session.scalar(
        sa.select(Author.name)
        .join(WorkAuthor, WorkAuthor.author_id == Author.id)
        .where(WorkAuthor.work_id == work_id)
        .order_by(Author.name.asc())
        .limit(1)
    )


def _resolve_target_edition(
    session: Session,
    *,
    work_id: uuid.UUID,
    user_id: uuid.UUID,
    edition_id: uuid.UUID | None,
) -> Edition | None:
    if edition_id is not None:
        edition = session.scalar(
            sa.select(Edition).where(
                Edition.id == edition_id, Edition.work_id == work_id
            )
        )
        if edition is None:
            raise LookupError("edition not found for work")
        return edition

    preferred = session.scalar(
        sa.select(LibraryItem.preferred_edition_id)
        .where(LibraryItem.user_id == user_id, LibraryItem.work_id == work_id)
        .limit(1)
    )
    if isinstance(preferred, uuid.UUID):
        preferred_edition = session.scalar(
            sa.select(Edition).where(
                Edition.id == preferred, Edition.work_id == work_id
            )
        )
        if preferred_edition is not None:
            return preferred_edition

    return session.scalar(
        sa.select(Edition)
        .where(Edition.work_id == work_id)
        .order_by(Edition.created_at.desc(), Edition.id.desc())
        .limit(1)
    )


def _edition_label(session: Session, *, edition: Edition) -> str:
    provider_id = session.scalar(
        sa.select(ExternalId.provider_id).where(
            ExternalId.entity_type == "edition",
            ExternalId.entity_id == edition.id,
            ExternalId.provider == "openlibrary",
        )
    )
    provider_label = None
    if isinstance(provider_id, str):
        provider_label = provider_id.removeprefix("/books/")
    isbn = edition.isbn13 or edition.isbn10
    parts = [
        edition.publisher or None,
        edition.publish_date.isoformat() if edition.publish_date else None,
        f"ISBN {isbn}" if isbn else None,
        f"Open Library {provider_label}" if provider_label else None,
    ]
    meta = " | ".join([part for part in parts if part])
    return meta or "Edition"


def _normalize_isbn(value: Any, *, length: int) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().replace("-", "")
    if len(normalized) != length or not normalized.isdigit():
        return None
    return normalized


def _normalize_year(value: Any) -> int | None:
    if isinstance(value, int) and 0 < value < 10000:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        parsed = int(value.strip())
        return parsed if 0 < parsed < 10000 else None
    return None


def _normalize_publish_date(value: Any) -> dt.date | None:
    if isinstance(value, dt.date):
        return value
    if isinstance(value, str):
        candidate = value.strip()
        try:
            return dt.date.fromisoformat(candidate)
        except ValueError:
            return None
    return None


def _display_value(field_key: str, value: Any) -> str:
    if value is None:
        return ""
    if field_key == "edition.publish_date" and isinstance(value, dt.date):
        return value.isoformat()
    return str(value)


def _value_signature(field_key: str, value: Any) -> str:
    if value is None:
        return "null"
    if field_key == "edition.publish_date":
        date_value = _normalize_publish_date(value)
        if date_value is not None:
            return date_value.isoformat()
    return str(value).strip()


def _source_label(provider: Provider, provider_id: str) -> str:
    if provider == "openlibrary":
        return f"Open Library {provider_id.removeprefix('/works/').removeprefix('/books/')}"
    return f"Google Books {provider_id}"


def _normalize_match_text(value: str | None) -> str:
    if not isinstance(value, str):
        return ""
    tokens = _WORD_RE.findall(value.lower())
    return " ".join(tokens)


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


def _author_name_parts(value: str | None) -> tuple[str, set[str], set[str]]:
    normalized = _normalize_match_text(value)
    if not normalized:
        return ("", set(), set())
    tokens = normalized.split()
    if not tokens:
        return ("", set(), set())
    last_name = tokens[-1]
    given_tokens = [token for token in tokens[:-1] if token]
    initials: set[str] = set()
    for token in given_tokens:
        if token.isalpha() and len(token) <= 3:
            initials.update(token)
        else:
            initials.add(token[0])
    given_set = set(given_tokens)
    return (last_name, initials, given_set)


def _title_match_score(work_title: str, candidate_title: str) -> int:
    expected = _normalize_match_text(work_title)
    actual = _normalize_match_text(candidate_title)
    if not expected or not actual:
        return 0
    if expected == actual:
        return 4
    if expected in actual or actual in expected:
        return 3
    expected_tokens = set(expected.split())
    actual_tokens = set(actual.split())
    if not expected_tokens or not actual_tokens:
        return 0
    overlap = len(expected_tokens & actual_tokens)
    coverage = overlap / max(len(expected_tokens), len(actual_tokens))
    if coverage >= 0.8:
        return 3
    if coverage >= 0.6:
        return 2
    return 0


def _author_match_score(
    *,
    expected_author: str | None,
    candidate_authors: list[str],
) -> int:
    expected = _normalize_match_text(expected_author)
    if not expected:
        return 1
    if not candidate_authors:
        return 0
    expected_last, expected_initials, expected_given = _author_name_parts(
        expected_author
    )
    for candidate in candidate_authors:
        normalized = _normalize_match_text(candidate)
        if not normalized:
            continue
        if normalized == expected:
            return 3
        if normalized in expected or expected in normalized:
            return 2
        expected_tokens = set(expected.split())
        candidate_tokens = set(normalized.split())
        if not expected_tokens or not candidate_tokens:
            continue
        overlap = len(expected_tokens & candidate_tokens)
        coverage = overlap / len(expected_tokens)
        if coverage >= 0.7:
            return 2
        candidate_last, candidate_initials, candidate_given = _author_name_parts(
            candidate
        )
        if expected_last and candidate_last and expected_last == candidate_last:
            if (
                expected_initials
                and candidate_initials
                and (expected_initials & candidate_initials)
            ):
                return 2
            if (
                expected_given
                and candidate_given
                and (expected_given & candidate_given)
            ):
                return 2
    return 0


def _isbn_match_score(
    *,
    target_edition: Edition | None,
    candidate_edition: dict[str, Any] | None,
) -> int:
    if target_edition is None or not candidate_edition:
        return 0
    target_isbn10 = _normalize_isbn(target_edition.isbn10, length=10)
    target_isbn13 = _normalize_isbn(target_edition.isbn13, length=13)
    candidate_isbn10 = _normalize_isbn(candidate_edition.get("isbn10"), length=10)
    candidate_isbn13 = _normalize_isbn(candidate_edition.get("isbn13"), length=13)
    if target_isbn13 and candidate_isbn13 and target_isbn13 == candidate_isbn13:
        return 5
    if target_isbn10 and candidate_isbn10 and target_isbn10 == candidate_isbn10:
        return 4
    return 0


def _is_relevant_google_bundle(
    *,
    work: Work,
    first_author: str | None,
    edition_target: Edition | None,
    bundle: GoogleBooksWorkBundle,
) -> bool:
    isbn_score = _isbn_match_score(
        target_edition=edition_target,
        candidate_edition=bundle.edition,
    )
    if isbn_score >= 4:
        return True

    title_score = _title_match_score(work.title, bundle.title)
    author_score = _author_match_score(
        expected_author=first_author,
        candidate_authors=bundle.authors,
    )
    return title_score >= 3 and (author_score >= 2 or not first_author)


def _google_bundle_rank(
    *,
    work: Work,
    first_author: str | None,
    edition_target: Edition | None,
    bundle: GoogleBooksWorkBundle,
) -> tuple[int, int, int]:
    isbn_score = _isbn_match_score(
        target_edition=edition_target,
        candidate_edition=bundle.edition,
    )
    title_score = _title_match_score(work.title, bundle.title)
    author_score = _author_match_score(
        expected_author=first_author,
        candidate_authors=bundle.authors,
    )
    return (isbn_score, title_score, author_score)


def _best_google_bundle(
    *,
    work: Work,
    first_author: str | None,
    edition_target: Edition | None,
    bundles: list[GoogleBooksWorkBundle],
) -> GoogleBooksWorkBundle | None:
    ranked: list[tuple[tuple[int, int, int], GoogleBooksWorkBundle]] = []
    for bundle in bundles:
        rank = _google_bundle_rank(
            work=work,
            first_author=first_author,
            edition_target=edition_target,
            bundle=bundle,
        )
        isbn_score, title_score, author_score = rank
        if isbn_score >= 4 or (
            title_score >= 3 and (author_score >= 2 or not first_author)
        ):
            ranked.append((rank, bundle))
    if not ranked:
        return None
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return ranked[0][1]


def _google_bundle_richness(bundle: GoogleBooksWorkBundle) -> int:
    edition = bundle.edition or {}
    score = 0
    if bundle.description:
        score += 1
    if bundle.cover_url:
        score += 1
    if bundle.first_publish_year is not None:
        score += 1
    if edition.get("publisher"):
        score += 1
    if edition.get("publish_date_iso"):
        score += 1
    if edition.get("isbn10"):
        score += 1
    if edition.get("isbn13"):
        score += 1
    if edition.get("language"):
        score += 1
    if edition.get("format"):
        score += 1
    return score


def _best_google_bundles(
    *,
    work: Work,
    first_author: str | None,
    edition_target: Edition | None,
    bundles: list[GoogleBooksWorkBundle],
    limit: int = 3,
) -> list[GoogleBooksWorkBundle]:
    if not bundles:
        return []

    selected: list[GoogleBooksWorkBundle] = []
    strict_best = _best_google_bundle(
        work=work,
        first_author=first_author,
        edition_target=edition_target,
        bundles=bundles,
    )
    seen_volume_ids: set[str] = set()
    if strict_best is not None:
        selected.append(strict_best)
        seen_volume_ids.add(strict_best.volume_id)

    expected_title = _normalize_match_text(work.title)
    expected_tokens = expected_title.split()

    ranked_title_fallback: list[
        tuple[tuple[int, int, int, int], GoogleBooksWorkBundle]
    ] = []
    for bundle in bundles:
        if bundle.volume_id in seen_volume_ids:
            continue
        isbn_score, title_score, author_score = _google_bundle_rank(
            work=work,
            first_author=first_author,
            edition_target=edition_target,
            bundle=bundle,
        )
        if title_score < 3:
            continue
        actual_title = _normalize_match_text(bundle.title)
        actual_tokens = actual_title.split()
        if len(expected_tokens) == 1 and len(actual_tokens) > 1:
            if not actual_tokens or actual_tokens[0] != expected_tokens[0]:
                continue
        ranked_title_fallback.append(
            (
                (
                    title_score,
                    author_score,
                    isbn_score,
                    _google_bundle_richness(bundle),
                ),
                bundle,
            )
        )

    ranked_title_fallback.sort(key=lambda entry: entry[0], reverse=True)
    for _rank, bundle in ranked_title_fallback:
        if len(selected) >= limit:
            break
        selected.append(bundle)
    return selected


def _google_source_label(bundle: GoogleBooksWorkBundle) -> str:
    title = bundle.title.strip() if isinstance(bundle.title, str) else ""
    if title:
        return f"Google Books {title} ({bundle.volume_id})"
    return _source_label("googlebooks", bundle.volume_id)


def _upsert_source_record(
    session: Session,
    *,
    provider: Provider,
    entity_type: Literal["work", "edition"],
    provider_id: str,
    raw: dict[str, Any],
) -> None:
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


def _ensure_google_external_ids(
    session: Session,
    *,
    work_id: uuid.UUID,
    edition_id: uuid.UUID | None,
    volume_id: str,
) -> None:
    work_link = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "googlebooks",
        )
    )
    if work_link is None:
        existing_provider_id = session.scalar(
            sa.select(ExternalId).where(
                ExternalId.entity_type == "work",
                ExternalId.provider == "googlebooks",
                ExternalId.provider_id == volume_id,
            )
        )
        if existing_provider_id is None:
            session.add(
                ExternalId(
                    entity_type="work",
                    entity_id=work_id,
                    provider="googlebooks",
                    provider_id=volume_id,
                )
            )

    if edition_id is None:
        return

    edition_link = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "edition",
            ExternalId.entity_id == edition_id,
            ExternalId.provider == "googlebooks",
        )
    )
    if edition_link is None:
        existing_provider_id = session.scalar(
            sa.select(ExternalId).where(
                ExternalId.entity_type == "edition",
                ExternalId.provider == "googlebooks",
                ExternalId.provider_id == volume_id,
            )
        )
        if existing_provider_id is None:
            session.add(
                ExternalId(
                    entity_type="edition",
                    entity_id=edition_id,
                    provider="googlebooks",
                    provider_id=volume_id,
                )
            )


def _ensure_openlibrary_external_ids(
    session: Session,
    *,
    work_id: uuid.UUID,
    edition_id: uuid.UUID | None,
    work_key: str,
    edition_key: str | None,
) -> None:
    work_link = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "work",
            ExternalId.entity_id == work_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if work_link is None:
        existing_provider_id = session.scalar(
            sa.select(ExternalId).where(
                ExternalId.entity_type == "work",
                ExternalId.provider == "openlibrary",
                ExternalId.provider_id == work_key,
            )
        )
        if existing_provider_id is None:
            session.add(
                ExternalId(
                    entity_type="work",
                    entity_id=work_id,
                    provider="openlibrary",
                    provider_id=work_key,
                )
            )

    if edition_id is None or not edition_key:
        return

    edition_link = session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == "edition",
            ExternalId.entity_id == edition_id,
            ExternalId.provider == "openlibrary",
        )
    )
    if edition_link is None:
        existing_provider_id = session.scalar(
            sa.select(ExternalId).where(
                ExternalId.entity_type == "edition",
                ExternalId.provider == "openlibrary",
                ExternalId.provider_id == edition_key,
            )
        )
        if existing_provider_id is None:
            session.add(
                ExternalId(
                    entity_type="edition",
                    entity_id=edition_id,
                    provider="openlibrary",
                    provider_id=edition_key,
                )
            )


async def _resolve_openlibrary_work_key(
    *,
    session: Session,
    work: Work,
    work_id: uuid.UUID,
    edition_target: Edition | None,
    first_author: str | None,
    open_library: OpenLibraryClient,
) -> str | None:
    existing = _get_openlibrary_work_key(session, work_id=work_id)
    if existing:
        return existing

    for isbn in _list_isbn_queries(
        session, work_id=work_id, edition_target=edition_target
    ):
        work_key = await open_library.find_work_key_by_isbn(isbn=isbn)
        if work_key:
            return work_key

    if not work.title.strip():
        return None
    ranked: list[tuple[tuple[int, int], str]] = []
    author_queries = _author_search_variants(first_author)
    author_queries.append("")
    seen_queries: set[str] = set()
    for author_query in author_queries:
        normalized_author_query = author_query.strip().lower()
        if normalized_author_query in seen_queries:
            continue
        seen_queries.add(normalized_author_query)
        search = await open_library.search_books(
            query=work.title,
            author=author_query or None,
            limit=5,
            sort="relevance",
        )
        for item in search.items:
            title_score = _title_match_score(work.title, item.title)
            author_score = _author_match_score(
                expected_author=first_author,
                candidate_authors=item.author_names,
            )
            if title_score >= 3 and (author_score >= 2 or not first_author):
                ranked.append(((title_score, author_score), item.work_key))
    if not ranked:
        return None
    ranked.sort(key=lambda entry: entry[0], reverse=True)
    return ranked[0][1]


def _bundle_values_openlibrary(bundle: OpenLibraryWorkBundle) -> dict[str, Any]:
    edition = bundle.edition or {}
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
    }


def _bundle_values_google(bundle: GoogleBooksWorkBundle) -> dict[str, Any]:
    edition = bundle.edition or {}
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
    }


def _current_field_values(work: Work, edition: Edition | None) -> dict[str, Any]:
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
    }


def _build_fields_payload(
    *,
    current: dict[str, Any],
    candidates_by_field: dict[str, list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for field_key, definition in FIELD_DEFINITIONS.items():
        candidates = candidates_by_field.get(field_key, [])
        values = {
            _value_signature(field_key, candidate.get("value"))
            for candidate in candidates
            if candidate.get("value") is not None
        }
        fields.append(
            {
                "field_key": field_key,
                "scope": definition.scope,
                "current_value": current.get(field_key),
                "candidates": candidates,
                "has_conflict": len(values) > 1,
            }
        )
    return fields


def _add_candidate(
    *,
    field_key: str,
    provider: Provider,
    provider_id: str,
    value: Any,
    candidates_by_field: dict[str, list[dict[str, Any]]],
    seen: set[tuple[str, Provider, str, str]],
    source_label: str | None = None,
) -> None:
    if field_key not in FIELD_DEFINITIONS:
        return
    if value is None:
        return
    signature = _value_signature(field_key, value)
    key = (field_key, provider, provider_id, signature)
    if key in seen:
        return
    seen.add(key)
    candidates_by_field[field_key].append(
        {
            "provider": provider,
            "provider_id": provider_id,
            "value": value,
            "display_value": _display_value(field_key, value),
            "source_label": source_label or _source_label(provider, provider_id),
        }
    )


async def get_enrichment_candidates(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
    google_enabled: bool,
) -> dict[str, Any]:
    work = _get_work(session, work_id=work_id)
    edition_target = _resolve_target_edition(
        session, work_id=work_id, user_id=user_id, edition_id=None
    )

    current = _current_field_values(work, edition_target)
    candidates_by_field: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen: set[tuple[str, Provider, str, str]] = set()
    provider_status: dict[str, Any] = {
        "attempted": ["openlibrary"],
        "succeeded": [],
        "failed": [],
    }
    first_author = _first_author_name(session, work_id=work_id)
    try:
        work_key = await _resolve_openlibrary_work_key(
            session=session,
            work=work,
            work_id=work_id,
            edition_target=edition_target,
            first_author=first_author,
            open_library=open_library,
        )
        if work_key is not None:
            openlibrary_bundle = await open_library.fetch_work_bundle(work_key=work_key)
            provider_status["succeeded"].append("openlibrary")
            _upsert_source_record(
                session,
                provider="openlibrary",
                entity_type="work",
                provider_id=openlibrary_bundle.work_key,
                raw=openlibrary_bundle.raw_work,
            )
            if openlibrary_bundle.edition and openlibrary_bundle.raw_edition:
                edition_provider_id = str(openlibrary_bundle.edition.get("key") or "")
                if edition_provider_id:
                    _upsert_source_record(
                        session,
                        provider="openlibrary",
                        entity_type="edition",
                        provider_id=edition_provider_id,
                        raw=openlibrary_bundle.raw_edition,
                    )

            for field_key, value in _bundle_values_openlibrary(
                openlibrary_bundle
            ).items():
                provider_id = work_key
                if field_key.startswith("edition.") and openlibrary_bundle.edition:
                    provider_id = str(openlibrary_bundle.edition.get("key") or work_key)
                _add_candidate(
                    field_key=field_key,
                    provider="openlibrary",
                    provider_id=provider_id,
                    value=value,
                    candidates_by_field=candidates_by_field,
                    seen=seen,
                )
        else:
            provider_status["failed"].append(
                {
                    "provider": "openlibrary",
                    "code": "openlibrary_match_not_found",
                    "message": "No Open Library match found for this work.",
                }
            )
    except Exception as exc:
        provider_status["failed"].append(
            {
                "provider": "openlibrary",
                "code": "open_library_unavailable",
                "message": str(exc),
            }
        )

    if google_enabled:
        provider_status["attempted"].append("googlebooks")
        google_bundles: list[GoogleBooksWorkBundle] = []
        google_id = _get_google_work_volume_id(session, work_id=work_id)
        try:
            fetched_by_volume: dict[str, GoogleBooksWorkBundle] = {}
            if google_id:
                try:
                    mapped_bundle = await google_books.fetch_work_bundle(
                        volume_id=google_id
                    )
                except Exception:
                    mapped_bundle = None
                if mapped_bundle is not None:
                    fetched_by_volume[mapped_bundle.volume_id] = mapped_bundle

            author_queries = _author_search_variants(first_author)
            author_queries.append("")
            seen_author_queries: set[str] = set()
            for author_query in author_queries:
                normalized_author_query = author_query.strip().lower()
                if normalized_author_query in seen_author_queries:
                    continue
                seen_author_queries.add(normalized_author_query)
                search = await google_books.search_books(
                    query=work.title,
                    author=author_query or None,
                    limit=5,
                    page=1,
                )
                for item in search.items[:5]:
                    if item.volume_id in fetched_by_volume:
                        continue
                    try:
                        candidate_bundle = await google_books.fetch_work_bundle(
                            volume_id=item.volume_id
                        )
                    except Exception:
                        continue
                    fetched_by_volume[item.volume_id] = candidate_bundle
                if len(fetched_by_volume) >= 8:
                    break
            fetched_bundles = list(fetched_by_volume.values())
            google_bundles = _best_google_bundles(
                work=work,
                first_author=first_author,
                edition_target=edition_target,
                bundles=fetched_bundles,
            )

            for google_bundle in google_bundles:
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
                for field_key, value in _bundle_values_google(google_bundle).items():
                    _add_candidate(
                        field_key=field_key,
                        provider="googlebooks",
                        provider_id=google_bundle.volume_id,
                        value=value,
                        candidates_by_field=candidates_by_field,
                        seen=seen,
                        source_label=_google_source_label(google_bundle),
                    )

            provider_status["succeeded"].append("googlebooks")
        except Exception as exc:
            provider_status["failed"].append(
                {
                    "provider": "googlebooks",
                    "code": "google_books_unavailable",
                    "message": str(exc),
                }
            )

    session.commit()
    return {
        "work_id": str(work.id),
        "edition_target": (
            {
                "id": str(edition_target.id),
                "label": _edition_label(session, edition=edition_target),
            }
            if edition_target
            else None
        ),
        "providers": provider_status,
        "fields": _build_fields_payload(
            current=current, candidates_by_field=candidates_by_field
        ),
    }


def _normalize_selection_value(field_key: str, value: Any) -> Any:
    if field_key == "work.first_publish_year":
        return _normalize_year(value)
    if field_key == "edition.publish_date":
        return _normalize_publish_date(value)
    if field_key == "edition.isbn10":
        return _normalize_isbn(value, length=10)
    if field_key == "edition.isbn13":
        return _normalize_isbn(value, length=13)
    if field_key in {
        "work.description",
        "work.cover_url",
        "edition.publisher",
        "edition.language",
        "edition.format",
    }:
        if not isinstance(value, str):
            return None
        normalized = value.strip()
        return normalized or None
    return None


async def apply_enrichment_selections(
    session: Session,
    *,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    selections: list[dict[str, Any]],
    edition_id: uuid.UUID | None,
    open_library: OpenLibraryClient,
    google_books: GoogleBooksClient,
    google_enabled: bool,
) -> dict[str, Any]:
    work = _get_work(session, work_id=work_id)
    edition_target = _resolve_target_edition(
        session,
        work_id=work_id,
        user_id=user_id,
        edition_id=edition_id,
    )

    if any(not isinstance(item, dict) for item in selections):
        raise ValueError("selections must be a list of objects")

    updated: list[str] = []
    skipped: list[dict[str, str]] = []
    work_key = _get_openlibrary_work_key(session, work_id=work_id)
    selected_sources = {
        (str(item.get("provider")), str(item.get("provider_id")))
        for item in selections
        if isinstance(item.get("provider"), str)
        and isinstance(item.get("provider_id"), str)
    }

    for selection in selections:
        field_key = selection.get("field_key")
        provider = selection.get("provider")
        provider_id = selection.get("provider_id")
        raw_value = selection.get("value")
        if not isinstance(field_key, str) or field_key not in FIELD_DEFINITIONS:
            raise ValueError("invalid field_key in selections")
        if provider not in {"openlibrary", "googlebooks"}:
            raise ValueError("invalid provider in selections")
        if not isinstance(provider_id, str) or not provider_id.strip():
            raise ValueError("provider_id is required")

        definition = FIELD_DEFINITIONS[field_key]
        if definition.scope == "edition" and edition_target is None:
            skipped.append({"field_key": field_key, "reason": "target_missing"})
            continue

        normalized = _normalize_selection_value(field_key, raw_value)
        if normalized is None:
            skipped.append({"field_key": field_key, "reason": "invalid_value"})
            continue

        if field_key == "work.description":
            work.description = normalized
        elif field_key == "work.cover_url":
            work.default_cover_url = normalized
        elif field_key == "work.first_publish_year":
            work.first_publish_year = normalized
        elif field_key == "edition.publisher" and edition_target is not None:
            edition_target.publisher = normalized
        elif field_key == "edition.publish_date" and edition_target is not None:
            edition_target.publish_date = normalized
        elif field_key == "edition.isbn10" and edition_target is not None:
            edition_target.isbn10 = normalized
        elif field_key == "edition.isbn13" and edition_target is not None:
            edition_target.isbn13 = normalized
        elif field_key == "edition.language" and edition_target is not None:
            edition_target.language = normalized
        elif field_key == "edition.format" and edition_target is not None:
            edition_target.format = normalized
        updated.append(field_key)

    for provider, provider_id in selected_sources:
        if provider == "openlibrary":
            selected_work_key = (
                provider_id if provider_id.startswith("/works/") else work_key
            )
            if not selected_work_key:
                continue
            openlibrary_bundle = await open_library.fetch_work_bundle(
                work_key=selected_work_key,
                edition_key=(
                    provider_id if provider_id.startswith("/books/") else None
                ),
            )
            _upsert_source_record(
                session,
                provider="openlibrary",
                entity_type="work",
                provider_id=openlibrary_bundle.work_key,
                raw=openlibrary_bundle.raw_work,
            )
            _ensure_openlibrary_external_ids(
                session,
                work_id=work_id,
                edition_id=edition_target.id if edition_target else None,
                work_key=openlibrary_bundle.work_key,
                edition_key=(
                    str(openlibrary_bundle.edition.get("key") or "")
                    if openlibrary_bundle.edition
                    else None
                ),
            )
            if openlibrary_bundle.edition and openlibrary_bundle.raw_edition:
                edition_provider_id = str(openlibrary_bundle.edition.get("key") or "")
                if edition_provider_id:
                    _upsert_source_record(
                        session,
                        provider="openlibrary",
                        entity_type="edition",
                        provider_id=edition_provider_id,
                        raw=openlibrary_bundle.raw_edition,
                    )
        elif provider == "googlebooks":
            if not google_enabled:
                continue
            bundle = await google_books.fetch_work_bundle(volume_id=provider_id)
            _upsert_source_record(
                session,
                provider="googlebooks",
                entity_type="work",
                provider_id=bundle.volume_id,
                raw=bundle.raw_volume,
            )
            _upsert_source_record(
                session,
                provider="googlebooks",
                entity_type="edition",
                provider_id=bundle.volume_id,
                raw=bundle.raw_volume,
            )
            _ensure_google_external_ids(
                session,
                work_id=work_id,
                edition_id=edition_target.id if edition_target else None,
                volume_id=bundle.volume_id,
            )

    session.commit()
    return {
        "updated": updated,
        "skipped": skipped,
        "edition_target": (
            {
                "id": str(edition_target.id),
                "label": _edition_label(session, edition=edition_target),
            }
            if edition_target
            else None
        ),
    }
