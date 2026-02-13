from __future__ import annotations

import asyncio
import uuid
from typing import Any, cast

from app.services.openlibrary_backfill import (
    BackfillCandidate,
    run_openlibrary_backfill,
)


def test_run_openlibrary_backfill_counts_success_and_failures(
    monkeypatch: Any,
) -> None:
    candidates = [
        BackfillCandidate(work_id=uuid.uuid4(), work_key="/works/OL1W"),
        BackfillCandidate(work_id=uuid.uuid4(), work_key="/works/OL2W"),
    ]
    monkeypatch.setattr(
        "app.services.openlibrary_backfill.find_backfill_candidates",
        lambda **_kwargs: candidates,
    )

    async def _fake_refresh(*_args: object, **kwargs: object) -> bool:
        candidate = cast(BackfillCandidate, kwargs["candidate"])
        return bool(candidate.work_key.endswith("1W"))

    monkeypatch.setattr(
        "app.services.openlibrary_backfill._refresh_candidate", _fake_refresh
    )
    result = asyncio.run(run_openlibrary_backfill(limit=10, concurrency=2, retries=1))
    assert result.scanned == 2
    assert result.processed == 2
    assert result.refreshed == 1
    assert result.failed == 1
