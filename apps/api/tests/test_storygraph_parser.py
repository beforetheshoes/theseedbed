from __future__ import annotations

import csv
import io

import pytest

from app.services.storygraph_parser import (
    REQUIRED_COLUMNS,
    StorygraphCsvError,
    find_missing_required_fields,
    is_valid_isbn,
    parse_storygraph_csv,
)


def _csv_bytes(rows: list[dict[str, str]]) -> bytes:
    headers = [
        "Title",
        "Authors",
        "Contributors",
        "ISBN/UID",
        "Format",
        "Read Status",
        "Date Added",
        "Last Date Read",
        "Dates Read",
        "Read Count",
        "Moods",
        "Pace",
        "Character- or Plot-Driven?",
        "Strong Character Development?",
        "Loveable Characters?",
        "Diverse Characters?",
        "Flawed Characters?",
        "Star Rating",
        "Review",
        "Content Warnings",
        "Content Warning Description",
        "Tags",
        "Owned?",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue().encode("utf-8")


def test_parse_storygraph_csv_success() -> None:
    result = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "ISBN/UID": "9781234567890",
                    "Read Status": "read",
                    "Date Added": "2024/01/02",
                    "Last Date Read": "2024/01/05",
                    "Dates Read": "2024/01/02-2024/01/05",
                    "Read Count": "1",
                    "Star Rating": "4.0",
                    "Review": "Great read!",
                    "Tags": "favorites, Favorites",
                }
            ]
        )
    )
    assert len(result.rows) == 1
    assert result.issues == []
    row = result.rows[0]
    assert row.status == "completed"
    assert row.rating_10 == 8
    assert row.rating_5 == 4
    assert row.tags == ["favorites"]
    assert row.review == "Great read!"
    assert row.dates_read_start is not None
    assert row.dates_read_end is not None


def test_parse_storygraph_csv_dedupes_duplicate_authors_case_insensitive() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A, author a, Author B",
                    "Read Status": "read",
                }
            ]
        )
    )
    assert parsed.rows[0].authors == ["Author A", "Author B"]


def test_parse_storygraph_csv_missing_columns() -> None:
    raw = b"Title,Authors\nOnly,Me\n"
    with pytest.raises(StorygraphCsvError, match="missing required columns"):
        parse_storygraph_csv(raw)


def test_parse_storygraph_csv_invalid_status() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "ISBN/UID": "9781234567890",
                    "Read Status": "unknown",
                }
            ]
        )
    )
    assert parsed.rows == []
    assert len(parsed.issues) == 1
    assert "unsupported read status" in parsed.issues[0].message


def test_parse_storygraph_csv_invalid_date() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "ISBN/UID": "9781234567890",
                    "Read Status": "read",
                    "Date Added": "2024-01-02",
                }
            ]
        )
    )
    assert parsed.rows == []
    assert len(parsed.issues) == 1
    assert "invalid date" in parsed.issues[0].message


def test_parse_storygraph_csv_requires_title_and_authors() -> None:
    missing_title = parse_storygraph_csv(
        _csv_bytes([{"Title": "", "Authors": "Author A", "Read Status": "read"}])
    )
    assert missing_title.rows == []
    assert len(missing_title.issues) == 1
    assert "title is required" in missing_title.issues[0].message

    missing_authors = parse_storygraph_csv(
        _csv_bytes([{"Title": "Book", "Authors": "", "Read Status": "read"}])
    )
    assert missing_authors.rows == []
    assert len(missing_authors.issues) == 1
    assert "authors are required" in missing_authors.issues[0].message


def test_parse_storygraph_csv_dates_read_single_date_and_invalid_range() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "Read Status": "read",
                    "Dates Read": "2024/01/10",
                }
            ]
        )
    )
    row = parsed.rows[0]
    assert row.dates_read_start == row.dates_read_end
    assert parsed.issues == []

    invalid = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "Read Status": "read",
                    "Dates Read": "2024/01/10-2024/01/11-2024/01/12",
                }
            ]
        )
    )
    assert invalid.rows == []
    assert len(invalid.issues) == 1
    assert "invalid dates read range" in invalid.issues[0].message


def test_parse_storygraph_csv_invalid_numeric_fields() -> None:
    invalid_int = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "Read Status": "read",
                    "Read Count": "abc",
                }
            ]
        )
    )
    assert invalid_int.rows == []
    assert len(invalid_int.issues) == 1
    assert "invalid integer" in invalid_int.issues[0].message

    invalid_star = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "Author A",
                    "Read Status": "read",
                    "Star Rating": "oops",
                }
            ]
        )
    )
    assert invalid_star.rows == []
    assert len(invalid_star.issues) == 1
    assert "invalid star rating" in invalid_star.issues[0].message


def test_parse_storygraph_csv_mixed_valid_and_invalid_rows() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Valid Book",
                    "Authors": "Author A",
                    "Read Status": "read",
                },
                {
                    "Title": "Invalid Book",
                    "Authors": "",
                    "Read Status": "read",
                },
            ]
        )
    )
    assert len(parsed.rows) == 1
    assert parsed.rows[0].title == "Valid Book"
    assert len(parsed.issues) == 1
    assert "authors are required" in parsed.issues[0].message


def test_parse_storygraph_csv_applies_author_overrides() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "Book One",
                    "Authors": "",
                    "Read Status": "read",
                }
            ]
        ),
        author_overrides={2: "Author A"},
    )
    assert len(parsed.rows) == 1
    assert parsed.rows[0].authors == ["Author A"]
    assert parsed.issues == []


def test_parse_storygraph_csv_applies_title_and_status_overrides() -> None:
    parsed = parse_storygraph_csv(
        _csv_bytes(
            [
                {
                    "Title": "",
                    "Authors": "Author A",
                    "Read Status": "",
                }
            ]
        ),
        title_overrides={2: "Recovered Title"},
        status_overrides={2: "read"},
    )
    assert len(parsed.rows) == 1
    assert parsed.rows[0].title == "Recovered Title"
    assert parsed.rows[0].status == "completed"
    assert parsed.issues == []


def test_find_missing_required_fields() -> None:
    missing = find_missing_required_fields(
        _csv_bytes(
            [
                {
                    "Title": "",
                    "Authors": "",
                    "Read Status": "",
                    "ISBN/UID": "9781234567890",
                }
            ]
        )
    )
    assert len(missing) == 3
    assert {entry.field for entry in missing} == {"title", "authors", "read_status"}


def test_is_valid_isbn() -> None:
    assert is_valid_isbn("9781234567890") is True
    assert is_valid_isbn("123456789X") is True
    assert is_valid_isbn("B0DNKQQ29N") is False
    assert is_valid_isbn(None) is False


def test_required_columns_constant() -> None:
    assert "Title" in REQUIRED_COLUMNS
    assert "Tags" in REQUIRED_COLUMNS


def test_parse_storygraph_csv_rejects_non_utf8_bytes() -> None:
    with pytest.raises(StorygraphCsvError, match="utf-8"):
        parse_storygraph_csv(b"\xff\xfe\x00")
