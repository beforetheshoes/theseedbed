from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections import defaultdict
from typing import Any, cast

import pytest

from app.db.models.bibliography import Edition, Work
from app.db.models.external_provider import ExternalId, SourceRecord
from app.services.google_books import (
    GoogleBooksSearchResponse,
    GoogleBooksSearchResult,
    GoogleBooksWorkBundle,
)
from app.services.open_library import OpenLibraryWorkBundle
from app.services.work_metadata_enrichment import (
    _add_candidate,
    _author_match_score,
    _author_search_variants,
    _best_google_bundles,
    _build_fields_payload,
    _display_value,
    _edition_label,
    _ensure_google_external_ids,
    _ensure_openlibrary_external_ids,
    _first_author_name,
    _get_google_work_volume_id,
    _get_openlibrary_work_key,
    _get_work,
    _google_bundle_richness,
    _google_source_label,
    _is_relevant_google_bundle,
    _isbn_match_score,
    _list_isbn_queries,
    _normalize_isbn,
    _normalize_match_text,
    _normalize_publish_date,
    _normalize_selection_value,
    _normalize_year,
    _resolve_openlibrary_work_key,
    _resolve_target_edition,
    _source_label,
    _title_match_score,
    _upsert_source_record,
    _value_signature,
    apply_enrichment_selections,
    get_enrichment_candidates,
)


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.get_map: dict[tuple[type[Any], Any], Any] = {}
        self.commits = 0
        self.added: list[Any] = []

    def scalar(self, _stmt: object) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def get(self, model: type[Any], ident: Any) -> Any:
        return self.get_map.get((model, ident))

    def add(self, obj: Any) -> None:
        self.added.append(obj)

    def commit(self) -> None:
        self.commits += 1


class FakeOpenLibrary:
    def __init__(self, bundle: OpenLibraryWorkBundle) -> None:
        self.bundle = bundle

    async def fetch_work_bundle(
        self, *, work_key: str, edition_key: str | None = None
    ) -> OpenLibraryWorkBundle:
        assert work_key.startswith("/works/")
        _ = edition_key
        return self.bundle


class FakeGoogleBooks:
    def __init__(self, bundles_by_volume: dict[str, GoogleBooksWorkBundle]) -> None:
        self.bundles_by_volume = bundles_by_volume

    async def search_books(
        self,
        *,
        query: str,
        limit: int,
        page: int,
        author: str | None = None,
        subject: str | None = None,
        language: str | None = None,
        first_publish_year_from: int | None = None,
        first_publish_year_to: int | None = None,
        sort: str = "relevance",
    ) -> GoogleBooksSearchResponse:
        _ = (
            query,
            limit,
            page,
            author,
            subject,
            language,
            first_publish_year_from,
            first_publish_year_to,
            sort,
        )
        items = [
            GoogleBooksSearchResult(
                volume_id=volume_id,
                title=bundle.title,
                author_names=bundle.authors,
                first_publish_year=bundle.first_publish_year,
                cover_url=bundle.cover_url,
                language=(
                    (bundle.edition or {}).get("language") if bundle.edition else None
                ),
                readable=True,
                attribution_url=bundle.attribution_url,
            )
            for volume_id, bundle in self.bundles_by_volume.items()
        ]
        return GoogleBooksSearchResponse(
            items=items,
            query="q",
            limit=limit,
            page=page,
            num_found=len(items),
            has_more=False,
            next_page=None,
            cache_hit=False,
        )

    async def fetch_work_bundle(self, *, volume_id: str) -> GoogleBooksWorkBundle:
        return self.bundles_by_volume[volume_id]


class FakeOpenLibraryResolver:
    def __init__(
        self,
        *,
        isbn_map: dict[str, str] | None = None,
        search_items: list[Any] | None = None,
        search_items_by_author: dict[str, list[Any]] | None = None,
    ) -> None:
        self.isbn_map = isbn_map or {}
        self.search_items = search_items or []
        self.search_items_by_author = search_items_by_author or {}
        self.search_calls: list[dict[str, Any]] = []

    async def find_work_key_by_isbn(self, *, isbn: str) -> str | None:
        return self.isbn_map.get(isbn)

    async def search_books(self, **kwargs: Any) -> Any:
        self.search_calls.append(kwargs)
        author = kwargs.get("author") or ""
        items = self.search_items_by_author.get(author, self.search_items)
        return type("Resp", (), {"items": items})()


def _openlibrary_bundle(*, include_edition: bool = True) -> OpenLibraryWorkBundle:
    return OpenLibraryWorkBundle(
        work_key="/works/OL1W",
        title="Book",
        description="A",
        first_publish_year=1999,
        cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        authors=[{"key": "/authors/OL1A", "name": "Author"}],
        edition=(
            {
                "key": "/books/OL1M",
                "publisher": "Pub",
                "publish_date": "2001-01-01",
                "publish_date_iso": dt.date(2001, 1, 1),
                "isbn10": "1234567890",
                "isbn13": "9781234567890",
                "language": "eng",
                "format": "paperback",
            }
            if include_edition
            else None
        ),
        raw_work={"key": "/works/OL1W"},
        raw_edition={"key": "/books/OL1M"} if include_edition else None,
    )


def _google_bundle(
    volume_id: str,
    *,
    description: str,
    title: str = "Book",
    authors: list[str] | None = None,
    edition: dict[str, Any] | None = None,
) -> GoogleBooksWorkBundle:
    return GoogleBooksWorkBundle(
        volume_id=volume_id,
        title=title,
        description=description,
        first_publish_year=2001,
        cover_url="https://books.google.com/cover.jpg",
        authors=authors or ["Author"],
        edition=(
            edition
            if edition is not None
            else {
                "publisher": "Google Pub",
                "publish_date_iso": dt.date(2002, 2, 2),
                "isbn10": "0123456789",
                "isbn13": "9780123456789",
                "language": "en",
                "format": "book",
            }
        ),
        raw_volume={"id": volume_id},
        attribution_url="https://books.google.com",
    )


def test_get_work_helpers() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    session.get_map[(Work, work_id)] = work
    session.scalar_values = ["/works/OL1W", "gb1", "Author A"]

    assert _get_work(cast(Any, session), work_id=work_id) is work
    assert (
        _get_openlibrary_work_key(cast(Any, session), work_id=work_id) == "/works/OL1W"
    )
    assert _get_google_work_volume_id(cast(Any, session), work_id=work_id) == "gb1"
    assert _first_author_name(cast(Any, session), work_id=work_id) == "Author A"


def test_get_work_raises_when_missing() -> None:
    session = FakeSession()
    with pytest.raises(LookupError):
        _get_work(cast(Any, session), work_id=uuid.uuid4())


def test_edition_label_and_normalizers() -> None:
    session = FakeSession()
    edition = Edition(
        id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        publisher="Pub",
        publish_date=dt.date(2020, 1, 1),
        isbn13="9780123456789",
    )
    session.scalar_values = ["/books/OL1M", None]

    assert _edition_label(cast(Any, session), edition=edition) == (
        "Pub | 2020-01-01 | ISBN 9780123456789 | Open Library OL1M"
    )
    edition.publisher = None
    edition.publish_date = None
    edition.isbn13 = None
    edition.isbn10 = None
    assert _edition_label(cast(Any, session), edition=edition) == "Edition"

    assert _normalize_isbn("978-0123456789", length=13) == "9780123456789"
    assert _normalize_isbn("bad", length=10) is None
    assert _normalize_year(2001) == 2001
    assert _normalize_year("2002") == 2002
    assert _normalize_year("10000") is None
    assert _normalize_publish_date("2020-01-02") == dt.date(2020, 1, 2)
    assert _normalize_publish_date("not-a-date") is None
    assert _display_value("edition.publish_date", dt.date(2020, 1, 3)) == "2020-01-03"
    assert _value_signature("edition.publish_date", "2020-01-03") == "2020-01-03"
    assert _source_label("openlibrary", "/books/OL1M") == "Open Library OL1M"
    assert _source_label("googlebooks", "gb1") == "Google Books gb1"


def test_upsert_source_record_create_and_update() -> None:
    session = FakeSession()
    _upsert_source_record(
        cast(Any, session),
        provider="openlibrary",
        entity_type="work",
        provider_id="/works/OL1W",
        raw={"a": 1},
    )
    assert len(session.added) == 1
    created = session.added[0]
    assert isinstance(created, SourceRecord)
    assert created.provider_id == "/works/OL1W"

    existing = SourceRecord(
        provider="openlibrary",
        entity_type="work",
        provider_id="/works/OL1W",
        raw={"a": 1},
    )
    session.scalar_values = [existing]
    _upsert_source_record(
        cast(Any, session),
        provider="openlibrary",
        entity_type="work",
        provider_id="/works/OL1W",
        raw={"a": 2},
    )
    assert existing.raw == {"a": 2}


def test_ensure_google_external_ids_add_and_skip() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    session.scalar_values = [None, None, None, None]
    _ensure_google_external_ids(
        cast(Any, session),
        work_id=work_id,
        edition_id=edition_id,
        volume_id="gb1",
    )
    assert any(
        isinstance(item, ExternalId) and item.entity_type == "work"
        for item in session.added
    )
    assert any(
        isinstance(item, ExternalId) and item.entity_type == "edition"
        for item in session.added
    )

    session = FakeSession()
    session.scalar_values = [object(), object()]
    _ensure_google_external_ids(
        cast(Any, session),
        work_id=work_id,
        edition_id=edition_id,
        volume_id="gb1",
    )
    assert session.added == []

    session = FakeSession()
    session.scalar_values = [None, None]
    _ensure_google_external_ids(
        cast(Any, session),
        work_id=work_id,
        edition_id=None,
        volume_id="gb2",
    )
    assert len(session.added) == 1
    assert isinstance(session.added[0], ExternalId)
    assert session.added[0].entity_type == "work"


def test_ensure_openlibrary_external_ids_adds_when_missing() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    session.scalar_values = [None, None, None, None]

    _ensure_openlibrary_external_ids(
        cast(Any, session),
        work_id=work_id,
        edition_id=edition_id,
        work_key="/works/OL1W",
        edition_key="/books/OL1M",
    )

    assert any(
        isinstance(item, ExternalId) and item.entity_type == "work"
        for item in session.added
    )
    assert any(
        isinstance(item, ExternalId) and item.entity_type == "edition"
        for item in session.added
    )


def test_list_isbn_queries_prefers_target_and_dedupes() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition = Edition(
        id=uuid.uuid4(),
        work_id=work_id,
        isbn10="0-8044-2957-X",
        isbn13="978-0123456789",
    )

    def _execute(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return [
                    ("9780123456789", None),
                    (None, "080442957X"),
                    ("not-isbn", "123"),
                ]

        return _Res()

    session.execute = _execute  # type: ignore[attr-defined]
    values = _list_isbn_queries(
        cast(Any, session), work_id=work_id, edition_target=edition
    )
    assert values == ["9780123456789", "080442957X"]


def test_resolve_openlibrary_work_key_uses_existing_mapping() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    session.scalar_values = ["/works/OL1W"]

    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=work,
            work_id=work_id,
            edition_target=None,
            first_author="Author",
            open_library=cast(Any, FakeOpenLibraryResolver()),
        )
    )

    assert key == "/works/OL1W"


def test_resolve_openlibrary_work_key_uses_isbn_and_title_search() -> None:
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")

    session = FakeSession()
    session.scalar_values = [None]

    def _execute_empty(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return []

        return _Res()

    session.execute = _execute_empty  # type: ignore[attr-defined]
    resolver = FakeOpenLibraryResolver(
        isbn_map={"9780123456789": "/works/OL2W"},
        search_items=[],
    )
    edition = Edition(id=uuid.uuid4(), work_id=work_id, isbn13="9780123456789")
    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=work,
            work_id=work_id,
            edition_target=edition,
            first_author="Author",
            open_library=cast(Any, resolver),
        )
    )
    assert key == "/works/OL2W"

    session = FakeSession()
    session.scalar_values = [None]
    session.execute = _execute_empty  # type: ignore[attr-defined]
    search_items = [
        type(
            "Item",
            (),
            {
                "work_key": "/works/OL3W",
                "title": "Book",
                "author_names": ["Author"],
            },
        )()
    ]
    resolver = FakeOpenLibraryResolver(isbn_map={}, search_items=search_items)
    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=work,
            work_id=work_id,
            edition_target=None,
            first_author="Author",
            open_library=cast(Any, resolver),
        )
    )
    assert key == "/works/OL3W"

    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=Work(id=work_id, title=" "),
            work_id=work_id,
            edition_target=None,
            first_author="Author",
            open_library=cast(Any, resolver),
        )
    )
    assert key is None


def test_add_candidate_and_build_payload() -> None:
    candidates_by_field: dict[str, list[dict[str, Any]]] = defaultdict(list)
    seen: set[tuple[str, str, str, str]] = set()
    _add_candidate(
        field_key="work.description",
        provider="openlibrary",
        provider_id="/works/OL1W",
        value="A",
        candidates_by_field=candidates_by_field,
        seen=cast(Any, seen),
    )
    _add_candidate(
        field_key="work.description",
        provider="openlibrary",
        provider_id="/works/OL1W",
        value="A",
        candidates_by_field=candidates_by_field,
        seen=cast(Any, seen),
    )
    _add_candidate(
        field_key="work.description",
        provider="googlebooks",
        provider_id="gb1",
        value="B",
        candidates_by_field=candidates_by_field,
        seen=cast(Any, seen),
    )
    _add_candidate(
        field_key="unknown",
        provider="openlibrary",
        provider_id="/works/OL1W",
        value="Z",
        candidates_by_field=candidates_by_field,
        seen=cast(Any, seen),
    )
    _add_candidate(
        field_key="work.description",
        provider="openlibrary",
        provider_id="/works/OL1W",
        value=None,
        candidates_by_field=candidates_by_field,
        seen=cast(Any, seen),
    )
    assert len(candidates_by_field["work.description"]) == 2

    fields = _build_fields_payload(
        current={"work.description": "Current"},
        candidates_by_field=candidates_by_field,
    )
    description_field = next(
        field for field in fields if field["field_key"] == "work.description"
    )
    assert description_field["has_conflict"] is True


def test_resolve_target_edition_with_explicit_id_paths() -> None:
    work_id = uuid.uuid4()
    explicit_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        _resolve_target_edition(
            cast(Any, session),
            work_id=work_id,
            user_id=uuid.uuid4(),
            edition_id=explicit_id,
        )

    explicit = Edition(id=explicit_id, work_id=work_id)
    session = FakeSession()
    session.scalar_values = [explicit]
    assert (
        _resolve_target_edition(
            cast(Any, session),
            work_id=work_id,
            user_id=uuid.uuid4(),
            edition_id=explicit_id,
        )
        is explicit
    )


def test_normalizers_extra_branches() -> None:
    assert _normalize_isbn(123, length=10) is None
    assert _normalize_publish_date(123) is None
    assert _value_signature("work.description", None) == "null"
    assert _normalize_match_text(None) == ""
    assert _normalize_match_text("The Book: Vol. 2!") == "the book vol 2"
    assert _normalize_year("oops") is None
    assert _display_value("work.description", None) == ""


def test_resolve_target_edition_prefers_user_preference() -> None:
    session = FakeSession()
    preferred = uuid.uuid4()
    edition = Edition(id=preferred, work_id=uuid.uuid4())
    session.scalar_values = [preferred, edition]

    result = _resolve_target_edition(
        cast(Any, session),
        work_id=edition.work_id,
        user_id=uuid.uuid4(),
        edition_id=None,
    )

    assert result is edition


def test_resolve_target_edition_falls_back_to_latest() -> None:
    session = FakeSession()
    latest = Edition(id=uuid.uuid4(), work_id=uuid.uuid4())
    session.scalar_values = [None, latest]

    result = _resolve_target_edition(
        cast(Any, session),
        work_id=latest.work_id,
        user_id=uuid.uuid4(),
        edition_id=None,
    )

    assert result is latest


def test_get_enrichment_candidates_builds_conflicts_and_dedupes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition = Edition(id=uuid.uuid4(), work_id=work_id, publisher="Existing")
    work = Work(
        id=work_id, title="Book", description="Current", first_publish_year=1980
    )

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Author",
    )

    bundles = {
        "gb1": _google_bundle("gb1", description="A"),
        "gb2": _google_bundle("gb2", description="B"),
    }
    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks(bundles)),
            google_enabled=True,
        )
    )

    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    assert description_field["has_conflict"] is True
    # Open Library + strict Google match + relevant Google fallback.
    assert len(description_field["candidates"]) == 3
    google_candidates = [
        item
        for item in description_field["candidates"]
        if item["provider"] == "googlebooks"
    ]
    assert {item["provider_id"] for item in google_candidates} == {"gb1", "gb2"}
    assert payload["providers"]["succeeded"] == ["openlibrary", "googlebooks"]


def test_get_enrichment_candidates_filters_unrelated_google_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition = Edition(id=uuid.uuid4(), work_id=work_id)
    work = Work(id=work_id, title="Book", description="Current")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Author",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(
                Any,
                FakeGoogleBooks(
                    {
                        "good": _google_bundle("good", description="Good"),
                        "bad": _google_bundle(
                            "bad",
                            description="Wrong",
                            title="Different Book Entirely",
                            authors=["Someone Else"],
                        ),
                    }
                ),
            ),
            google_enabled=True,
        )
    )

    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    google_candidates = [
        candidate
        for candidate in description_field["candidates"]
        if candidate["provider"] == "googlebooks"
    ]
    assert len(google_candidates) == 1
    assert google_candidates[0]["provider_id"] == "good"


def test_apply_enrichment_selections_updates_and_skips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )

    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.first_publish_year",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": "2005",
                },
                {
                    "field_key": "edition.publisher",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "Pub",
                },
                {
                    "field_key": "edition.isbn10",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "bad",
                },
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )

    assert work.first_publish_year == 2005
    assert "work.first_publish_year" in result["updated"]
    assert {"field_key": "edition.publisher", "reason": "target_missing"} in result[
        "skipped"
    ]
    assert {"field_key": "edition.isbn10", "reason": "target_missing"} in result[
        "skipped"
    ]


def test_apply_enrichment_persists_google_provenance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=edition_id, work_id=work_id)
    tracked_source_records: list[tuple[str, str, str]] = []
    tracked_external_ids: list[str] = []

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )

    def _capture_source(
        _session: Any,
        *,
        provider: str,
        entity_type: str,
        provider_id: str,
        raw: dict[str, Any],
    ) -> None:
        _ = raw
        tracked_source_records.append((provider, entity_type, provider_id))

    def _capture_external(
        _session: Any,
        *,
        work_id: uuid.UUID,
        edition_id: uuid.UUID | None,
        volume_id: str,
    ) -> None:
        _ = (work_id, edition_id)
        tracked_external_ids.append(volume_id)

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._upsert_source_record", _capture_source
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._ensure_google_external_ids",
        _capture_external,
    )

    google = FakeGoogleBooks({"gb1": _google_bundle("gb1", description="Desc")})
    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.description",
                    "provider": "googlebooks",
                    "provider_id": "gb1",
                    "value": "Desc",
                }
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, google),
            google_enabled=True,
        )
    )

    assert result["updated"] == ["work.description"]
    assert ("googlebooks", "work", "gb1") in tracked_source_records
    assert ("googlebooks", "edition", "gb1") in tracked_source_records
    assert tracked_external_ids == ["gb1"]


def test_apply_enrichment_persists_openlibrary_provenance_without_existing_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=edition_id, work_id=work_id)
    tracked_source_records: list[tuple[str, str, str]] = []
    tracked_external_ids: list[tuple[str, str | None]] = []

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: None,
    )

    def _capture_source(
        _session: Any,
        *,
        provider: str,
        entity_type: str,
        provider_id: str,
        raw: dict[str, Any],
    ) -> None:
        _ = raw
        tracked_source_records.append((provider, entity_type, provider_id))

    def _capture_external(
        _session: Any,
        *,
        work_id: uuid.UUID,
        edition_id: uuid.UUID | None,
        work_key: str,
        edition_key: str | None,
    ) -> None:
        _ = (work_id, edition_id)
        tracked_external_ids.append((work_key, edition_key))

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._upsert_source_record", _capture_source
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._ensure_openlibrary_external_ids",
        _capture_external,
    )

    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.description",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL999W",
                    "value": "Desc",
                }
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )

    assert result["updated"] == ["work.description"]
    assert ("openlibrary", "work", "/works/OL1W") in tracked_source_records
    assert ("openlibrary", "edition", "/books/OL1M") in tracked_source_records
    assert tracked_external_ids == [("/works/OL1W", "/books/OL1M")]


def test_get_enrichment_candidates_handles_missing_openlibrary_mapping(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: None,
    )

    async def _no_match(**_kwargs: Any) -> str | None:
        return None

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_openlibrary_work_key",
        _no_match,
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )
    assert payload["providers"]["failed"] == [
        {
            "provider": "openlibrary",
            "code": "openlibrary_match_not_found",
            "message": "No Open Library match found for this work.",
        }
    ]


def test_get_enrichment_candidates_records_google_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)

    class BoomGoogle(FakeGoogleBooks):
        async def search_books(self, **_kwargs: Any) -> GoogleBooksSearchResponse:
            raise RuntimeError("down")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: None,
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, BoomGoogle({})),
            google_enabled=True,
        )
    )
    assert payload["providers"]["failed"][0]["provider"] == "googlebooks"


def test_get_enrichment_candidates_records_openlibrary_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)

    async def _boom(**_kwargs: Any) -> str | None:
        raise RuntimeError("ol down")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_openlibrary_work_key",
        _boom,
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )
    assert payload["providers"]["failed"][0]["provider"] == "openlibrary"
    assert payload["providers"]["failed"][0]["code"] == "open_library_unavailable"


def test_normalize_selection_value_variants() -> None:
    assert _normalize_selection_value("work.description", " Desc ") == "Desc"
    assert _normalize_selection_value("work.description", 123) is None
    assert _normalize_selection_value("edition.publish_date", "2020-01-01") == dt.date(
        2020, 1, 1
    )
    assert _normalize_selection_value("edition.isbn10", "0123456789") == "0123456789"
    assert _normalize_selection_value("edition.isbn13", "bad") is None
    assert _normalize_selection_value("unknown", "x") is None


def test_apply_enrichment_openlibrary_selection_skips_without_work_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: None,
    )

    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.description",
                    "provider": "openlibrary",
                    "provider_id": "/books/OLX",
                    "value": "Desc",
                }
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )
    assert result["updated"] == ["work.description"]


def test_google_matching_helpers_and_labels() -> None:
    target = Edition(
        id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        isbn10="0123456789",
        isbn13="9780123456789",
    )
    work = Work(id=uuid.uuid4(), title="The Book")
    strong = _google_bundle(
        "good",
        description="desc",
        title="The Book",
        authors=["Jane Author"],
    )
    weak = _google_bundle(
        "bad",
        description="desc",
        title="Different Title",
        authors=["Nobody"],
        edition={"isbn13": "9780000000000"},
    )
    isbn = _google_bundle(
        "isbn",
        description="desc",
        title="Completely Different",
        authors=["Nobody"],
        edition={"isbn13": "9780123456789"},
    )
    assert _title_match_score("The Book", "The Book") == 4
    assert _title_match_score("The Book", "The Book: Special Edition") >= 3
    assert _title_match_score("The Book", "Book The") >= 2
    assert _title_match_score("The Book", "Another Story") == 0
    assert _title_match_score("", "Another Story") == 0

    assert _author_match_score(expected_author=None, candidate_authors=[]) == 1
    assert _author_match_score(expected_author="Jane Author", candidate_authors=[]) == 0
    assert (
        _author_match_score(
            expected_author="Jane Author",
            candidate_authors=["Jane Author"],
        )
        == 3
    )
    assert (
        _author_match_score(
            expected_author="Jane Author",
            candidate_authors=["Jane A."],
        )
        >= 2
    )
    assert (
        _author_match_score(
            expected_author="Jane Author",
            candidate_authors=["", "Other Person"],
        )
        == 0
    )
    assert (
        _author_match_score(
            expected_author="R.F. Kuang",
            candidate_authors=["Rebecca Kuang"],
        )
        >= 2
    )
    assert (
        _author_match_score(
            expected_author="R.F. Kuang",
            candidate_authors=["R. F. Kuang"],
        )
        == 3
    )
    assert (
        _author_match_score(
            expected_author="Alpha Beta Gamma Kuang",
            candidate_authors=["Alpha Beta Gamma Wong"],
        )
        == 2
    )
    assert "r f kuang" in _author_search_variants("R.F. Kuang")
    assert "kuang" in _author_search_variants("R.F. Kuang")

    assert (
        _isbn_match_score(
            target_edition=target,
            candidate_edition={"isbn13": "9780123456789"},
        )
        == 5
    )
    assert (
        _isbn_match_score(
            target_edition=target,
            candidate_edition={"isbn10": "0123456789"},
        )
        == 4
    )
    assert (
        _isbn_match_score(
            target_edition=target,
            candidate_edition={"isbn13": "9780000000000"},
        )
        == 0
    )
    assert (
        _isbn_match_score(target_edition=None, candidate_edition={"isbn13": "x"}) == 0
    )

    assert _is_relevant_google_bundle(
        work=work,
        first_author="Jane Author",
        edition_target=target,
        bundle=strong,
    )
    assert not _is_relevant_google_bundle(
        work=work,
        first_author="Jane Author",
        edition_target=target,
        bundle=weak,
    )

    assert _is_relevant_google_bundle(
        work=work,
        first_author="Someone Else",
        edition_target=target,
        bundle=isbn,
    )

    assert _google_source_label(strong) == "Google Books The Book (good)"
    strong_with_empty_title = GoogleBooksWorkBundle(
        volume_id="raw-id",
        title="",
        description=None,
        first_publish_year=None,
        cover_url=None,
        authors=[],
        edition=None,
        raw_volume={},
        attribution_url=None,
    )
    assert _google_source_label(strong_with_empty_title) == "Google Books raw-id"


def test_best_google_bundles_falls_back_to_title_matches_when_author_mismatch() -> None:
    work = Work(id=uuid.uuid4(), title="Slow Down")
    bundles = [
        _google_bundle(
            "rich",
            description="Rich metadata",
            title="Slow Down",
            authors=["Different Person"],
            edition={"publisher": "Pub", "language": "en"},
        ),
        _google_bundle(
            "other",
            description="Other metadata",
            title="Slow Down: A Guide",
            authors=["Unknown"],
        ),
        _google_bundle(
            "bad",
            description="Not related",
            title="Completely Different",
            authors=["Kohei Saito"],
        ),
    ]
    selected = _best_google_bundles(
        work=work,
        first_author="Kohei Saito",
        edition_target=None,
        bundles=bundles,
    )
    assert [bundle.volume_id for bundle in selected] == ["rich", "other"]


def test_best_google_bundles_keeps_strict_first_and_includes_relevant_fallbacks() -> (
    None
):
    work = Work(id=uuid.uuid4(), title="Book")
    target = Edition(
        id=uuid.uuid4(),
        work_id=work.id,
        isbn13="9780123456789",
    )
    strict = _google_bundle(
        "strict",
        description="d",
        title="Completely Different",
        authors=["Someone Else"],
        edition={
            "publisher": "Pub",
            "publish_date_iso": dt.date(2020, 1, 1),
            "isbn10": "0123456789",
            "isbn13": "9780123456789",
            "language": "en",
            "format": "paperback",
        },
    )
    fallback = _google_bundle(
        "fallback",
        description="d",
        title="Book",
        authors=["Else"],
        edition={"isbn13": "9780000000000"},
    )
    selected = _best_google_bundles(
        work=work,
        first_author="Author",
        edition_target=target,
        bundles=[fallback, strict],
    )
    assert [bundle.volume_id for bundle in selected] == ["strict", "fallback"]


def test_best_google_bundles_keeps_fallback_when_strict_match_is_sparse() -> None:
    work = Work(id=uuid.uuid4(), title="Slow Down")
    target = Edition(
        id=uuid.uuid4(),
        work_id=work.id,
        isbn13="9780123456789",
    )
    strict_sparse = _google_bundle(
        "strict-sparse",
        description="",
        title="Different title",
        authors=["Unknown"],
        edition={"isbn13": "9780123456789"},
    )
    fallback_rich = _google_bundle(
        "fallback-rich",
        description="Rich metadata",
        title="Slow Down",
        authors=["Someone Else"],
        edition={
            "publisher": "Big Pub",
            "publish_date_iso": dt.date(2024, 1, 1),
            "language": "en",
        },
    )
    selected = _best_google_bundles(
        work=work,
        first_author="Kohei Saito",
        edition_target=target,
        bundles=[strict_sparse, fallback_rich],
    )
    assert [bundle.volume_id for bundle in selected] == [
        "strict-sparse",
        "fallback-rich",
    ]


def test_best_google_bundles_filters_single_token_substring_matches() -> None:
    work = Work(id=uuid.uuid4(), title="Book")
    selected = _best_google_bundles(
        work=work,
        first_author="No Match",
        edition_target=None,
        bundles=[
            _google_bundle(
                "bad",
                description="desc",
                title="Different Book Entirely",
                authors=["Else"],
            ),
            _google_bundle(
                "good",
                description="desc",
                title="Book: Subtitle",
                authors=["Else"],
            ),
        ],
    )
    assert [bundle.volume_id for bundle in selected] == ["good"]


def test_best_google_bundles_returns_empty_for_no_candidates() -> None:
    work = Work(id=uuid.uuid4(), title="Book")
    selected = _best_google_bundles(
        work=work,
        first_author="Author",
        edition_target=None,
        bundles=[],
    )
    assert selected == []


def test_best_google_bundles_respects_limit_with_multiple_fallbacks() -> None:
    work = Work(id=uuid.uuid4(), title="Slow Down")
    selected = _best_google_bundles(
        work=work,
        first_author="Mismatch Name",
        edition_target=None,
        bundles=[
            _google_bundle(
                "one", description="a", title="Slow Down", authors=["Unknown"]
            ),
            _google_bundle(
                "two",
                description="b",
                title="Slow Down: Expanded",
                authors=["Unknown"],
            ),
            _google_bundle(
                "three",
                description="c",
                title="Slow Down Companion",
                authors=["Unknown"],
            ),
        ],
        limit=2,
    )
    assert [bundle.volume_id for bundle in selected] == ["one", "two"]


def test_google_bundle_richness_counts_available_fields() -> None:
    bundle = _google_bundle(
        "richness",
        description="desc",
        title="Book",
        authors=["Author"],
        edition={
            "publisher": "Pub",
            "publish_date_iso": dt.date(2020, 1, 1),
            "isbn10": "0123456789",
            "isbn13": "9780123456789",
            "language": "en",
            "format": "paperback",
        },
    )
    assert _google_bundle_richness(bundle) == 9


def test_get_enrichment_candidates_handles_openlibrary_without_edition(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    bundle = _openlibrary_bundle(include_edition=False)

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(bundle)),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )

    assert payload["providers"]["attempted"] == ["openlibrary"]
    assert payload["providers"]["succeeded"] == ["openlibrary"]


def test_get_enrichment_candidates_includes_google_rich_fallback_when_openlibrary_is_sparse(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Slow Down")
    ol_sparse = _openlibrary_bundle(include_edition=False)
    ol_sparse = OpenLibraryWorkBundle(
        work_key=ol_sparse.work_key,
        title=ol_sparse.title,
        description=None,
        first_publish_year=ol_sparse.first_publish_year,
        cover_url=None,
        authors=ol_sparse.authors,
        edition=None,
        raw_work=ol_sparse.raw_work,
        raw_edition=None,
    )

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Kohei Saito",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(ol_sparse)),
            google_books=cast(
                Any,
                FakeGoogleBooks(
                    {
                        "gb-rich": _google_bundle(
                            "gb-rich",
                            description="Rich description",
                            title="Slow Down",
                            authors=["Someone Else"],
                            edition={"publisher": "Pub", "language": "en"},
                        )
                    }
                ),
            ),
            google_enabled=True,
        )
    )
    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    google_candidates = [
        candidate
        for candidate in description_field["candidates"]
        if candidate["provider"] == "googlebooks"
    ]
    assert len(google_candidates) == 1
    assert google_candidates[0]["value"] == "Rich description"


def test_get_enrichment_candidates_uses_mapped_google_volume(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_google_work_volume_id",
        lambda *_args, **_kwargs: "mapped",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Author",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(
                Any,
                FakeGoogleBooks(
                    {"mapped": _google_bundle("mapped", description="Desc")}
                ),
            ),
            google_enabled=True,
        )
    )

    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    assert any(
        item["provider"] == "googlebooks" and item["provider_id"] == "mapped"
        for item in description_field["candidates"]
    )


def test_get_enrichment_candidates_with_mapped_google_volume_still_includes_search_fallbacks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Slow Down")

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: None,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_google_work_volume_id",
        lambda *_args, **_kwargs: "mapped-sparse",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Kohei Saito",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(
                Any,
                FakeGoogleBooks(
                    {
                        "mapped-sparse": _google_bundle(
                            "mapped-sparse",
                            description="",
                            title="Slow Down",
                            authors=["Kohei Saito"],
                            edition={"isbn13": "9780000000000"},
                        ),
                        "gb-rich": _google_bundle(
                            "gb-rich",
                            description="Rich description",
                            title="Slow Down",
                            authors=["Rebecca Kuang"],
                            edition={"publisher": "Pub", "language": "en"},
                        ),
                    }
                ),
            ),
            google_enabled=True,
        )
    )

    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    candidate_ids = [
        candidate["provider_id"]
        for candidate in description_field["candidates"]
        if candidate["provider"] == "googlebooks"
    ]
    assert "gb-rich" in candidate_ids


def test_apply_enrichment_validation_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: Edition(id=uuid.uuid4(), work_id=work_id),
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )

    with pytest.raises(ValueError):
        asyncio.run(
            apply_enrichment_selections(
                cast(Any, session),
                user_id=uuid.uuid4(),
                work_id=work_id,
                selections=[cast(Any, "bad")],
                edition_id=None,
                open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
                google_books=cast(Any, FakeGoogleBooks({})),
                google_enabled=False,
            )
        )

    with pytest.raises(ValueError):
        asyncio.run(
            apply_enrichment_selections(
                cast(Any, session),
                user_id=uuid.uuid4(),
                work_id=work_id,
                selections=[
                    {
                        "field_key": "work.description",
                        "provider": "bad-provider",
                        "provider_id": "/works/OL1W",
                        "value": "x",
                    }
                ],
                edition_id=None,
                open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
                google_books=cast(Any, FakeGoogleBooks({})),
                google_enabled=False,
            )
        )

    with pytest.raises(ValueError):
        asyncio.run(
            apply_enrichment_selections(
                cast(Any, session),
                user_id=uuid.uuid4(),
                work_id=work_id,
                selections=[
                    {
                        "field_key": "work.description",
                        "provider": "openlibrary",
                        "provider_id": "",
                        "value": "x",
                    }
                ],
                edition_id=None,
                open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
                google_books=cast(Any, FakeGoogleBooks({})),
                google_enabled=False,
            )
        )

    with pytest.raises(ValueError):
        asyncio.run(
            apply_enrichment_selections(
                cast(Any, session),
                user_id=uuid.uuid4(),
                work_id=work_id,
                selections=[
                    {
                        "field_key": "bad.field",
                        "provider": "openlibrary",
                        "provider_id": "/works/OL1W",
                        "value": "x",
                    }
                ],
                edition_id=None,
                open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
                google_books=cast(Any, FakeGoogleBooks({})),
                google_enabled=False,
            )
        )


def test_apply_enrichment_skips_google_provenance_when_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)
    called = {"google_external_ids": 0}

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._ensure_google_external_ids",
        lambda *_args, **_kwargs: called.__setitem__("google_external_ids", 1),
    )

    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.description",
                    "provider": "googlebooks",
                    "provider_id": "gb1",
                    "value": "Desc",
                }
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(
                Any, FakeGoogleBooks({"gb1": _google_bundle("gb1", description="Desc")})
            ),
            google_enabled=False,
        )
    )
    assert result["updated"] == ["work.description"]


def test_resolve_openlibrary_work_key_tries_author_variants() -> None:
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Katabasis")
    session = FakeSession()
    session.scalar_values = [None]

    def _execute_empty(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return []

        return _Res()

    session.execute = _execute_empty  # type: ignore[attr-defined]
    matching_item = type(
        "Item",
        (),
        {
            "work_key": "/works/OL42397860W",
            "title": "Katabasis",
            "author_names": ["Rebecca Kuang"],
        },
    )()
    resolver = FakeOpenLibraryResolver(
        search_items_by_author={"r f kuang": [matching_item], "": [matching_item]}
    )

    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=work,
            work_id=work_id,
            edition_target=None,
            first_author="R.F. Kuang",
            open_library=cast(Any, resolver),
        )
    )
    assert key == "/works/OL42397860W"
    attempted_authors = {
        str(call.get("author") or "") for call in resolver.search_calls
    }
    assert "R.F. Kuang" in attempted_authors
    assert "r f kuang" in attempted_authors


def test_author_search_variants_with_full_name_and_blank() -> None:
    assert _author_search_variants("   ") == []
    variants = _author_search_variants("Rebecca F. Kuang")
    assert "Rebecca F. Kuang" in variants
    assert "rebecca f kuang" in variants
    assert "r f kuang" in variants
    assert "rf kuang" in variants
    assert "rebecca kuang" in variants
    assert "kuang" in variants


def test_resolve_openlibrary_work_key_skips_duplicate_author_queries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    session = FakeSession()
    session.scalar_values = [None]

    def _execute_empty(_stmt: Any) -> Any:
        class _Res:
            @staticmethod
            def all() -> list[tuple[str | None, str | None]]:
                return []

        return _Res()

    session.execute = _execute_empty  # type: ignore[attr-defined]
    resolver = FakeOpenLibraryResolver(search_items=[])
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._author_search_variants",
        lambda _author: ["Same", "Same"],
    )
    key = asyncio.run(
        _resolve_openlibrary_work_key(
            session=cast(Any, session),
            work=work,
            work_id=work_id,
            edition_target=None,
            first_author="Author",
            open_library=cast(Any, resolver),
        )
    )
    assert key is None
    authors = [str(call.get("author") or "") for call in resolver.search_calls]
    assert authors.count("Same") == 1
    assert "" in authors


def test_get_enrichment_candidates_google_search_skips_failed_bundle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)

    class PartialGoogle(FakeGoogleBooks):
        async def fetch_work_bundle(self, *, volume_id: str) -> GoogleBooksWorkBundle:
            if volume_id == "bad":
                raise RuntimeError("broken")
            return await super().fetch_work_bundle(volume_id=volume_id)

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._first_author_name",
        lambda *_args, **_kwargs: "Author",
    )

    payload = asyncio.run(
        get_enrichment_candidates(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(
                Any,
                PartialGoogle(
                    {
                        "bad": _google_bundle("bad", description="Bad"),
                        "ok": _google_bundle("ok", description="Good"),
                    }
                ),
            ),
            google_enabled=True,
        )
    )
    description_field = next(
        field for field in payload["fields"] if field["field_key"] == "work.description"
    )
    assert any(item["provider_id"] == "ok" for item in description_field["candidates"])


def test_apply_enrichment_updates_all_field_setters(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(id=work_id, title="Book")
    edition = Edition(id=uuid.uuid4(), work_id=work_id)

    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_work",
        lambda *_args, **_kwargs: work,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._resolve_target_edition",
        lambda *_args, **_kwargs: edition,
    )
    monkeypatch.setattr(
        "app.services.work_metadata_enrichment._get_openlibrary_work_key",
        lambda *_args, **_kwargs: "/works/OL1W",
    )

    result = asyncio.run(
        apply_enrichment_selections(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=work_id,
            selections=[
                {
                    "field_key": "work.description",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": "Desc",
                },
                {
                    "field_key": "work.cover_url",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": "https://example.com/x.jpg",
                },
                {
                    "field_key": "work.first_publish_year",
                    "provider": "openlibrary",
                    "provider_id": "/works/OL1W",
                    "value": 1999,
                },
                {
                    "field_key": "edition.publisher",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "Pub",
                },
                {
                    "field_key": "edition.publish_date",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "2020-01-01",
                },
                {
                    "field_key": "edition.isbn10",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "0123456789",
                },
                {
                    "field_key": "edition.isbn13",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "9780123456789",
                },
                {
                    "field_key": "edition.language",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "en",
                },
                {
                    "field_key": "edition.format",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": "paperback",
                },
                {
                    "field_key": "edition.format",
                    "provider": "openlibrary",
                    "provider_id": "/books/OL1M",
                    "value": 123,
                },
            ],
            edition_id=None,
            open_library=cast(Any, FakeOpenLibrary(_openlibrary_bundle())),
            google_books=cast(Any, FakeGoogleBooks({})),
            google_enabled=False,
        )
    )
    assert work.description == "Desc"
    assert work.default_cover_url == "https://example.com/x.jpg"
    assert work.first_publish_year == 1999
    assert edition.publisher == "Pub"
    assert edition.publish_date == dt.date(2020, 1, 1)
    assert edition.isbn10 == "0123456789"
    assert edition.isbn13 == "9780123456789"
    assert edition.language == "en"
    assert edition.format == "paperback"
    assert {"field_key": "edition.format", "reason": "invalid_value"} in result[
        "skipped"
    ]
