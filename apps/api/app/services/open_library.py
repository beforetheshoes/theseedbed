from __future__ import annotations

import asyncio
import datetime as dt
import os
import random
import re
import time
from dataclasses import dataclass
from typing import Any, Generic, Literal, TypeVar, cast

import httpx

from app.services.provider_budget import get_provider_budget_controller

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_YEAR_RE = re.compile(r"(\d{4})")
_OPENLIBRARY_CANONICAL_LANGUAGE_MAP: dict[str, str] = {
    "en": "eng",
    "eng": "eng",
    "es": "spa",
    "spa": "spa",
    "fr": "fra",
    "fra": "fra",
    "fre": "fra",
    "de": "deu",
    "deu": "deu",
    "ger": "deu",
    "it": "ita",
    "ita": "ita",
    "pt": "por",
    "por": "por",
    "ja": "jpn",
    "jpn": "jpn",
}
T = TypeVar("T")


@dataclass(frozen=True)
class OpenLibrarySearchResult:
    work_key: str
    title: str
    author_names: list[str]
    first_publish_year: int | None
    cover_url: str | None
    edition_count: int | None
    languages: list[str]
    readable: bool


@dataclass(frozen=True)
class OpenLibraryWorkBundle:
    work_key: str
    title: str
    description: str | None
    first_publish_year: int | None
    cover_url: str | None
    authors: list[dict[str, str]]
    edition: dict[str, Any] | None
    raw_work: dict[str, Any]
    raw_edition: dict[str, Any] | None


@dataclass(frozen=True)
class OpenLibraryEditionSummary:
    key: str
    title: str | None
    publisher: str | None
    publish_date: str | None
    language: str | None
    isbn10: str | None
    isbn13: str | None
    cover_url: str | None


@dataclass(frozen=True)
class OpenLibraryRelatedWork:
    work_key: str
    title: str
    cover_url: str | None
    first_publish_year: int | None
    author_names: list[str]


@dataclass(frozen=True)
class OpenLibraryAuthorWork:
    work_key: str
    title: str
    cover_url: str | None
    first_publish_year: int | None


@dataclass(frozen=True)
class OpenLibraryAuthorProfile:
    author_key: str
    name: str
    bio: str | None
    photo_url: str | None
    top_works: list[OpenLibraryAuthorWork]


@dataclass
class OpenLibrarySearchResponse:
    items: list[OpenLibrarySearchResult]
    query: str
    limit: int
    page: int
    num_found: int | None
    has_more: bool
    next_page: int | None
    cache_hit: bool


class _TTLCache(Generic[T]):
    def __init__(self, *, ttl_seconds: int, max_entries: int) -> None:
        self._ttl_seconds = max(ttl_seconds, 1)
        self._max_entries = max(max_entries, 1)
        self._items: dict[str, tuple[float, T]] = {}

    def get(self, key: str) -> T | None:
        cached = self._items.get(key)
        if cached is None:
            return None
        expires_at, value = cached
        if expires_at < time.time():
            self._items.pop(key, None)
            return None
        return value

    def set(self, key: str, value: T) -> None:
        if len(self._items) >= self._max_entries:
            oldest_key = min(self._items.items(), key=lambda item: item[1][0])[0]
            self._items.pop(oldest_key, None)
        self._items[key] = (time.time() + self._ttl_seconds, value)


def _normalize_work_key(work_key: str) -> str:
    value = work_key.strip()
    if value.startswith("/works/"):
        return value
    if value.startswith("OL"):
        return f"/works/{value}"
    raise ValueError("work_key must be an Open Library work key")


def _normalize_edition_key(edition_key: str) -> str:
    value = edition_key.strip()
    if value.startswith("/books/"):
        return value
    if value.startswith("OL"):
        return f"/books/{value}"
    raise ValueError("edition_key must be an Open Library edition key")


def _extract_description(payload: dict[str, Any]) -> str | None:
    description = payload.get("description")
    if isinstance(description, str):
        return description
    if isinstance(description, dict):
        value = description.get("value")
        if isinstance(value, str):
            return value
    return None


def _extract_language_codes(raw_languages: Any) -> list[str]:
    if not isinstance(raw_languages, list):
        return []
    result: list[str] = []
    for entry in raw_languages:
        if isinstance(entry, dict):
            key = entry.get("key")
            if isinstance(key, str) and key.startswith("/languages/"):
                result.append(key.removeprefix("/languages/"))
                continue
            code = entry.get("code")
            if isinstance(code, str):
                result.append(code)
                continue
        if isinstance(entry, str):
            result.append(entry)
    deduped: list[str] = []
    seen: set[str] = set()
    for code in result:
        normalized = code.strip().lower()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        deduped.append(normalized)
    return deduped


def _canonical_openlibrary_language(code: str | None) -> str | None:
    if not isinstance(code, str):
        return None
    normalized = code.strip().lower()
    if not normalized:
        return None
    return _OPENLIBRARY_CANONICAL_LANGUAGE_MAP.get(normalized, normalized)


def _first_list_string(values: Any) -> str | None:
    if not isinstance(values, list):
        return None
    return next((v for v in values if isinstance(v, str)), None)


def _parse_publish_year(raw: Any) -> int | None:
    if isinstance(raw, int):
        return raw if 0 < raw < 10000 else None
    if isinstance(raw, str):
        matched = _YEAR_RE.search(raw)
        if not matched:
            return None
        parsed = int(matched.group(1))
        return parsed if 0 < parsed < 10000 else None
    return None


def _parse_iso_publish_date(raw: Any) -> dt.date | None:
    if not isinstance(raw, str):
        return None
    candidate = raw.strip()
    if not _ISO_DATE_RE.match(candidate):
        return None
    try:
        return dt.date.fromisoformat(candidate)
    except ValueError:
        return None


def _parse_duration_minutes(raw: Any) -> int | float | None:
    if isinstance(raw, (int, float)):
        minutes = round(float(raw))
        return minutes if minutes > 0 else None
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    if not value:
        return None

    hhmmss_match = re.fullmatch(r"(?:(\d+):)?([0-5]?\d):([0-5]\d)", value)
    if hhmmss_match:
        hours = int(hhmmss_match.group(1) or "0")
        minutes = int(hhmmss_match.group(2))
        seconds = int(hhmmss_match.group(3))
        total_minutes = (hours * 60) + minutes + (1 if seconds >= 30 else 0)
        return total_minutes if total_minutes > 0 else None

    parts = value.split()
    if len(parts) >= 2:
        amount = _parse_numeric_token(parts[0])
        if amount is not None and amount > 0:
            unit = parts[1]
            if unit.startswith("hour") or unit in {"hr", "hrs", "h"}:
                return max(1, round(amount * 60))
            if unit.startswith("min") or unit in {"m", "mins"}:
                return max(1, round(amount))
            if unit.startswith("sec") or unit in {"s", "secs"}:
                return amount / 60.0

    numbers = [int(match) for match in re.findall(r"\d+", value)]
    if numbers:
        if "hour" in value or "hr" in value:
            return max(1, numbers[0] * 60)
        if "minute" in value or "min" in value:
            return max(1, numbers[0])
    return None


def _minutes_from_seconds(seconds: int) -> float | None:
    if seconds <= 0:
        return None
    return seconds / 60.0


def _parse_numeric_token(value: str) -> float | None:
    cleaned = value.strip().replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_duration_from_notes(raw_notes: Any) -> float | None:
    note_strings: list[str] = []
    if isinstance(raw_notes, str):
        note_strings.append(raw_notes)
    elif isinstance(raw_notes, dict):
        for key in ("value", "notes", "text"):
            value = raw_notes.get(key)
            if isinstance(value, str):
                note_strings.append(value)
    elif isinstance(raw_notes, list):
        for item in raw_notes:
            if isinstance(item, str):
                note_strings.append(item)
            elif isinstance(item, dict):
                for key in ("value", "notes", "text"):
                    value = item.get(key)
                    if isinstance(value, str):
                        note_strings.append(value)

    for text in note_strings:
        lowered = text.lower()
        match = re.search(r"duration\s+in\s+seconds\s*[:=]\s*([\d,]+)", lowered)
        if match:
            parsed_seconds = _parse_numeric_token(match.group(1))
            if parsed_seconds is not None:
                return _minutes_from_seconds(int(parsed_seconds))
        compact = re.search(r"\b([\d,]+)\s*seconds\b", lowered)
        if compact:
            parsed_seconds = _parse_numeric_token(compact.group(1))
            if parsed_seconds is not None:
                return _minutes_from_seconds(int(parsed_seconds))
    return None


def _extract_duration_minutes(payload: dict[str, Any]) -> int | float | None:
    for key in ("duration", "total_audio_minutes"):
        value = payload.get(key)
        parsed = _parse_duration_minutes(value)
        if parsed is not None:
            return parsed

    for key in ("duration_seconds", "duration_in_seconds"):
        value = payload.get(key)
        if isinstance(value, int):
            parsed = _minutes_from_seconds(value)
            if parsed is not None:
                return parsed
        if isinstance(value, str):
            parsed_seconds = _parse_numeric_token(value)
            if parsed_seconds is not None:
                parsed = _minutes_from_seconds(int(parsed_seconds))
                if parsed is not None:
                    return parsed

    notes_parsed = _parse_duration_from_notes(payload.get("notes"))
    if notes_parsed is not None:
        return notes_parsed

    return None


def _is_audiobook_entry(entry: dict[str, Any]) -> bool:
    text_fields = [
        entry.get("physical_format"),
        entry.get("format"),
        entry.get("title"),
        entry.get("subtitle"),
        entry.get("ocaid"),
    ]
    haystack = " ".join(
        value.lower().strip() for value in text_fields if isinstance(value, str)
    )
    if not haystack:
        return False
    audio_tokens = (
        "audio",
        "audiobook",
        "sound recording",
        "cd",
        "mp3",
        "cassette",
        "spoken word",
    )
    return any(token in haystack for token in audio_tokens)


def _edition_format_penalty(entry: dict[str, Any]) -> int:
    physical_format = entry.get("physical_format")
    if not isinstance(physical_format, str):
        return 0
    lowered = physical_format.strip().lower()
    if not lowered:
        return 0
    if any(
        token in lowered
        for token in ("audiobook", "audio", "mp3", "cd", "cassette", "sound")
    ):
        return -3
    return 0


def _normalize_subject(value: str) -> str:
    return value.strip().replace(" ", "_").lower()


def _extract_top_subjects(work_payload: dict[str, Any], *, limit: int = 3) -> list[str]:
    subjects = work_payload.get("subjects")
    if not isinstance(subjects, list):
        return []
    result: list[str] = []
    for subject in subjects:
        if not isinstance(subject, str):
            continue
        normalized = _normalize_subject(subject)
        if normalized and normalized not in result:
            result.append(normalized)
        if len(result) >= limit:
            break
    return result


class OpenLibraryClient:
    def __init__(
        self,
        *,
        base_url: str = "https://openlibrary.org",
        user_agent: str | None = None,
        cache_ttl_seconds: int = 300,
        cache_max_entries: int = 256,
        max_retries: int = 3,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._user_agent = (
            user_agent
            or os.getenv(
                "OPENLIBRARY_USER_AGENT",
                "TheSeedbed/0.1 (contact@theseedbed.app)",
            )
            or "TheSeedbed/0.1 (contact@theseedbed.app)"
        )
        self._max_retries = max(max_retries, 1)
        self._cache: _TTLCache[OpenLibrarySearchResponse] = _TTLCache(
            ttl_seconds=cache_ttl_seconds,
            max_entries=cache_max_entries,
        )
        self._metadata_cache: _TTLCache[Any] = _TTLCache(
            ttl_seconds=60 * 60 * 24,
            max_entries=512,
        )
        self._transport = transport

    async def _request_json(
        self,
        path: str,
        *,
        params: dict[str, str | int] | None = None,
    ) -> dict[str, Any]:
        url = f"{self._base_url}{path}"
        headers = {"User-Agent": self._user_agent}
        retryable_statuses = {429, 500, 502, 503, 504}
        timeout = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)

        def parse_retry_after_seconds(value: str | None) -> float | None:
            if not value:
                return None
            try:
                seconds = float(int(value.strip()))
            except ValueError:
                return None
            if seconds <= 0:
                return None
            return seconds

        def compute_sleep_seconds(*, attempt: int, retry_after: float | None) -> float:
            # Exponential backoff with full jitter, capped.
            base = 0.2
            cap = 2.0
            max_delay = min(cap, base * (2 ** (attempt - 1)))
            delay = retry_after if retry_after is not None else max_delay
            delay = max(0.0, min(delay, cap))
            return random.uniform(0.0, delay)

        budget = get_provider_budget_controller()
        enforce_budget = self._transport is None
        async with httpx.AsyncClient(
            timeout=timeout, transport=self._transport
        ) as client:
            for attempt in range(1, self._max_retries + 1):
                if enforce_budget:
                    await budget.acquire("openlibrary")
                try:
                    response = await client.get(url, params=params, headers=headers)
                except (httpx.TimeoutException, httpx.TransportError):
                    if enforce_budget:
                        await budget.record_failure("openlibrary")
                    if attempt >= self._max_retries:
                        raise
                    await asyncio.sleep(
                        compute_sleep_seconds(attempt=attempt, retry_after=None)
                    )
                    continue

                if (
                    response.status_code in retryable_statuses
                    and attempt < self._max_retries
                ):
                    if enforce_budget:
                        await budget.record_failure("openlibrary")
                    retry_after = parse_retry_after_seconds(
                        response.headers.get("Retry-After")
                    )
                    await asyncio.sleep(
                        compute_sleep_seconds(attempt=attempt, retry_after=retry_after)
                    )
                    continue

                try:
                    response.raise_for_status()
                except httpx.HTTPStatusError:
                    if enforce_budget:
                        await budget.record_failure("openlibrary")
                    raise
                if enforce_budget:
                    await budget.record_success("openlibrary")
                return cast(dict[str, Any], response.json())

        raise RuntimeError("open library request failed")

    async def search_books(
        self,
        *,
        query: str,
        limit: int = 10,
        page: int = 1,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: Literal["relevance", "new", "old"] = "relevance",
    ) -> OpenLibrarySearchResponse:
        normalized_query = query.strip()
        normalized_author = (author or "").strip()
        normalized_subject = (subject or "").strip()
        normalized_language = (language or "").strip().lower()
        q_parts: list[str] = []
        if first_publish_year_from is not None:
            q_parts.append(f"first_publish_year:[{first_publish_year_from} TO *]")
        if first_publish_year_to is not None:
            q_parts.append(f"first_publish_year:[* TO {first_publish_year_to}]")
        q = " ".join(q_parts) if q_parts else None
        sort_param = "new" if sort == "new" else "old" if sort == "old" else None
        cache_key = (
            f"{normalized_query.lower()}::{normalized_author.lower()}::{normalized_subject.lower()}::"
            f"{normalized_language}::{first_publish_year_from}::{first_publish_year_to}::{sort_param}::{limit}::{page}"
        )
        cached = self._cache.get(cache_key)
        if cached is not None:
            return OpenLibrarySearchResponse(
                items=cached.items,
                query=cached.query,
                limit=cached.limit,
                page=cached.page,
                num_found=cached.num_found,
                has_more=cached.has_more,
                next_page=cached.next_page,
                cache_hit=True,
            )

        params: dict[str, str | int] = {
            "title": normalized_query,
            "limit": limit,
            "page": page,
            "fields": (
                "key,title,author_name,first_publish_year,cover_i,edition_count,"
                "language,has_fulltext,public_scan_b,ia"
            ),
        }
        if normalized_author:
            params["author"] = normalized_author
        if normalized_subject:
            params["subject"] = normalized_subject
        if normalized_language:
            params["language"] = normalized_language
        if q:
            params["q"] = q
        if sort_param is not None:
            params["sort"] = sort_param
        payload = await self._request_json("/search.json", params=params)
        docs = payload.get("docs", [])
        items: list[OpenLibrarySearchResult] = []
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            work_key = doc.get("key")
            title = doc.get("title")
            if not isinstance(work_key, str) or not isinstance(title, str):
                continue
            cover_id = doc.get("cover_i")
            cover_url = None
            if isinstance(cover_id, int):
                cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
            author_names = doc.get("author_name")
            normalized_authors = []
            if isinstance(author_names, list):
                normalized_authors = [
                    name for name in author_names if isinstance(name, str)
                ]
            first_publish_year = doc.get("first_publish_year")
            items.append(
                OpenLibrarySearchResult(
                    work_key=work_key,
                    title=title,
                    author_names=normalized_authors,
                    first_publish_year=(
                        first_publish_year
                        if isinstance(first_publish_year, int)
                        else None
                    ),
                    cover_url=cover_url,
                    edition_count=(
                        doc.get("edition_count")
                        if isinstance(doc.get("edition_count"), int)
                        else None
                    ),
                    languages=_extract_language_codes(doc.get("language")),
                    readable=bool(
                        doc.get("has_fulltext")
                        or doc.get("public_scan_b")
                        or doc.get("ia")
                    ),
                )
            )

        raw_num_found = payload.get("numFound")
        num_found = raw_num_found if isinstance(raw_num_found, int) else None
        has_more = (
            page * limit < num_found
            if isinstance(num_found, int)
            else len(items) == limit
        )
        next_page = page + 1 if has_more else None

        result = OpenLibrarySearchResponse(
            items=items,
            query=normalized_query,
            limit=limit,
            page=page,
            num_found=num_found,
            has_more=has_more,
            next_page=next_page,
            cache_hit=False,
        )
        self._cache.set(cache_key, result)
        return result

    async def fetch_work_bundle(
        self,
        *,
        work_key: str,
        edition_key: str | None = None,
        preferred_language: str | None = None,
    ) -> OpenLibraryWorkBundle:
        normalized_work_key = _normalize_work_key(work_key)
        work_payload = await self._request_json(f"{normalized_work_key}.json")

        author_entries = work_payload.get("authors", [])
        authors: list[dict[str, str]] = []
        for author_entry in author_entries:
            if not isinstance(author_entry, dict):
                continue
            author_obj = author_entry.get("author")
            if not isinstance(author_obj, dict):
                continue
            author_key = author_obj.get("key")
            if isinstance(author_key, str):
                author_payload = await self._request_json(f"{author_key}.json")
                name = author_payload.get("name")
                if isinstance(name, str):
                    authors.append({"key": author_key, "name": name})

        normalized_edition_key: str | None = None
        raw_edition: dict[str, Any] | None = None
        if edition_key:
            normalized_edition_key = _normalize_edition_key(edition_key)
            raw_edition = await self._request_json(f"{normalized_edition_key}.json")
        else:
            normalized_preferred_language = _canonical_openlibrary_language(
                preferred_language
            )
            editions_payload = await self._request_json(
                f"{normalized_work_key}/editions.json",
                params={
                    "limit": 20,
                },
            )
            entries = editions_payload.get("entries", [])
            if isinstance(entries, list):
                candidates = [entry for entry in entries if isinstance(entry, dict)]
                scored: list[tuple[int, int, str, dict[str, Any]]] = []
                for candidate in candidates:
                    key = candidate.get("key")
                    if not isinstance(key, str):
                        continue
                    score = 0
                    if _first_list_string(candidate.get("isbn_13")):
                        score += 3
                    if _first_list_string(candidate.get("isbn_10")):
                        score += 2
                    if _first_list_string(candidate.get("publishers")):
                        score += 1
                    if isinstance(candidate.get("publish_date"), str):
                        score += 1
                    covers = candidate.get("covers")
                    if isinstance(covers, list) and any(
                        isinstance(value, int) and value > 0 for value in covers
                    ):
                        score += 1
                    edition_languages = _extract_language_codes(
                        candidate.get("languages")
                    )
                    primary_language = (
                        _canonical_openlibrary_language(edition_languages[0])
                        if edition_languages
                        else None
                    )
                    if (
                        normalized_preferred_language is not None
                        and primary_language is not None
                    ):
                        if primary_language == normalized_preferred_language:
                            score += 4
                        else:
                            score -= 2
                    elif (
                        normalized_preferred_language is not None
                        and primary_language is None
                    ):
                        score -= 1
                    if _is_audiobook_entry(candidate):
                        score -= 4
                    score += _edition_format_penalty(candidate)
                    publish_year = (
                        _parse_publish_year(candidate.get("publish_date")) or 0
                    )
                    scored.append((score, publish_year, key, candidate))
                if scored:
                    scored.sort(
                        key=lambda item: (
                            -item[0],
                            -item[1],
                            item[2],
                        )
                    )
                    _, _, normalized_edition_key, raw_edition = scored[0]

        cover_url = None
        covers = work_payload.get("covers")
        if isinstance(covers, list) and covers and isinstance(covers[0], int):
            cover_url = f"https://covers.openlibrary.org/b/id/{covers[0]}-L.jpg"

        # Some works do not expose cover ids at the work level, but editions do.
        if cover_url is None and raw_edition is not None:
            edition_covers = raw_edition.get("covers")
            if (
                isinstance(edition_covers, list)
                and edition_covers
                and isinstance(edition_covers[0], int)
            ):
                cover_url = (
                    f"https://covers.openlibrary.org/b/id/{edition_covers[0]}-L.jpg"
                )

        # If we only have an editions.json stub, fetch the full edition payload on-demand
        # to check for covers (and to persist a more complete source record).
        if (
            cover_url is None
            and raw_edition is not None
            and normalized_edition_key is not None
            and edition_key is None
        ):
            try:
                raw_edition = await self._request_json(f"{normalized_edition_key}.json")
            except httpx.HTTPError:
                # Best-effort fallback. If the edition fetch fails, continue with the
                # editions.json stub we already have instead of failing the import.
                pass
            else:
                edition_covers = raw_edition.get("covers")
                if (
                    isinstance(edition_covers, list)
                    and edition_covers
                    and isinstance(edition_covers[0], int)
                ):
                    cover_url = (
                        f"https://covers.openlibrary.org/b/id/{edition_covers[0]}-L.jpg"
                    )

        edition: dict[str, Any] | None = None
        if raw_edition is not None and normalized_edition_key is not None:
            isbn10 = _first_list_string(raw_edition.get("isbn_10"))
            isbn13 = _first_list_string(raw_edition.get("isbn_13"))
            edition_languages = _extract_language_codes(raw_edition.get("languages"))
            edition = {
                "key": normalized_edition_key,
                "isbn10": isbn10,
                "isbn13": isbn13,
                "publisher": _first_list_string(raw_edition.get("publishers")),
                "publish_date": (
                    raw_edition.get("publish_date")
                    if isinstance(raw_edition.get("publish_date"), str)
                    else None
                ),
                "publish_date_iso": _parse_iso_publish_date(
                    raw_edition.get("publish_date")
                ),
                "language": (edition_languages[0] if edition_languages else None),
                "format": (
                    raw_edition.get("physical_format")
                    if isinstance(raw_edition.get("physical_format"), str)
                    else None
                ),
            }

        return OpenLibraryWorkBundle(
            work_key=normalized_work_key,
            title=str(work_payload.get("title") or "Untitled"),
            description=_extract_description(work_payload),
            first_publish_year=(
                work_payload.get("first_publish_date")
                if isinstance(work_payload.get("first_publish_date"), int)
                else (
                    work_payload.get("first_publish_year")
                    if isinstance(work_payload.get("first_publish_year"), int)
                    else None
                )
            ),
            cover_url=cover_url,
            authors=authors,
            edition=edition,
            raw_work=work_payload,
            raw_edition=raw_edition,
        )

    async def resolve_work_key_from_edition_key(
        self, *, edition_key: str
    ) -> str | None:
        normalized_edition_key = _normalize_edition_key(edition_key)
        payload = await self._request_json(f"{normalized_edition_key}.json")
        works = payload.get("works")
        if not isinstance(works, list):
            return None
        for item in works:
            if not isinstance(item, dict):
                continue
            key = item.get("key")
            if isinstance(key, str):
                normalized = key.strip()
                if normalized.startswith("/works/"):
                    return normalized
        return None

    async def fetch_edition_payload(self, *, edition_key: str) -> dict[str, Any]:
        normalized_edition_key = _normalize_edition_key(edition_key)
        payload = await self._request_json(f"{normalized_edition_key}.json")
        return payload if isinstance(payload, dict) else {}

    async def fetch_work_editions(
        self,
        *,
        work_key: str,
        limit: int = 20,
        language: str | None = None,
    ) -> list[OpenLibraryEditionSummary]:
        normalized_work_key = _normalize_work_key(work_key)
        payload = await self._request_json(
            f"{normalized_work_key}/editions.json",
            params={"limit": max(1, min(limit, 100))},
        )
        entries = payload.get("entries", [])
        if not isinstance(entries, list):
            return []

        normalized_language = (
            _canonical_openlibrary_language(language)
            if isinstance(language, str) and language.strip()
            else None
        )
        items: list[OpenLibraryEditionSummary] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            edition_key = entry.get("key")
            if not isinstance(edition_key, str):
                continue

            entry_languages = _extract_language_codes(entry.get("languages"))
            primary_language = entry_languages[0] if entry_languages else None
            if (
                normalized_language is not None
                and primary_language is not None
                and _canonical_openlibrary_language(primary_language)
                != normalized_language
            ):
                continue

            title = entry.get("title") if isinstance(entry.get("title"), str) else None
            publisher = _first_list_string(entry.get("publishers"))
            publish_date = (
                entry.get("publish_date")
                if isinstance(entry.get("publish_date"), str)
                else None
            )
            isbn10 = _first_list_string(entry.get("isbn_10"))
            isbn13 = _first_list_string(entry.get("isbn_13"))

            cover_url = None
            covers = entry.get("covers")
            if isinstance(covers, list):
                for cover_id in covers:
                    if isinstance(cover_id, int) and cover_id > 0:
                        cover_url = (
                            f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
                        )
                        break

            items.append(
                OpenLibraryEditionSummary(
                    key=_normalize_edition_key(edition_key),
                    title=title,
                    publisher=publisher,
                    publish_date=publish_date,
                    language=primary_language,
                    isbn10=isbn10,
                    isbn13=isbn13,
                    cover_url=cover_url,
                )
            )
        return items

    async def find_work_key_by_isbn(self, *, isbn: str) -> str | None:
        normalized = isbn.strip().replace("-", "")
        if not normalized:
            return None
        payload = await self._request_json(
            "/search.json",
            params={
                "q": f"isbn:{normalized}",
                "limit": 1,
                "fields": "key",
            },
        )
        docs = payload.get("docs")
        if not isinstance(docs, list) or not docs:
            return None
        first = docs[0]
        if not isinstance(first, dict):
            return None
        key = first.get("key")
        return key if isinstance(key, str) and key.startswith("/works/") else None

    async def fetch_cover_ids_for_work(
        self,
        *,
        work_key: str,
        editions_limit: int = 20,
    ) -> list[int]:
        def _dedupe(ids: list[int]) -> list[int]:
            seen: set[int] = set()
            result: list[int] = []
            for cid in ids:
                if cid in seen:
                    continue
                seen.add(cid)
                result.append(cid)
            return result

        normalized_work_key = _normalize_work_key(work_key)
        work_payload = await self._request_json(f"{normalized_work_key}.json")

        cover_ids: list[int] = []
        covers = work_payload.get("covers")
        if isinstance(covers, list):
            for c in covers:
                if isinstance(c, int) and c > 0:
                    cover_ids.append(c)

        cover_ids = _dedupe(cover_ids)
        if cover_ids:
            return cover_ids

        # Some works do not expose cover ids on the work payload even though editions do.
        editions_payload = await self._request_json(
            f"{normalized_work_key}/editions.json", params={"limit": editions_limit}
        )
        entries = editions_payload.get("entries", [])
        if not isinstance(entries, list):
            return []

        edition_cover_ids: list[int] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            edition_covers = entry.get("covers")
            if not isinstance(edition_covers, list):
                continue
            for cid in edition_covers:
                if not isinstance(cid, int) or cid <= 0:
                    continue
                edition_cover_ids.append(cid)

        return _dedupe(edition_cover_ids)

    async def fetch_work_audiobook_durations(
        self,
        *,
        work_key: str,
        editions_limit: int = 120,
    ) -> list[int | float]:
        normalized_work_key = _normalize_work_key(work_key)
        editions_payload = await self._request_json(
            f"{normalized_work_key}/editions.json", params={"limit": editions_limit}
        )
        entries = editions_payload.get("entries", [])
        if not isinstance(entries, list):
            return []

        durations: list[int | float] = []
        seen: set[int | float] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            if not _is_audiobook_entry(entry):
                continue
            duration_minutes = _extract_duration_minutes(entry)
            if duration_minutes is None:
                edition_key = entry.get("key")
                if isinstance(edition_key, str):
                    try:
                        edition_payload = await self._request_json(
                            f"{_normalize_edition_key(edition_key)}.json"
                        )
                    except Exception:
                        edition_payload = {}
                    if isinstance(edition_payload, dict):
                        duration_minutes = _extract_duration_minutes(edition_payload)
            if duration_minutes is None or duration_minutes in seen:
                continue
            seen.add(duration_minutes)
            durations.append(duration_minutes)
        return durations

    async def fetch_related_works(
        self,
        *,
        work_payload: dict[str, Any],
        exclude_work_key: str,
        per_subject_limit: int = 10,
        max_items: int = 12,
    ) -> list[OpenLibraryRelatedWork]:  # pragma: no cover
        subjects = _extract_top_subjects(work_payload)
        if not subjects:
            return []
        preferred_languages = set(
            _extract_language_codes(work_payload.get("languages"))
        )

        language_matched: dict[str, OpenLibraryRelatedWork] = {}
        fallback: dict[str, OpenLibraryRelatedWork] = {}
        for subject in subjects:
            cache_key = f"subject::{subject}::{per_subject_limit}"
            payload = self._metadata_cache.get(cache_key)
            if payload is None:
                payload = await self._request_json(
                    f"/subjects/{subject}.json",
                    params={"limit": per_subject_limit},
                )
                self._metadata_cache.set(cache_key, payload)

            works = payload.get("works", [])
            if not isinstance(works, list):
                continue
            for item in works:
                if not isinstance(item, dict):
                    continue
                work_key = item.get("key")
                title = item.get("title")
                if not isinstance(work_key, str) or not isinstance(title, str):
                    continue
                if work_key == exclude_work_key:
                    continue
                if work_key in language_matched:
                    continue
                if not preferred_languages and work_key in fallback:
                    continue
                cover_id = item.get("cover_id")
                if not isinstance(cover_id, int):
                    continue
                cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg"
                raw_authors = item.get("authors")
                author_names: list[str] = []
                if isinstance(raw_authors, list):
                    for raw_author in raw_authors:
                        if isinstance(raw_author, str):
                            name = raw_author.strip()
                        elif isinstance(raw_author, dict):
                            possible_name = raw_author.get("name")
                            name = (
                                possible_name.strip()
                                if isinstance(possible_name, str)
                                else ""
                            )
                        else:
                            name = ""
                        if name and name not in author_names:
                            author_names.append(name)
                related_work = OpenLibraryRelatedWork(
                    work_key=work_key,
                    title=title,
                    cover_url=cover_url,
                    first_publish_year=_parse_publish_year(
                        item.get("first_publish_year")
                    ),
                    author_names=author_names,
                )
                raw_item_languages = item.get("languages")
                if raw_item_languages is None:
                    raw_item_languages = item.get("language")
                item_languages = set(_extract_language_codes(raw_item_languages))

                if preferred_languages and item_languages & preferred_languages:
                    language_matched[work_key] = related_work
                    fallback.pop(work_key, None)
                elif work_key not in language_matched:
                    fallback[work_key] = related_work

                if preferred_languages:
                    if len(language_matched) >= max_items:
                        return list(language_matched.values())[:max_items]
                elif len(fallback) >= max_items:
                    return list(fallback.values())[:max_items]

        if preferred_languages and language_matched:
            return list(language_matched.values())[:max_items]
        return list(fallback.values())[:max_items]

    async def fetch_author_profile(
        self,
        *,
        author_key: str,
        works_limit: int = 8,
    ) -> OpenLibraryAuthorProfile:  # pragma: no cover
        normalized_key = (
            author_key
            if author_key.startswith("/authors/")
            else f"/authors/{author_key}"
        )
        cache_key = f"author::{normalized_key}::{works_limit}"
        cached = self._metadata_cache.get(cache_key)
        if isinstance(cached, OpenLibraryAuthorProfile):
            return cached

        author_payload = await self._request_json(f"{normalized_key}.json")
        works_payload = await self._request_json(
            f"{normalized_key}/works.json",
            params={"limit": works_limit},
        )
        entries = works_payload.get("entries", [])
        top_works: list[OpenLibraryAuthorWork] = []
        if isinstance(entries, list):
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                key = entry.get("key")
                title = entry.get("title")
                if not isinstance(key, str) or not isinstance(title, str):
                    continue
                covers = entry.get("covers")
                cover_url = None
                if isinstance(covers, list) and covers and isinstance(covers[0], int):
                    cover_url = f"https://covers.openlibrary.org/b/id/{covers[0]}-M.jpg"
                top_works.append(
                    OpenLibraryAuthorWork(
                        work_key=key,
                        title=title,
                        cover_url=cover_url,
                        first_publish_year=_parse_publish_year(
                            entry.get("first_publish_date")
                        ),
                    )
                )

        photos = author_payload.get("photos")
        photo_url = None
        if isinstance(photos, list) and photos and isinstance(photos[0], int):
            photo_url = f"https://covers.openlibrary.org/a/id/{photos[0]}-M.jpg"

        raw_name = author_payload.get("name")
        profile = OpenLibraryAuthorProfile(
            author_key=normalized_key,
            name=raw_name if isinstance(raw_name, str) else "Unknown author",
            bio=_extract_description(author_payload),
            photo_url=photo_url,
            top_works=top_works,
        )
        self._metadata_cache.set(cache_key, profile)
        return profile
