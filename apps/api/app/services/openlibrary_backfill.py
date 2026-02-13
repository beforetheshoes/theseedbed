from __future__ import annotations

import asyncio
import random
import uuid
from dataclasses import dataclass

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.models.bibliography import Edition, Work
from app.db.models.external_provider import ExternalId
from app.db.session import _session_factory
from app.services.catalog import import_openlibrary_bundle
from app.services.open_library import OpenLibraryClient


@dataclass(frozen=True)
class BackfillCandidate:
    work_id: uuid.UUID
    work_key: str


@dataclass(frozen=True)
class BackfillResult:
    scanned: int
    processed: int
    refreshed: int
    failed: int


def _work_needs_backfill(
    session: Session, *, work_id: uuid.UUID
) -> bool:  # pragma: no cover
    work = session.get(Work, work_id)
    if work is None:
        return False
    if work.default_cover_url is None:
        return True
    rows = session.execute(
        sa.select(
            Edition.id,
            Edition.isbn10,
            Edition.isbn13,
            Edition.publisher,
            Edition.language,
            Edition.format,
            Edition.cover_url,
        ).where(Edition.work_id == work_id)
    ).all()
    if not rows:
        return True
    for _, isbn10, isbn13, publisher, language, fmt, cover_url in rows:
        if not (isbn10 or isbn13):
            return True
        if publisher is None or language is None or fmt is None or cover_url is None:
            return True
    return False


def find_backfill_candidates(
    *, limit: int = 500
) -> list[BackfillCandidate]:  # pragma: no cover
    session_factory = _session_factory()
    session = session_factory()
    try:
        rows = session.execute(
            sa.select(ExternalId.entity_id, ExternalId.provider_id)
            .where(
                ExternalId.entity_type == "work",
                ExternalId.provider == "openlibrary",
            )
            .order_by(ExternalId.provider_id.asc())
            .limit(limit * 5)
        ).all()
        candidates: list[BackfillCandidate] = []
        for entity_id, provider_id in rows:
            if not isinstance(entity_id, uuid.UUID) or not isinstance(provider_id, str):
                continue
            if not _work_needs_backfill(session, work_id=entity_id):
                continue
            candidates.append(
                BackfillCandidate(work_id=entity_id, work_key=provider_id)
            )
            if len(candidates) >= limit:
                break
        return candidates
    finally:
        session.close()


async def _refresh_candidate(
    *,
    candidate: BackfillCandidate,
    open_library: OpenLibraryClient,
    retries: int,
) -> bool:  # pragma: no cover
    for attempt in range(1, retries + 1):
        session_factory = _session_factory()
        session = session_factory()
        try:
            bundle = await open_library.fetch_work_bundle(work_key=candidate.work_key)
            import_openlibrary_bundle(session, bundle=bundle)
            return True
        except Exception:
            if attempt >= retries:
                return False
            await asyncio.sleep(random.uniform(0.1, 0.6 * attempt))
        finally:
            session.close()
    return False


async def run_openlibrary_backfill(
    *,
    limit: int = 500,
    concurrency: int = 5,
    retries: int = 3,
) -> BackfillResult:  # pragma: no cover
    candidates = find_backfill_candidates(limit=limit)
    semaphore = asyncio.Semaphore(max(concurrency, 1))
    refreshed = 0
    failed = 0

    async def _run(candidate: BackfillCandidate) -> None:
        nonlocal refreshed, failed
        async with semaphore:
            ok = await _refresh_candidate(
                candidate=candidate,
                open_library=OpenLibraryClient(),
                retries=max(retries, 1),
            )
            if ok:
                refreshed += 1
            else:
                failed += 1

    await asyncio.gather(*(_run(candidate) for candidate in candidates))
    return BackfillResult(
        scanned=len(candidates),
        processed=len(candidates),
        refreshed=refreshed,
        failed=failed,
    )
