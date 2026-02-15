from __future__ import annotations

import csv
import io

import pytest

from app.services.goodreads_parser import (
    REQUIRED_COLUMNS,
    GoodreadsCsvError,
    find_missing_required_fields,
    is_valid_isbn,
    parse_goodreads_csv,
)


def _csv_bytes(rows: list[dict[str, str]]) -> bytes:
    headers = [
        "Book Id",
        "Title",
        "Author",
        "Author l-f",
        "Additional Authors",
        "ISBN",
        "ISBN13",
        "My Rating",
        "Average Rating",
        "Publisher",
        "Binding",
        "Number of Pages",
        "Year Published",
        "Original Publication Year",
        "Date Read",
        "Date Added",
        "Bookshelves",
        "Bookshelves with positions",
        "Exclusive Shelf",
        "My Review",
        "Spoiler",
        "Private Notes",
        "Read Count",
        "Owned Copies",
    ]
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=headers)
    writer.writeheader()
    for row in rows:
        writer.writerow(row)
    return output.getvalue().encode("utf-8")


def test_parse_goodreads_csv_success() -> None:
    result = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book One",
                    "Author": "Author A",
                    "Additional Authors": "Author B, author a",
                    "ISBN": '="1662603282"',
                    "ISBN13": '="9781662603280"',
                    "My Rating": "4",
                    "Date Read": "2024/01/05",
                    "Date Added": "2024/01/02",
                    "Bookshelves": "favorites,read,Favorites",
                    "Exclusive Shelf": "read",
                    "My Review": "Great read!",
                    "Read Count": "2",
                }
            ]
        )
    )
    assert len(result.rows) == 1
    assert result.issues == []
    row = result.rows[0]
    assert row.book_id == "123"
    assert row.status == "completed"
    assert row.uid == "9781662603280"
    assert row.rating_10 == 8
    assert row.rating_5 == 4
    assert row.tags == ["favorites"]
    assert row.authors == ["Author A", "Author B"]
    assert row.review == "Great read!"


def test_parse_goodreads_csv_uses_bookshelf_fallback_for_status() -> None:
    parsed = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book One",
                    "Author": "Author A",
                    "Bookshelves": "to-read,own",
                    "Exclusive Shelf": "",
                }
            ]
        )
    )
    assert parsed.rows[0].status == "to_read"
    assert parsed.rows[0].tags == ["own"]


def test_parse_goodreads_csv_missing_columns() -> None:
    raw = b"Title,Author\nOnly,Me\n"
    with pytest.raises(GoodreadsCsvError, match="missing required columns"):
        parse_goodreads_csv(raw)


def test_parse_goodreads_csv_invalid_status() -> None:
    parsed = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book One",
                    "Author": "Author A",
                    "Exclusive Shelf": "someday",
                    "Bookshelves": "wishlist",
                }
            ]
        )
    )
    assert parsed.rows == []
    assert len(parsed.issues) == 1
    assert "unsupported read status" in parsed.issues[0].message


def test_parse_goodreads_csv_invalid_date_and_rating() -> None:
    invalid_date = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book One",
                    "Author": "Author A",
                    "Exclusive Shelf": "read",
                    "Date Added": "2024-01-02",
                }
            ]
        )
    )
    assert invalid_date.rows == []
    assert len(invalid_date.issues) == 1
    assert "invalid date" in invalid_date.issues[0].message

    invalid_rating = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book One",
                    "Author": "Author A",
                    "Exclusive Shelf": "read",
                    "My Rating": "10",
                }
            ]
        )
    )
    assert invalid_rating.rows == []
    assert len(invalid_rating.issues) == 1
    assert "invalid rating" in invalid_rating.issues[0].message


def test_parse_goodreads_csv_requires_title_and_authors() -> None:
    missing_title = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "",
                    "Author": "Author A",
                    "Exclusive Shelf": "read",
                }
            ]
        )
    )
    assert missing_title.rows == []
    assert len(missing_title.issues) == 1
    assert "title is required" in missing_title.issues[0].message

    missing_authors = parse_goodreads_csv(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "Book",
                    "Author": "",
                    "Exclusive Shelf": "read",
                }
            ]
        )
    )
    assert missing_authors.rows == []
    assert len(missing_authors.issues) == 1
    assert "authors are required" in missing_authors.issues[0].message


def test_parse_goodreads_csv_applies_overrides() -> None:
    parsed = parse_goodreads_csv(
        _csv_bytes(
            [{"Book Id": "123", "Title": "", "Author": "", "Exclusive Shelf": ""}]
        ),
        author_overrides={2: "Author A"},
        title_overrides={2: "Recovered Title"},
        shelf_overrides={2: "read"},
    )
    assert len(parsed.rows) == 1
    assert parsed.rows[0].title == "Recovered Title"
    assert parsed.rows[0].authors == ["Author A"]
    assert parsed.rows[0].status == "completed"


def test_find_missing_required_fields() -> None:
    missing = find_missing_required_fields(
        _csv_bytes(
            [
                {
                    "Book Id": "123",
                    "Title": "",
                    "Author": "",
                    "Exclusive Shelf": "",
                    "Bookshelves": "wishlist",
                    "ISBN13": '="9781234567890"',
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
    assert "Book Id" in REQUIRED_COLUMNS
    assert "My Review" in REQUIRED_COLUMNS


def test_parse_goodreads_csv_rejects_non_utf8_bytes() -> None:
    with pytest.raises(GoodreadsCsvError, match="utf-8"):
        parse_goodreads_csv(b"\xff\xfe\x00")
