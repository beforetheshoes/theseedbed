from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import sqlalchemy as sa

from app.db.models.content import Review
from app.db.models.users import LibraryItem
from app.services.reviews import (
    delete_review,
    list_public_reviews_for_work,
    list_reviews_for_user,
    upsert_review_for_work,
)


class FakeSession:
    def __init__(self) -> None:
        self.scalar_values: list[Any] = []
        self.execute_values: list[Any] = []
        self.added: list[Any] = []
        self.deleted: list[Any] = []
        self.committed = False

    def scalar(self, _stmt: sa.Select[Any]) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def execute(self, _stmt: sa.Select[Any]) -> Any:
        class _Result:
            def __init__(self, rows: list[Any]) -> None:
                self._rows = rows

            def all(self) -> list[Any]:
                return self._rows

        return _Result(self.execute_values.pop(0))

    def add(self, obj: Any) -> None:
        self.added.append(obj)
        if getattr(obj, "id", None) is None and hasattr(obj, "id"):
            obj.id = uuid.uuid4()

    def commit(self) -> None:
        self.committed = True

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)


def test_upsert_review_creates_then_updates() -> None:
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    item = LibraryItem(
        id=uuid.uuid4(),
        user_id=user_id,
        work_id=work_id,
        preferred_edition_id=None,
        status="to_read",
        visibility="private",
        rating=None,
        tags=None,
        created_at=dt.datetime.now(tz=dt.UTC),
        updated_at=dt.datetime.now(tz=dt.UTC),
    )

    session = FakeSession()
    # scalar calls: library item, existing review (None)
    session.scalar_values = [item, None]
    created = upsert_review_for_work(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        work_id=work_id,
        title="T",
        body="Body",
        rating=5,
        visibility="private",
        edition_id=uuid.uuid4(),
    )
    assert session.committed is True
    assert isinstance(created, Review)

    session = FakeSession()
    existing = Review(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=item.id,
        title="Old",
        body="Old",
        rating=1,
        visibility="private",
        created_at=dt.datetime.now(tz=dt.UTC),
        updated_at=dt.datetime.now(tz=dt.UTC),
    )
    session.scalar_values = [item, existing]
    updated = upsert_review_for_work(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        work_id=work_id,
        title=None,
        body="New",
        rating=2,
        visibility="public",
        edition_id=None,
    )
    assert updated.body == "New"
    assert updated.visibility == "public"


def test_list_public_reviews_for_work_shapes_response() -> None:
    work_id = uuid.uuid4()
    review = Review(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        library_item_id=uuid.uuid4(),
        title=None,
        body="B",
        rating=None,
        visibility="public",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.execute_values = [[(review, work_id)]]
    items = list_public_reviews_for_work(
        session,  # type: ignore[arg-type]
        work_id=work_id,
        limit=10,
    )
    assert items[0]["id"] == str(review.id)


def test_list_reviews_for_user_shapes_response() -> None:
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    edition_id = uuid.uuid4()
    review = Review(
        id=uuid.uuid4(),
        user_id=user_id,
        library_item_id=uuid.uuid4(),
        title="T",
        body="B",
        rating=3,
        visibility="unlisted",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.execute_values = [[(review, work_id, edition_id)]]
    items = list_reviews_for_user(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        limit=10,
    )
    assert items[0]["work_id"] == str(work_id)
    assert items[0]["edition_id"] == str(edition_id)


def test_upsert_review_rejects_invalid_rating_and_visibility() -> None:
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    session = FakeSession()
    try:
        upsert_review_for_work(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            work_id=work_id,
            title=None,
            body="B",
            rating=0,
            visibility="private",
            edition_id=None,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for rating")

    session = FakeSession()
    try:
        upsert_review_for_work(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            work_id=work_id,
            title=None,
            body="B",
            rating=None,
            visibility="nope",
            edition_id=None,
        )
    except ValueError:
        pass
    else:
        raise AssertionError("expected ValueError for visibility")


def test_upsert_review_requires_library_item() -> None:
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [None]
    try:
        upsert_review_for_work(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            work_id=work_id,
            title=None,
            body="B",
            rating=None,
            visibility="private",
            edition_id=None,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")


def test_delete_review_404_when_missing() -> None:
    user_id = uuid.uuid4()
    review_id = uuid.uuid4()
    session = FakeSession()
    session.scalar_values = [None]
    try:
        delete_review(
            session,  # type: ignore[arg-type]
            user_id=user_id,
            review_id=review_id,
        )
    except LookupError:
        pass
    else:
        raise AssertionError("expected LookupError")


def test_delete_review_deletes_when_present() -> None:
    user_id = uuid.uuid4()
    review_id = uuid.uuid4()
    review = Review(
        id=review_id,
        user_id=user_id,
        library_item_id=uuid.uuid4(),
        title=None,
        body="B",
        rating=None,
        visibility="private",
        created_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
        updated_at=dt.datetime(2026, 2, 8, tzinfo=dt.UTC),
    )
    session = FakeSession()
    session.scalar_values = [review]
    delete_review(
        session,  # type: ignore[arg-type]
        user_id=user_id,
        review_id=review_id,
    )
    assert session.deleted
    assert session.committed is True
