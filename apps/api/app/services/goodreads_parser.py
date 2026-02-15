from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re
from dataclasses import dataclass

REQUIRED_COLUMNS = {
    "Book Id",
    "Title",
    "Author",
    "Additional Authors",
    "ISBN",
    "ISBN13",
    "My Rating",
    "Date Read",
    "Date Added",
    "Bookshelves",
    "Exclusive Shelf",
    "My Review",
    "Read Count",
}

STATUS_MAP: dict[str, str] = {
    "read": "completed",
    "to-read": "to_read",
    "currently-reading": "reading",
    "paused": "reading",
    "did-not-finish": "abandoned",
    "dnf": "abandoned",
    "abandoned": "abandoned",
}

SHELF_STATUS_TOKENS = {
    "read",
    "to-read",
    "currently-reading",
    "paused",
    "did-not-finish",
    "dnf",
    "abandoned",
}

ISBN_RE = re.compile(r"^[0-9Xx]{10}$|^[0-9]{13}$")


class GoodreadsCsvError(ValueError):
    pass


@dataclass(frozen=True)
class GoodreadsRow:
    row_number: int
    book_id: str | None
    title: str
    authors: list[str]
    uid: str | None
    status: str
    rating_10: int | None
    rating_5: int | None
    review: str | None
    tags: list[str]
    date_added: dt.date | None
    date_read: dt.date | None
    read_count: int | None
    identity_hash: str


@dataclass(frozen=True)
class GoodreadsParseResult:
    rows: list[GoodreadsRow]
    issues: list[GoodreadsParseIssue]


@dataclass(frozen=True)
class GoodreadsParseIssue:
    row_number: int
    title: str | None
    uid: str | None
    identity_hash: str
    message: str


@dataclass(frozen=True)
class GoodreadsMissingRequiredField:
    row_number: int
    title: str | None
    uid: str | None
    field: str


def _parse_date(value: str) -> dt.date | None:
    candidate = value.strip()
    if not candidate:
        return None
    try:
        return dt.datetime.strptime(candidate, "%Y/%m/%d").date()
    except ValueError as exc:
        raise GoodreadsCsvError(f"invalid date: {candidate}") from exc


def _parse_int(value: str) -> int | None:
    raw = value.strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise GoodreadsCsvError(f"invalid integer: {raw}") from exc


def _parse_rating(value: str) -> tuple[int | None, int | None]:
    raw = value.strip()
    if not raw:
        return None, None
    try:
        parsed = int(raw)
    except ValueError as exc:
        raise GoodreadsCsvError(f"invalid rating: {raw}") from exc
    if parsed < 0 or parsed > 5:
        raise GoodreadsCsvError(f"invalid rating: {raw}")
    if parsed == 0:
        return None, None
    return parsed * 2, parsed


def _dedupe_casefold(values: list[str]) -> list[str]:
    deduped: list[str] = []
    seen: set[str] = set()
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(value)
    return deduped


def _normalize_authors(author: str, additional_authors: str) -> list[str]:
    candidates = [author]
    if additional_authors:
        candidates.extend(additional_authors.split(","))
    normalized = [entry.strip() for entry in candidates if entry.strip()]
    return _dedupe_casefold(normalized)


def _normalize_goodreads_cell(value: str) -> str:
    normalized = value.strip()
    if normalized.startswith('="') and normalized.endswith('"'):
        normalized = normalized[2:-1]
    normalized = normalized.replace('"', "").replace("=", "").strip()
    return normalized


def _normalize_uid(isbn: str, isbn13: str) -> str | None:
    first = _normalize_goodreads_cell(isbn13).replace("-", "")
    second = _normalize_goodreads_cell(isbn).replace("-", "")

    if first and is_valid_isbn(first):
        return first
    if second and is_valid_isbn(second):
        return second
    return first or second or None


def _shelf_tokens(value: str) -> list[str]:
    values = [token.strip().lower() for token in value.split(",") if token.strip()]
    return _dedupe_casefold(values)


def _resolve_status(exclusive_shelf: str, bookshelves: str) -> str | None:
    primary = exclusive_shelf.strip().lower()
    if primary in STATUS_MAP:
        return STATUS_MAP[primary]

    for token in _shelf_tokens(bookshelves):
        mapped = STATUS_MAP.get(token)
        if mapped:
            return mapped
    return None


def _parse_tags(bookshelves: str) -> list[str]:
    tags: list[str] = []
    for token in _shelf_tokens(bookshelves):
        if token in SHELF_STATUS_TOKENS:
            continue
        tags.append(token)
    return tags


def is_valid_isbn(value: str | None) -> bool:
    if not value:
        return False
    return bool(ISBN_RE.match(value))


def _identity_hash(
    *,
    book_id: str | None,
    title: str,
    authors: list[str],
    uid: str | None,
    shelf: str,
) -> str:
    if book_id:
        identity_source = f"book-id:{book_id}"
    else:
        identity_source = "|".join(
            [
                title.lower(),
                ",".join(author.lower() for author in authors),
                uid or "",
                shelf.lower(),
            ]
        )
    return hashlib.sha256(identity_source.encode("utf-8")).hexdigest()


def parse_goodreads_csv(
    raw: bytes,
    *,
    author_overrides: dict[int, str] | None = None,
    title_overrides: dict[int, str] | None = None,
    shelf_overrides: dict[int, str] | None = None,
) -> GoodreadsParseResult:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise GoodreadsCsvError("CSV must be utf-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fieldnames)
    if missing:
        raise GoodreadsCsvError(f"missing required columns: {', '.join(missing)}")

    rows: list[GoodreadsRow] = []
    issues: list[GoodreadsParseIssue] = []
    author_override_map = author_overrides or {}
    title_override_map = title_overrides or {}
    shelf_override_map = shelf_overrides or {}

    for row_number, row in enumerate(reader, start=2):
        title_value = title_override_map.get(row_number)
        if title_value is None:
            title_value = str(row.get("Title") or "")
        title = title_value.strip()

        author_source = author_override_map.get(row_number)
        if author_source is None:
            author_source = str(row.get("Author") or "")
        additional_authors = ""
        if author_override_map.get(row_number) is None:
            additional_authors = str(row.get("Additional Authors") or "")

        authors = _normalize_authors(author_source, additional_authors)
        book_id = _normalize_goodreads_cell(row.get("Book Id") or "") or None
        uid = _normalize_uid(row.get("ISBN") or "", row.get("ISBN13") or "")

        shelf_value = shelf_override_map.get(row_number)
        if shelf_value is None:
            shelf_value = str(row.get("Exclusive Shelf") or "")
        shelf_source = shelf_value.strip()
        bookshelves = str(row.get("Bookshelves") or "")

        identity_hash = _identity_hash(
            book_id=book_id,
            title=title,
            authors=authors,
            uid=uid,
            shelf=shelf_source or bookshelves,
        )

        try:
            if not title:
                raise GoodreadsCsvError("title is required")
            if not authors:
                raise GoodreadsCsvError("authors are required")

            status = _resolve_status(shelf_source, bookshelves)
            if status is None:
                raise GoodreadsCsvError(
                    f"unsupported read status '{(shelf_source or '').strip().lower()}'"
                )

            rating_10, rating_5 = _parse_rating(row.get("My Rating") or "")
            tags = _parse_tags(bookshelves)
            date_read = _parse_date(row.get("Date Read") or "")
            date_added = _parse_date(row.get("Date Added") or "")
            read_count = _parse_int(row.get("Read Count") or "")
        except GoodreadsCsvError as exc:
            issues.append(
                GoodreadsParseIssue(
                    row_number=row_number,
                    title=title or None,
                    uid=uid,
                    identity_hash=identity_hash,
                    message=str(exc),
                )
            )
            continue

        review = (row.get("My Review") or "").strip() or None

        rows.append(
            GoodreadsRow(
                row_number=row_number,
                book_id=book_id,
                title=title,
                authors=authors,
                uid=uid,
                status=status,
                rating_10=rating_10,
                rating_5=rating_5,
                review=review,
                tags=tags,
                date_added=date_added,
                date_read=date_read,
                read_count=read_count,
                identity_hash=identity_hash,
            )
        )

    return GoodreadsParseResult(rows=rows, issues=issues)


def find_missing_required_fields(raw: bytes) -> list[GoodreadsMissingRequiredField]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise GoodreadsCsvError("CSV must be utf-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fieldnames)
    if missing:
        raise GoodreadsCsvError(f"missing required columns: {', '.join(missing)}")

    missing_fields: list[GoodreadsMissingRequiredField] = []
    for row_number, row in enumerate(reader, start=2):
        title = (row.get("Title") or "").strip() or None
        authors = _normalize_authors(
            row.get("Author") or "", row.get("Additional Authors") or ""
        )
        uid = _normalize_uid(row.get("ISBN") or "", row.get("ISBN13") or "")
        status = _resolve_status(
            row.get("Exclusive Shelf") or "", row.get("Bookshelves") or ""
        )

        if title is None:
            missing_fields.append(
                GoodreadsMissingRequiredField(
                    row_number=row_number,
                    title=None,
                    uid=uid,
                    field="title",
                )
            )
        if not authors:
            missing_fields.append(
                GoodreadsMissingRequiredField(
                    row_number=row_number,
                    title=title,
                    uid=uid,
                    field="authors",
                )
            )
        if status is None:
            missing_fields.append(
                GoodreadsMissingRequiredField(
                    row_number=row_number,
                    title=title,
                    uid=uid,
                    field="read_status",
                )
            )

    return missing_fields
