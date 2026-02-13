from __future__ import annotations

import datetime as dt
from typing import Any

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Author, Edition, Work, WorkAuthor
from app.db.models.external_provider import ExternalId, SourceRecord
from app.services.google_books import GoogleBooksWorkBundle
from app.services.open_library import OpenLibraryWorkBundle


def _get_external_id(
    session: Session,
    *,
    entity_type: str,
    provider: str,
    provider_id: str,
) -> ExternalId | None:
    return session.scalar(
        sa.select(ExternalId).where(
            ExternalId.entity_type == entity_type,
            ExternalId.provider == provider,
            ExternalId.provider_id == provider_id,
        )
    )


def _upsert_source_record(
    session: Session,
    *,
    provider: str,
    entity_type: str,
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


def import_openlibrary_bundle(
    session: Session,
    *,
    bundle: OpenLibraryWorkBundle,
) -> dict[str, Any]:
    provider = "openlibrary"

    work_external = _get_external_id(
        session,
        entity_type="work",
        provider=provider,
        provider_id=bundle.work_key,
    )
    if work_external is not None:
        work = session.get(Work, work_external.entity_id)
        if work is None:
            raise RuntimeError("work external ID points to missing work")
        if not work.description and bundle.description:
            work.description = bundle.description
        if work.first_publish_year is None and bundle.first_publish_year is not None:
            work.first_publish_year = bundle.first_publish_year
        if work.default_cover_url is None and bundle.cover_url is not None:
            work.default_cover_url = bundle.cover_url
    else:
        work = Work(
            title=bundle.title,
            description=bundle.description,
            first_publish_year=bundle.first_publish_year,
            default_cover_url=bundle.cover_url,
        )
        session.add(work)
        session.flush()
        session.add(
            ExternalId(
                entity_type="work",
                entity_id=work.id,
                provider=provider,
                provider_id=bundle.work_key,
            )
        )

    _upsert_source_record(
        session,
        provider=provider,
        entity_type="work",
        provider_id=bundle.work_key,
        raw=bundle.raw_work,
    )

    created_authors = 0
    for author in bundle.authors:
        provider_id = author["key"]
        name = author["name"]
        author_external = _get_external_id(
            session,
            entity_type="author",
            provider=provider,
            provider_id=provider_id,
        )
        if author_external is not None:
            author_model = session.get(Author, author_external.entity_id)
            if author_model is None:
                raise RuntimeError("author external ID points to missing author")
        else:
            author_model = Author(name=name)
            session.add(author_model)
            session.flush()
            session.add(
                ExternalId(
                    entity_type="author",
                    entity_id=author_model.id,
                    provider=provider,
                    provider_id=provider_id,
                )
            )
            created_authors += 1

        existing_link = session.scalar(
            sa.select(WorkAuthor).where(
                WorkAuthor.work_id == work.id,
                WorkAuthor.author_id == author_model.id,
            )
        )
        if existing_link is None:
            session.add(WorkAuthor(work_id=work.id, author_id=author_model.id))

    created_edition = False
    edition_id = None
    edition_key = None
    if bundle.edition is not None:
        edition_key = str(bundle.edition["key"])
        edition_external = _get_external_id(
            session,
            entity_type="edition",
            provider=provider,
            provider_id=edition_key,
        )
        if edition_external is not None:
            edition = session.get(Edition, edition_external.entity_id)
            if edition is None:
                raise RuntimeError("edition external ID points to missing edition")
            if edition.isbn10 is None and bundle.edition.get("isbn10"):
                edition.isbn10 = bundle.edition.get("isbn10")
            if edition.isbn13 is None and bundle.edition.get("isbn13"):
                edition.isbn13 = bundle.edition.get("isbn13")
            if edition.publisher is None and bundle.edition.get("publisher"):
                edition.publisher = bundle.edition.get("publisher")
            if edition.publish_date is None and isinstance(
                bundle.edition.get("publish_date_iso"), dt.date
            ):
                edition.publish_date = bundle.edition.get("publish_date_iso")
            if edition.language is None and bundle.edition.get("language"):
                edition.language = bundle.edition.get("language")
            if edition.format is None and bundle.edition.get("format"):
                edition.format = bundle.edition.get("format")
            if edition.cover_url is None and bundle.cover_url is not None:
                edition.cover_url = bundle.cover_url
        else:
            edition = Edition(
                work_id=work.id,
                isbn10=bundle.edition.get("isbn10"),
                isbn13=bundle.edition.get("isbn13"),
                publisher=bundle.edition.get("publisher"),
                publish_date=(
                    bundle.edition.get("publish_date_iso")
                    if isinstance(bundle.edition.get("publish_date_iso"), dt.date)
                    else None
                ),
                language=(
                    bundle.edition.get("language")
                    if isinstance(bundle.edition.get("language"), str)
                    else None
                ),
                format=(
                    bundle.edition.get("format")
                    if isinstance(bundle.edition.get("format"), str)
                    else None
                ),
                cover_url=bundle.cover_url,
            )
            session.add(edition)
            session.flush()
            session.add(
                ExternalId(
                    entity_type="edition",
                    entity_id=edition.id,
                    provider=provider,
                    provider_id=edition_key,
                )
            )
            created_edition = True

        edition_id = str(edition.id)
        if bundle.raw_edition is not None:
            _upsert_source_record(
                session,
                provider=provider,
                entity_type="edition",
                provider_id=edition_key,
                raw=bundle.raw_edition,
            )

    session.commit()

    return {
        "work": {
            "id": str(work.id),
            "title": work.title,
            "created": work_external is None,
        },
        "edition": (
            {
                "id": edition_id,
                "provider_id": edition_key,
                "created": created_edition,
            }
            if edition_id and edition_key
            else None
        ),
        "authors_processed": len(bundle.authors),
        "authors_created": created_authors,
    }


def _find_work_by_isbn(
    session: Session,
    *,
    isbn10: str | None,
    isbn13: str | None,
) -> Work | None:
    predicates: list[Any] = []
    if isbn13:
        predicates.append(Edition.isbn13 == isbn13)
    if isbn10:
        predicates.append(Edition.isbn10 == isbn10)
    if not predicates:
        return None
    work_id = session.scalar(
        sa.select(Edition.work_id).where(sa.or_(*predicates)).limit(1)
    )
    if work_id is None:
        return None
    return session.get(Work, work_id)


def _find_existing_author_by_name(session: Session, *, name: str) -> Author | None:
    normalized = name.strip()
    if not normalized:
        return None
    return session.scalar(sa.select(Author).where(Author.name == normalized))


def import_googlebooks_bundle(
    session: Session,
    *,
    bundle: GoogleBooksWorkBundle,
) -> dict[str, Any]:
    provider = "googlebooks"
    work_external = _get_external_id(
        session,
        entity_type="work",
        provider=provider,
        provider_id=bundle.volume_id,
    )

    edition_data = bundle.edition if isinstance(bundle.edition, dict) else {}
    isbn10 = edition_data.get("isbn10")
    isbn13 = edition_data.get("isbn13")
    matched_work = _find_work_by_isbn(
        session,
        isbn10=isbn10 if isinstance(isbn10, str) else None,
        isbn13=isbn13 if isinstance(isbn13, str) else None,
    )

    if work_external is not None:
        work = session.get(Work, work_external.entity_id)
        if work is None:
            raise RuntimeError("work external ID points to missing work")
        created_work = False
    elif matched_work is not None:
        work = matched_work
        created_work = False
        existing_work_link = session.scalar(
            sa.select(ExternalId).where(
                ExternalId.entity_type == "work",
                ExternalId.entity_id == work.id,
                ExternalId.provider == provider,
            )
        )
        if existing_work_link is None:
            session.add(
                ExternalId(
                    entity_type="work",
                    entity_id=work.id,
                    provider=provider,
                    provider_id=bundle.volume_id,
                )
            )
    else:
        work = Work(
            title=bundle.title,
            description=bundle.description,
            first_publish_year=bundle.first_publish_year,
            default_cover_url=bundle.cover_url,
        )
        session.add(work)
        session.flush()
        session.add(
            ExternalId(
                entity_type="work",
                entity_id=work.id,
                provider=provider,
                provider_id=bundle.volume_id,
            )
        )
        created_work = True

    if not work.description and bundle.description:
        work.description = bundle.description
    if work.first_publish_year is None and bundle.first_publish_year is not None:
        work.first_publish_year = bundle.first_publish_year
    if work.default_cover_url is None and bundle.cover_url is not None:
        work.default_cover_url = bundle.cover_url

    _upsert_source_record(
        session,
        provider=provider,
        entity_type="work",
        provider_id=bundle.volume_id,
        raw=bundle.raw_volume,
    )

    created_authors = 0
    for author_name in bundle.authors:
        normalized_name = author_name.strip()
        if not normalized_name:
            continue
        author_model = _find_existing_author_by_name(session, name=normalized_name)
        if author_model is None:
            author_model = Author(name=normalized_name)
            session.add(author_model)
            session.flush()
            created_authors += 1
        work_author_link = session.scalar(
            sa.select(WorkAuthor).where(
                WorkAuthor.work_id == work.id,
                WorkAuthor.author_id == author_model.id,
            )
        )
        if work_author_link is None:
            session.add(WorkAuthor(work_id=work.id, author_id=author_model.id))

    created_edition = False
    edition_id: str | None = None
    if edition_data:
        edition_external = _get_external_id(
            session,
            entity_type="edition",
            provider=provider,
            provider_id=bundle.volume_id,
        )
        if edition_external is not None:
            edition = session.get(Edition, edition_external.entity_id)
            if edition is None:
                raise RuntimeError("edition external ID points to missing edition")
        else:
            existing_by_isbn: Edition | None = None
            predicates: list[Any] = []
            if isinstance(isbn13, str) and isbn13:
                predicates.append(Edition.isbn13 == isbn13)
            if isinstance(isbn10, str) and isbn10:
                predicates.append(Edition.isbn10 == isbn10)
            if predicates:
                existing_by_isbn = session.scalar(
                    sa.select(Edition)
                    .where(Edition.work_id == work.id)
                    .where(sa.or_(*predicates))
                    .limit(1)
                )
            if existing_by_isbn is not None:
                edition = existing_by_isbn
            else:
                edition = Edition(
                    work_id=work.id,
                    isbn10=isbn10 if isinstance(isbn10, str) else None,
                    isbn13=isbn13 if isinstance(isbn13, str) else None,
                    publisher=(
                        edition_data.get("publisher")
                        if isinstance(edition_data.get("publisher"), str)
                        else None
                    ),
                    publish_date=(
                        edition_data.get("publish_date_iso")
                        if isinstance(edition_data.get("publish_date_iso"), dt.date)
                        else None
                    ),
                    language=(
                        edition_data.get("language")
                        if isinstance(edition_data.get("language"), str)
                        else None
                    ),
                    format=(
                        edition_data.get("format")
                        if isinstance(edition_data.get("format"), str)
                        else None
                    ),
                    cover_url=bundle.cover_url,
                )
                session.add(edition)
                session.flush()
                created_edition = True
            existing_edition_link = session.scalar(
                sa.select(ExternalId).where(
                    ExternalId.entity_type == "edition",
                    ExternalId.entity_id == edition.id,
                    ExternalId.provider == provider,
                )
            )
            if existing_edition_link is None:
                session.add(
                    ExternalId(
                        entity_type="edition",
                        entity_id=edition.id,
                        provider=provider,
                        provider_id=bundle.volume_id,
                    )
                )

        if edition.isbn10 is None and isinstance(isbn10, str):
            edition.isbn10 = isbn10
        if edition.isbn13 is None and isinstance(isbn13, str):
            edition.isbn13 = isbn13
        if edition.publisher is None and isinstance(edition_data.get("publisher"), str):
            edition.publisher = edition_data.get("publisher")
        if edition.publish_date is None and isinstance(
            edition_data.get("publish_date_iso"), dt.date
        ):
            edition.publish_date = edition_data.get("publish_date_iso")
        if edition.language is None and isinstance(edition_data.get("language"), str):
            edition.language = edition_data.get("language")
        if edition.format is None and isinstance(edition_data.get("format"), str):
            edition.format = edition_data.get("format")
        if edition.cover_url is None and bundle.cover_url is not None:
            edition.cover_url = bundle.cover_url
        edition_id = str(edition.id)

        _upsert_source_record(
            session,
            provider=provider,
            entity_type="edition",
            provider_id=bundle.volume_id,
            raw=bundle.raw_volume,
        )

    session.commit()
    return {
        "work": {
            "id": str(work.id),
            "title": work.title,
            "created": created_work,
        },
        "edition": (
            {
                "id": edition_id,
                "provider_id": bundle.volume_id,
                "created": created_edition,
            }
            if edition_id
            else None
        ),
        "authors_processed": len(bundle.authors),
        "authors_created": created_authors,
    }
