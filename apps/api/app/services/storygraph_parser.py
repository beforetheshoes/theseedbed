from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import re
from dataclasses import dataclass

REQUIRED_COLUMNS = {
    "Title",
    "Authors",
    "ISBN/UID",
    "Read Status",
    "Date Added",
    "Last Date Read",
    "Dates Read",
    "Read Count",
    "Star Rating",
    "Review",
    "Tags",
}

STATUS_MAP: dict[str, str] = {
    "read": "completed",
    "to-read": "to_read",
    "currently-reading": "reading",
    "paused": "reading",
    "did-not-finish": "abandoned",
}

ISBN_RE = re.compile(r"^[0-9Xx]{10}$|^[0-9]{13}$")


class StorygraphCsvError(ValueError):
    pass


@dataclass(frozen=True)
class StorygraphRow:
    row_number: int
    title: str
    authors: list[str]
    uid: str | None
    status: str
    rating_10: int | None
    rating_5: int | None
    review: str | None
    tags: list[str]
    date_added: dt.date | None
    last_date_read: dt.date | None
    dates_read_start: dt.date | None
    dates_read_end: dt.date | None
    read_count: int | None
    identity_hash: str


@dataclass(frozen=True)
class StorygraphParseResult:
    rows: list[StorygraphRow]
    issues: list[StorygraphParseIssue]


@dataclass(frozen=True)
class StorygraphParseIssue:
    row_number: int
    title: str | None
    uid: str | None
    identity_hash: str
    message: str


@dataclass(frozen=True)
class StorygraphMissingRequiredField:
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
        raise StorygraphCsvError(f"invalid date: {candidate}") from exc


def _parse_dates_read(value: str) -> tuple[dt.date | None, dt.date | None]:
    candidate = value.strip()
    if not candidate:
        return None, None
    if "-" in candidate:
        parts = [part.strip() for part in candidate.split("-")]
        if len(parts) != 2:
            raise StorygraphCsvError(f"invalid dates read range: {candidate}")
        start = _parse_date(parts[0])
        end = _parse_date(parts[1])
        return start, end
    parsed = _parse_date(candidate)
    return parsed, parsed


def _parse_int(value: str) -> int | None:
    raw = value.strip()
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise StorygraphCsvError(f"invalid integer: {raw}") from exc


def _parse_star_rating(value: str) -> tuple[int | None, int | None]:
    raw = value.strip()
    if not raw:
        return None, None
    try:
        star = float(raw)
    except ValueError as exc:
        raise StorygraphCsvError(f"invalid star rating: {raw}") from exc
    rating_10 = max(0, min(10, round(star * 2)))
    rating_5 = max(1, min(5, round(star)))
    return rating_10, rating_5


def _parse_tags(value: str) -> list[str]:
    seen: set[str] = set()
    tags: list[str] = []
    for tag in value.split(","):
        normalized = tag.strip()
        if not normalized:
            continue
        lower = normalized.lower()
        if lower in seen:
            continue
        seen.add(lower)
        tags.append(normalized)
    return tags


def _normalize_authors(value: str) -> list[str]:
    authors = [part.strip() for part in value.split(",") if part.strip()]
    deduped: list[str] = []
    seen: set[str] = set()
    for author in authors:
        key = author.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(author)
    return deduped


def _normalize_uid(value: str) -> str | None:
    normalized = value.strip().replace("-", "")
    return normalized or None


def is_valid_isbn(value: str | None) -> bool:
    if not value:
        return False
    return bool(ISBN_RE.match(value))


def parse_storygraph_csv(
    raw: bytes,
    *,
    author_overrides: dict[int, str] | None = None,
    title_overrides: dict[int, str] | None = None,
    status_overrides: dict[int, str] | None = None,
) -> StorygraphParseResult:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise StorygraphCsvError("CSV must be utf-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fieldnames)
    if missing:
        raise StorygraphCsvError(f"missing required columns: {', '.join(missing)}")

    rows: list[StorygraphRow] = []
    issues: list[StorygraphParseIssue] = []
    author_override_map = author_overrides or {}
    title_override_map = title_overrides or {}
    status_override_map = status_overrides or {}
    for row_number, row in enumerate(reader, start=2):
        title_override = title_override_map.get(row_number)
        title = (
            title_override if title_override is not None else (row.get("Title") or "")
        ).strip()
        author_override = author_override_map.get(row_number)
        author_source = (
            author_override
            if author_override is not None
            else (row.get("Authors") or "")
        )
        authors = _normalize_authors(author_source)
        uid = _normalize_uid(row.get("ISBN/UID") or "")
        identity_source = "|".join(
            [title.lower(), ",".join(a.lower() for a in authors), uid or ""]
        )
        identity_hash = hashlib.sha256(identity_source.encode("utf-8")).hexdigest()
        try:
            if not title:
                raise StorygraphCsvError("title is required")
            if not authors:
                raise StorygraphCsvError("authors are required")

            status_override = status_override_map.get(row_number)
            status_input = (
                (
                    status_override
                    if status_override is not None
                    else (row.get("Read Status") or "")
                )
                .strip()
                .lower()
            )
            status = STATUS_MAP.get(status_input)
            if status is None:
                raise StorygraphCsvError(f"unsupported read status '{status_input}'")

            rating_10, rating_5 = _parse_star_rating(row.get("Star Rating") or "")
            tags = _parse_tags(row.get("Tags") or "")
            date_added = _parse_date(row.get("Date Added") or "")
            last_date_read = _parse_date(row.get("Last Date Read") or "")
            dates_read_start, dates_read_end = _parse_dates_read(
                row.get("Dates Read") or ""
            )
            read_count = _parse_int(row.get("Read Count") or "")
        except StorygraphCsvError as exc:
            issues.append(
                StorygraphParseIssue(
                    row_number=row_number,
                    title=title or None,
                    uid=uid,
                    identity_hash=identity_hash,
                    message=str(exc),
                )
            )
            continue

        review = (row.get("Review") or "").strip() or None

        rows.append(
            StorygraphRow(
                row_number=row_number,
                title=title,
                authors=authors,
                uid=uid,
                status=status,
                rating_10=rating_10,
                rating_5=rating_5,
                review=review,
                tags=tags,
                date_added=date_added,
                last_date_read=last_date_read,
                dates_read_start=dates_read_start,
                dates_read_end=dates_read_end,
                read_count=read_count,
                identity_hash=identity_hash,
            )
        )

    return StorygraphParseResult(rows=rows, issues=issues)


def find_missing_required_fields(raw: bytes) -> list[StorygraphMissingRequiredField]:
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise StorygraphCsvError("CSV must be utf-8 encoded") from exc

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = set(reader.fieldnames or [])
    missing = sorted(REQUIRED_COLUMNS - fieldnames)
    if missing:
        raise StorygraphCsvError(f"missing required columns: {', '.join(missing)}")

    missing_fields: list[StorygraphMissingRequiredField] = []
    for row_number, row in enumerate(reader, start=2):
        title = (row.get("Title") or "").strip() or None
        authors = _normalize_authors(row.get("Authors") or "")
        uid = _normalize_uid(row.get("ISBN/UID") or "")
        read_status = (row.get("Read Status") or "").strip()

        if title is None:
            missing_fields.append(
                StorygraphMissingRequiredField(
                    row_number=row_number,
                    title=None,
                    uid=uid,
                    field="title",
                )
            )
        if not authors:
            missing_fields.append(
                StorygraphMissingRequiredField(
                    row_number=row_number,
                    title=title,
                    uid=uid,
                    field="authors",
                )
            )
        if not read_status:
            missing_fields.append(
                StorygraphMissingRequiredField(
                    row_number=row_number,
                    title=title,
                    uid=uid,
                    field="read_status",
                )
            )

    return missing_fields
