from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

import pytest

from app.db.models.users import LibraryItem
from app.services.library_merges import apply_library_merge, preview_library_merge


class _ScalarIter:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return list(self._rows)

    def __iter__(self) -> Any:
        return iter(self._rows)


class _ExecResult:
    def __init__(self, *, rows: list[Any] | None = None) -> None:
        self._rows = rows or []

    def scalars(self) -> _ScalarIter:
        return _ScalarIter(self._rows)

    def all(self) -> list[Any]:
        return list(self._rows)


class FakeSession:
    def __init__(self) -> None:
        self.execute_values: list[list[Any]] = []
        self.scalar_values: list[Any] = []
        self.added: list[Any] = []
        self.committed = False
        self.execute_calls = 0

    def execute(self, _stmt: Any) -> _ExecResult:
        self.execute_calls += 1
        rows = self.execute_values.pop(0) if self.execute_values else []
        return _ExecResult(rows=rows)

    def scalar(self, _stmt: Any) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return 0

    def add(self, obj: Any) -> None:
        if getattr(obj, "id", None) is None and hasattr(obj, "id"):
            obj.id = uuid.uuid4()
        self.added.append(obj)

    def commit(self) -> None:
        self.committed = True


def _item(
    *,
    item_id: uuid.UUID,
    user_id: uuid.UUID,
    work_id: uuid.UUID,
    status: str,
    visibility: str,
    rating: int | None,
    preferred_edition_id: uuid.UUID | None,
    tags: list[str] | None,
) -> LibraryItem:
    now = dt.datetime.now(tz=dt.UTC)
    return LibraryItem(
        id=item_id,
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=preferred_edition_id,
        status=status,
        visibility=visibility,
        rating=rating,
        tags=tags,
        created_at=now,
        updated_at=now,
    )


def test_preview_library_merge_returns_candidates_and_defaults() -> None:
    user_id = uuid.uuid4()
    target_id = uuid.uuid4()
    source_id = uuid.uuid4()

    target = _item(
        item_id=target_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="reading",
        visibility="private",
        rating=6,
        preferred_edition_id=uuid.uuid4(),
        tags=["SciFi", "Space"],
    )
    source = _item(
        item_id=source_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="completed",
        visibility="public",
        rating=9,
        preferred_edition_id=None,
        tags=["Space", "Award"],
    )

    session = FakeSession()
    session.execute_values = [
        [target, source],
        [(target_id, 1), (source_id, 2)],
        [(source_id, 3)],
        [(source_id, 4)],
        [(source_id, 5)],
        [(source_id, 6)],
    ]

    preview = preview_library_merge(
        cast(Any, session),
        user_id=user_id,
        item_ids=[target_id, source_id],
        target_item_id=target_id,
        field_resolution={},
    )

    assert preview["selection"]["target_item_id"] == str(target_id)
    assert preview["fields"]["defaults"]["tags"] == "combine"
    assert preview["fields"]["candidates"]["status"][str(source_id)] == "completed"
    assert preview["dependencies"]["totals_for_sources"]["reviews"] == 6


def test_preview_library_merge_rejects_invalid_target() -> None:
    user_id = uuid.uuid4()
    item_id_a = uuid.uuid4()
    item_id_b = uuid.uuid4()
    with pytest.raises(ValueError):
        preview_library_merge(
            cast(Any, FakeSession()),
            user_id=user_id,
            item_ids=[item_id_a, item_id_b],
            target_item_id=uuid.uuid4(),
            field_resolution={},
        )


def test_apply_library_merge_moves_records_and_creates_event() -> None:
    user_id = uuid.uuid4()
    target_id = uuid.uuid4()
    source_id = uuid.uuid4()
    target_edition_id = uuid.uuid4()

    target = _item(
        item_id=target_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="reading",
        visibility="private",
        rating=6,
        preferred_edition_id=target_edition_id,
        tags=["SciFi", "Space"],
    )
    source = _item(
        item_id=source_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="completed",
        visibility="public",
        rating=9,
        preferred_edition_id=None,
        tags=["Space", "Award"],
    )

    session = FakeSession()
    session.execute_values = [
        [target, source],
        [uuid.uuid4()],
        [],
        [],
        [],
        [],
        [],
    ]
    session.scalar_values = [1, 2, 3, 4, 5]

    result = apply_library_merge(
        cast(Any, session),
        user_id=user_id,
        item_ids=[target_id, source_id],
        target_item_id=target_id,
        field_resolution={
            "status": f"keep:{source_id}",
            "visibility": f"keep:{target_id}",
            "rating": f"keep:{source_id}",
            "preferred_edition_id": f"keep:{target_id}",
            "tags": "combine",
        },
    )

    assert result["target_item_id"] == str(target_id)
    assert result["moved_counts"]["read_cycles"] == 1
    assert target.status == "completed"
    assert target.visibility == "private"
    assert target.rating == 9
    assert target.preferred_edition_id == target_edition_id
    assert target.tags == ["SciFi", "Space", "Award"]
    assert session.committed is True
    assert len(session.added) == 1


def test_apply_library_merge_rejects_invalid_resolution() -> None:
    user_id = uuid.uuid4()
    item_id_a = uuid.uuid4()
    item_id_b = uuid.uuid4()

    with pytest.raises(ValueError):
        apply_library_merge(
            cast(Any, FakeSession()),
            user_id=user_id,
            item_ids=[item_id_a, item_id_b],
            target_item_id=item_id_a,
            field_resolution={"status": "combine"},
        )


def test_preview_library_merge_raises_when_item_ownership_missing() -> None:
    user_id = uuid.uuid4()
    item_id_a = uuid.uuid4()
    item_id_b = uuid.uuid4()
    session = FakeSession()
    session.execute_values = [[]]
    with pytest.raises(LookupError):
        preview_library_merge(
            cast(Any, session),
            user_id=user_id,
            item_ids=[item_id_a, item_id_b],
            target_item_id=item_id_a,
            field_resolution={},
        )


def test_preview_library_merge_accepts_keep_tags_strategy() -> None:
    user_id = uuid.uuid4()
    target_id = uuid.uuid4()
    source_id = uuid.uuid4()
    target = _item(
        item_id=target_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="reading",
        visibility="private",
        rating=1,
        preferred_edition_id=None,
        tags=["A"],
    )
    source = _item(
        item_id=source_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="completed",
        visibility="public",
        rating=2,
        preferred_edition_id=None,
        tags=["B"],
    )
    session = FakeSession()
    session.execute_values = [
        [target, source],
        [],
        [],
        [],
        [],
        [],
    ]
    payload = preview_library_merge(
        cast(Any, session),
        user_id=user_id,
        item_ids=[target_id, source_id],
        target_item_id=target_id,
        field_resolution={"tags": f"keep:{source_id}"},
    )
    assert payload["fields"]["resolution"]["tags"] == f"keep:{source_id}"


def test_apply_library_merge_uses_tags_keep_and_empty_cycle_path() -> None:
    user_id = uuid.uuid4()
    target_id = uuid.uuid4()
    source_id = uuid.uuid4()
    target = _item(
        item_id=target_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="reading",
        visibility="private",
        rating=5,
        preferred_edition_id=None,
        tags=["A", "B"],
    )
    source = _item(
        item_id=source_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="completed",
        visibility="public",
        rating=7,
        preferred_edition_id=None,
        tags=["Z"],
    )
    session = FakeSession()
    session.execute_values = [
        [target, source],
        [],
        [],
        [],
        [],
        [],
        [],
    ]
    session.scalar_values = [0, 0, 0, 0, 0]
    result = apply_library_merge(
        cast(Any, session),
        user_id=user_id,
        item_ids=[target_id, source_id],
        target_item_id=target_id,
        field_resolution={
            "status": f"keep:{target_id}",
            "visibility": f"keep:{target_id}",
            "rating": f"keep:{target_id}",
            "preferred_edition_id": f"keep:{target_id}",
            "tags": f"keep:{source_id}",
        },
    )
    assert result["moved_counts"]["read_cycles"] == 0
    assert target.tags == ["Z"]


def test_apply_library_merge_rejects_invalid_tags_keep_reference() -> None:
    user_id = uuid.uuid4()
    target_id = uuid.uuid4()
    source_id = uuid.uuid4()
    bad_id = uuid.uuid4()
    target = _item(
        item_id=target_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="reading",
        visibility="private",
        rating=5,
        preferred_edition_id=None,
        tags=["A"],
    )
    source = _item(
        item_id=source_id,
        user_id=user_id,
        work_id=uuid.uuid4(),
        status="completed",
        visibility="public",
        rating=7,
        preferred_edition_id=None,
        tags=["B"],
    )
    session = FakeSession()
    session.execute_values = [[target, source]]
    with pytest.raises(ValueError):
        apply_library_merge(
            cast(Any, session),
            user_id=user_id,
            item_ids=[target_id, source_id],
            target_item_id=target_id,
            field_resolution={
                "status": f"keep:{target_id}",
                "visibility": f"keep:{target_id}",
                "rating": f"keep:{target_id}",
                "preferred_edition_id": f"keep:{target_id}",
                "tags": f"keep:{bad_id}",
            },
        )


def test_library_merge_validates_item_count_limits() -> None:
    user_id = uuid.uuid4()
    one = uuid.uuid4()
    with pytest.raises(ValueError):
        preview_library_merge(
            cast(Any, FakeSession()),
            user_id=user_id,
            item_ids=[one, one],
            target_item_id=one,
            field_resolution={},
        )

    too_many = [uuid.uuid4() for _ in range(21)]
    with pytest.raises(ValueError):
        preview_library_merge(
            cast(Any, FakeSession()),
            user_id=user_id,
            item_ids=too_many,
            target_item_id=too_many[0],
            field_resolution={},
        )
