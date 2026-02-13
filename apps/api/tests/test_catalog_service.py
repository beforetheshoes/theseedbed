from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

import sqlalchemy as sa

from app.db.models.bibliography import Author, Edition, Work
from app.db.models.external_provider import ExternalId, SourceRecord
from app.services.catalog import (
    _get_external_id,
    _upsert_source_record,
    import_googlebooks_bundle,
    import_openlibrary_bundle,
)
from app.services.google_books import GoogleBooksWorkBundle
from app.services.open_library import OpenLibraryWorkBundle


class FakeSession:
    def __init__(self) -> None:
        self.added: list[Any] = []
        self.source_record: SourceRecord | None = None
        self.scalar_values: list[Any] = []
        self.get_map: dict[tuple[type[Any], Any], Any] = {}
        self.committed = False

    def add(self, obj: Any) -> None:
        self.added.append(obj)
        if isinstance(obj, SourceRecord):
            self.source_record = obj

    def flush(self) -> None:
        for obj in self.added:
            if getattr(obj, "id", None) is None and hasattr(obj, "id"):
                obj.id = uuid.uuid4()

    def scalar(self, stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def get(self, model: type[Any], key: Any) -> Any:
        return self.get_map.get((model, key))

    def commit(self) -> None:
        self.committed = True


def _bundle() -> OpenLibraryWorkBundle:
    return OpenLibraryWorkBundle(
        work_key="/works/OL1W",
        title="Book",
        description="Desc",
        first_publish_year=2000,
        cover_url="https://covers.openlibrary.org/b/id/1-L.jpg",
        authors=[{"key": "/authors/OL2A", "name": "Author A"}],
        edition={
            "key": "/books/OL3M",
            "isbn10": "123",
            "isbn13": "456",
            "publisher": "Pub",
            "publish_date": None,
            "publish_date_iso": dt.date(2020, 1, 1),
            "language": "eng",
            "format": "Paperback",
        },
        raw_work={"k": "v"},
        raw_edition={"ek": "ev"},
    )


def _google_bundle() -> GoogleBooksWorkBundle:
    return GoogleBooksWorkBundle(
        volume_id="gb1",
        title="Google Book",
        description="Google Desc",
        first_publish_year=2001,
        cover_url="https://books.google.com/cover.jpg",
        authors=["Google Author"],
        edition={
            "isbn10": "0123456789",
            "isbn13": "9780123456789",
            "publisher": "Google Pub",
            "publish_date_iso": dt.date(2020, 1, 1),
            "language": "en",
            "format": "book",
        },
        raw_volume={"id": "gb1"},
        attribution_url="https://books.google.com/gb1",
    )


def test_get_external_id_delegates_to_session_scalar() -> None:
    session = FakeSession()
    expected = ExternalId(
        entity_type="work",
        entity_id=uuid.uuid4(),
        provider="openlibrary",
        provider_id="/works/OL1W",
    )
    session.scalar_values = [expected]
    actual = _get_external_id(
        session=cast(Any, session),
        entity_type="work",
        provider="openlibrary",
        provider_id="/works/OL1W",
    )
    assert actual is expected


def test_upsert_source_record_creates_and_updates() -> None:
    session = FakeSession()
    _upsert_source_record(
        cast(Any, session),
        provider="openlibrary",
        entity_type="work",
        provider_id="/works/OL1W",
        raw={"a": 1},
    )
    assert session.source_record is not None

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


def test_import_openlibrary_bundle_creates_records() -> None:
    session = FakeSession()
    # one scalar call for existing work-author link -> none
    session.scalar_values = [None]

    result = import_openlibrary_bundle(cast(Any, session), bundle=_bundle())

    assert session.committed is True
    assert result["work"]["created"] is True
    assert result["authors_created"] == 1
    assert result["edition"]["created"] is True


def test_import_openlibrary_bundle_uses_existing_records() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    author_id = uuid.uuid4()
    edition_id = uuid.uuid4()

    work_external = ExternalId(
        entity_type="work",
        entity_id=work_id,
        provider="openlibrary",
        provider_id="/works/OL1W",
    )
    author_external = ExternalId(
        entity_type="author",
        entity_id=author_id,
        provider="openlibrary",
        provider_id="/authors/OL2A",
    )
    edition_external = ExternalId(
        entity_type="edition",
        entity_id=edition_id,
        provider="openlibrary",
        provider_id="/books/OL3M",
    )

    # scalar sequence: source record exists (work), existing work-author link, source record exists (edition)
    session.scalar_values = [
        SourceRecord(
            provider="openlibrary",
            entity_type="work",
            provider_id="/works/OL1W",
            raw={},
        ),
        object(),
        SourceRecord(
            provider="openlibrary",
            entity_type="edition",
            provider_id="/books/OL3M",
            raw={},
        ),
    ]
    work_model = Work(
        id=work_id, title="Book", description=None, default_cover_url=None
    )
    edition_model = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session.get_map = {
        (Work, work_id): work_model,
        (Author, author_id): Author(id=author_id, name="Author A"),
        (
            Edition,
            edition_id,
        ): edition_model,
    }

    def fake_get_external(
        _session: FakeSession,
        *,
        entity_type: str,
        provider: str,
        provider_id: str,
    ) -> ExternalId | None:
        assert provider == "openlibrary"
        mapping = {
            ("work", "/works/OL1W"): work_external,
            ("author", "/authors/OL2A"): author_external,
            ("edition", "/books/OL3M"): edition_external,
        }
        return mapping.get((entity_type, provider_id))

    import app.services.catalog as catalog

    original = catalog._get_external_id
    try:
        catalog._get_external_id = cast(Any, fake_get_external)
        result = import_openlibrary_bundle(cast(Any, session), bundle=_bundle())
    finally:
        catalog._get_external_id = original

    assert result["work"]["created"] is False
    assert result["authors_created"] == 0
    assert result["edition"]["created"] is False
    assert work_model.default_cover_url == _bundle().cover_url
    assert edition_model.cover_url == _bundle().cover_url
    assert edition_model.language == "eng"
    assert edition_model.format == "Paperback"


def test_import_openlibrary_bundle_does_not_overwrite_existing_covers() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    author_id = uuid.uuid4()
    edition_id = uuid.uuid4()

    work_external = ExternalId(
        entity_type="work",
        entity_id=work_id,
        provider="openlibrary",
        provider_id="/works/OL1W",
    )
    author_external = ExternalId(
        entity_type="author",
        entity_id=author_id,
        provider="openlibrary",
        provider_id="/authors/OL2A",
    )
    edition_external = ExternalId(
        entity_type="edition",
        entity_id=edition_id,
        provider="openlibrary",
        provider_id="/books/OL3M",
    )

    session.scalar_values = [
        SourceRecord(
            provider="openlibrary",
            entity_type="work",
            provider_id="/works/OL1W",
            raw={},
        ),
        object(),
        SourceRecord(
            provider="openlibrary",
            entity_type="edition",
            provider_id="/books/OL3M",
            raw={},
        ),
    ]
    work_model = Work(
        id=work_id,
        title="Book",
        description=None,
        default_cover_url="existing-work-cover",
    )
    edition_model = Edition(
        id=edition_id,
        work_id=work_id,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url="existing-edition-cover",
    )
    session.get_map = {
        (Work, work_id): work_model,
        (Author, author_id): Author(id=author_id, name="Author A"),
        (Edition, edition_id): edition_model,
    }

    def fake_get_external(
        _session: FakeSession,
        *,
        entity_type: str,
        provider: str,
        provider_id: str,
    ) -> ExternalId | None:
        assert provider == "openlibrary"
        mapping = {
            ("work", "/works/OL1W"): work_external,
            ("author", "/authors/OL2A"): author_external,
            ("edition", "/books/OL3M"): edition_external,
        }
        return mapping.get((entity_type, provider_id))

    import app.services.catalog as catalog

    original = catalog._get_external_id
    try:
        catalog._get_external_id = cast(Any, fake_get_external)
        import_openlibrary_bundle(cast(Any, session), bundle=_bundle())
    finally:
        catalog._get_external_id = original

    assert work_model.default_cover_url == "existing-work-cover"
    assert edition_model.cover_url == "existing-edition-cover"


def test_import_openlibrary_bundle_raises_when_external_missing_target() -> None:
    session = FakeSession()
    missing_work_external = ExternalId(
        entity_type="work",
        entity_id=uuid.uuid4(),
        provider="openlibrary",
        provider_id="/works/OL1W",
    )

    import app.services.catalog as catalog

    original = catalog._get_external_id
    try:
        catalog._get_external_id = cast(
            Any, lambda *_args, **_kwargs: missing_work_external
        )
        try:
            import_openlibrary_bundle(cast(Any, session), bundle=_bundle())
        except RuntimeError as exc:
            assert "missing work" in str(exc)
        else:
            raise AssertionError("expected RuntimeError")
    finally:
        catalog._get_external_id = original


def test_import_googlebooks_bundle_creates_records() -> None:
    session = FakeSession()
    # work external id, work by isbn, source_record(work), author by name, work_author link,
    # edition external id, edition by isbn, edition external link, source_record(edition)
    session.scalar_values = [None] * 9

    result = import_googlebooks_bundle(cast(Any, session), bundle=_google_bundle())

    assert session.committed is True
    assert result["work"]["created"] is True
    assert result["edition"]["created"] is True
    assert result["authors_processed"] == 1
    assert result["authors_created"] == 1
    assert any(
        isinstance(obj, ExternalId)
        and obj.provider == "googlebooks"
        and obj.entity_type == "work"
        for obj in session.added
    )
    assert any(
        isinstance(obj, ExternalId)
        and obj.provider == "googlebooks"
        and obj.entity_type == "edition"
        for obj in session.added
    )


def test_import_googlebooks_bundle_uses_existing_records() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Existing",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    edition = Edition(
        id=edition_id,
        work_id=work_id,
        isbn10=None,
        isbn13=None,
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session.get_map = {(Work, work_id): work, (Edition, edition_id): edition}
    session.scalar_values = [
        ExternalId(
            entity_type="work",
            entity_id=work_id,
            provider="googlebooks",
            provider_id="gb1",
        ),
        None,
        SourceRecord(
            provider="googlebooks",
            entity_type="work",
            provider_id="gb1",
            raw={},
        ),
        Author(id=uuid.uuid4(), name="Google Author"),
        object(),
        ExternalId(
            entity_type="edition",
            entity_id=edition_id,
            provider="googlebooks",
            provider_id="gb1",
        ),
        SourceRecord(
            provider="googlebooks",
            entity_type="edition",
            provider_id="gb1",
            raw={},
        ),
    ]

    result = import_googlebooks_bundle(cast(Any, session), bundle=_google_bundle())

    assert result["work"]["created"] is False
    assert result["edition"]["created"] is False
    assert work.description == "Google Desc"
    assert work.first_publish_year == 2001
    assert work.default_cover_url == "https://books.google.com/cover.jpg"
    assert edition.isbn10 == "0123456789"
    assert edition.isbn13 == "9780123456789"
    assert edition.publisher == "Google Pub"
    assert edition.publish_date == dt.date(2020, 1, 1)
    assert edition.language == "en"
    assert edition.format == "book"
    assert edition.cover_url == "https://books.google.com/cover.jpg"


def test_import_googlebooks_bundle_raises_when_external_missing_target() -> None:
    session = FakeSession()
    session.scalar_values = [
        ExternalId(
            entity_type="work",
            entity_id=uuid.uuid4(),
            provider="googlebooks",
            provider_id="gb1",
        )
    ]
    try:
        import_googlebooks_bundle(cast(Any, session), bundle=_google_bundle())
    except RuntimeError as exc:
        assert "missing work" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")


def test_import_googlebooks_bundle_links_to_existing_work_by_isbn() -> None:
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Existing",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    edition_id = uuid.uuid4()
    edition = Edition(
        id=edition_id,
        work_id=work_id,
        isbn10=None,
        isbn13="9780123456789",
        publisher=None,
        publish_date=None,
        language=None,
        format=None,
        cover_url=None,
    )
    session.get_map = {(Work, work_id): work}
    session.scalar_values = [
        None,
        work_id,
        None,
        None,
        None,
        edition,
        None,
        None,
    ]
    base = _google_bundle()
    bundle = GoogleBooksWorkBundle(
        volume_id=base.volume_id,
        title=base.title,
        description=base.description,
        first_publish_year=base.first_publish_year,
        cover_url=base.cover_url,
        authors=[],
        edition={"isbn13": "9780123456789"},
        raw_volume=base.raw_volume,
        attribution_url=base.attribution_url,
    )

    result = import_googlebooks_bundle(cast(Any, session), bundle=bundle)

    assert result["work"]["created"] is False
    assert result["edition"] is not None
    assert result["edition"]["created"] is False
    assert any(
        isinstance(obj, ExternalId)
        and obj.entity_type == "work"
        and obj.provider == "googlebooks"
        for obj in session.added
    )


def test_import_googlebooks_bundle_raises_when_edition_external_missing_target() -> (
    None
):
    session = FakeSession()
    work_id = uuid.uuid4()
    work = Work(
        id=work_id,
        title="Existing",
        description=None,
        first_publish_year=None,
        default_cover_url=None,
    )
    session.get_map = {(Work, work_id): work}
    session.scalar_values = [
        ExternalId(
            entity_type="work",
            entity_id=work_id,
            provider="googlebooks",
            provider_id="gb1",
        ),
        None,
        None,
        ExternalId(
            entity_type="edition",
            entity_id=uuid.uuid4(),
            provider="googlebooks",
            provider_id="gb1",
        ),
    ]
    base = _google_bundle()
    bundle = GoogleBooksWorkBundle(
        volume_id=base.volume_id,
        title=base.title,
        description=base.description,
        first_publish_year=base.first_publish_year,
        cover_url=base.cover_url,
        authors=[],
        edition=base.edition,
        raw_volume=base.raw_volume,
        attribution_url=base.attribution_url,
    )

    try:
        import_googlebooks_bundle(cast(Any, session), bundle=bundle)
    except RuntimeError as exc:
        assert "missing edition" in str(exc)
    else:
        raise AssertionError("expected RuntimeError")
