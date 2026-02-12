from __future__ import annotations

import datetime as dt
import uuid
from typing import Any, cast

import pytest

from app.db.models.users import LibraryItem, User
from app.services.user_library import (
    _decode_cursor,
    _default_handle,
    _encode_cursor,
    create_or_get_library_item,
    delete_library_item,
    get_library_item_by_work,
    get_library_item_by_work_detail,
    get_or_create_profile,
    list_library_items,
    search_library_items,
    update_library_item,
    update_profile,
)


class FakeExecuteResult:
    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self._rows = rows

    def all(self) -> list[tuple[Any, ...]]:
        return self._rows

    def first(self) -> tuple[Any, ...] | None:
        return self._rows[0] if self._rows else None


class FakeSession:
    def __init__(self) -> None:
        self.get_map: dict[tuple[type[Any], Any], Any] = {}
        self.scalar_values: list[Any] = []
        self.added: list[Any] = []
        self.execute_rows: list[tuple[Any, ...]] = []
        self.execute_results: list[list[tuple[Any, ...]]] = []
        self.deleted: list[Any] = []
        self.committed = False

    def get(self, model: type[Any], key: Any) -> Any:
        return self.get_map.get((model, key))

    def scalar(self, _stmt: Any) -> Any:
        if self.scalar_values:
            return self.scalar_values.pop(0)
        return None

    def add(self, obj: Any) -> None:
        if getattr(obj, "id", None) is None and hasattr(obj, "id"):
            obj.id = uuid.uuid4()
        self.added.append(obj)
        if hasattr(obj, "id"):
            self.get_map[(type(obj), obj.id)] = obj

    def commit(self) -> None:
        self.committed = True

    def execute(self, _stmt: Any) -> FakeExecuteResult:
        if self.execute_results:
            return FakeExecuteResult(self.execute_results.pop(0))
        return FakeExecuteResult(self.execute_rows)

    def delete(self, obj: Any) -> None:
        self.deleted.append(obj)


def test_cursor_encode_decode_roundtrip() -> None:
    created_at = dt.datetime.now(tz=dt.UTC).replace(microsecond=0)
    item_id = uuid.uuid4()
    cursor = _encode_cursor(created_at, item_id)
    decoded_created, decoded_id = _decode_cursor(cursor)
    assert decoded_created == created_at
    assert decoded_id == item_id


def test_cursor_decode_invalid_raises() -> None:
    with pytest.raises(ValueError):
        _decode_cursor("not-base64")


def test_default_handle() -> None:
    user_id = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
    assert _default_handle(user_id) == "user_aaaaaaaa"


def test_search_library_items_shapes_items_and_authors() -> None:
    session = FakeSession()
    # First execute: base search rows
    work_id = uuid.uuid4()
    session.execute_results = [
        [
            (
                work_id,
                "Title",
                "https://example.com/cover.jpg",
                "/works/OL1W",
            )
        ],
        # Second execute: author names by work
        [(work_id, "B Author"), (work_id, "A Author"), (work_id, "A Author")],
    ]

    items = search_library_items(
        session,  # type: ignore[arg-type]
        user_id=uuid.uuid4(),
        query="ti",
        limit=10,
    )
    assert items == [
        {
            "work_id": str(work_id),
            "work_title": "Title",
            "author_names": ["A Author", "B Author"],
            "cover_url": "https://example.com/cover.jpg",
            "openlibrary_work_key": "/works/OL1W",
        }
    ]


def test_get_or_create_profile_creates_when_missing() -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    profile = get_or_create_profile(cast(Any, session), user_id=user_id)
    assert profile.id == user_id
    assert session.committed is True


def test_update_profile_validates_handle() -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    get_or_create_profile(cast(Any, session), user_id=user_id)

    with pytest.raises(ValueError):
        update_profile(
            cast(Any, session),
            user_id=user_id,
            handle="   ",
            display_name=None,
            avatar_url=None,
        )


def test_update_profile_rejects_duplicate_handle() -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    get_or_create_profile(cast(Any, session), user_id=user_id)
    session.scalar_values = [object()]

    with pytest.raises(ValueError):
        update_profile(
            cast(Any, session),
            user_id=user_id,
            handle="taken",
            display_name=None,
            avatar_url=None,
        )


def test_update_profile_updates_fields() -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    profile = get_or_create_profile(cast(Any, session), user_id=user_id)
    session.scalar_values = [None]

    updated = update_profile(
        cast(Any, session),
        user_id=user_id,
        handle="fresh",
        display_name=" Name ",
        avatar_url=" https://example.com/avatar.png ",
    )
    assert updated is profile
    assert updated.handle == "fresh"
    assert updated.display_name == "Name"
    assert updated.avatar_url == "https://example.com/avatar.png"


def test_create_or_get_library_item_handles_missing_work() -> None:
    session = FakeSession()
    with pytest.raises(LookupError):
        create_or_get_library_item(
            cast(Any, session),
            user_id=uuid.uuid4(),
            work_id=uuid.uuid4(),
            status=None,
            visibility=None,
            rating=None,
            tags=None,
            preferred_edition_id=None,
        )


def test_create_or_get_library_item_returns_existing() -> None:
    session = FakeSession()
    existing = type(
        "Item",
        (),
        {
            "id": uuid.uuid4(),
            "work_id": uuid.uuid4(),
            "status": "to_read",
            "visibility": "private",
            "rating": None,
            "tags": None,
        },
    )()
    session.scalar_values = [uuid.uuid4(), existing]

    item, created = create_or_get_library_item(
        cast(Any, session),
        user_id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        status=None,
        visibility=None,
        rating=None,
        tags=None,
        preferred_edition_id=None,
    )
    assert item is existing
    assert created is False


def test_create_or_get_library_item_creates_new() -> None:
    session = FakeSession()
    session.scalar_values = [uuid.uuid4(), None]

    item, created = create_or_get_library_item(
        cast(Any, session),
        user_id=uuid.uuid4(),
        work_id=uuid.uuid4(),
        status="reading",
        visibility="public",
        rating=8,
        tags=["tag"],
        preferred_edition_id=None,
    )
    assert created is True
    assert item.status == "reading"
    assert session.committed is True


def test_create_or_get_library_item_creates_profile_for_first_time_user() -> None:
    session = FakeSession()
    user_id = uuid.uuid4()
    work_id = uuid.uuid4()
    session.scalar_values = [work_id, None]

    item, created = create_or_get_library_item(
        cast(Any, session),
        user_id=user_id,
        work_id=work_id,
        status=None,
        visibility=None,
        rating=None,
        tags=None,
        preferred_edition_id=None,
    )

    assert created is True
    assert item.user_id == user_id
    assert isinstance(session.added[0], User)
    assert isinstance(session.added[1], LibraryItem)
    assert session.added[0].id == user_id


def test_list_library_items_invalid_cursor() -> None:
    session = FakeSession()
    with pytest.raises(ValueError):
        list_library_items(
            cast(Any, session),
            user_id=uuid.uuid4(),
            limit=10,
            cursor="bad",
            status=None,
            tag=None,
            visibility=None,
        )


def test_list_library_items_returns_cursor() -> None:
    session = FakeSession()
    now = dt.datetime.now(tz=dt.UTC).replace(microsecond=0)
    item1 = type(
        "Item",
        (),
        {
            "id": uuid.uuid4(),
            "work_id": uuid.uuid4(),
            "status": "reading",
            "visibility": "private",
            "rating": None,
            "tags": [],
            "created_at": now,
        },
    )()
    item2 = type(
        "Item",
        (),
        {
            "id": uuid.uuid4(),
            "work_id": uuid.uuid4(),
            "status": "reading",
            "visibility": "private",
            "rating": None,
            "tags": [],
            "created_at": now,
        },
    )()
    session.execute_results = [
        [
            (
                item1,
                "One",
                "First description",
                None,
                dt.datetime(2026, 2, 10, 12, 0, tzinfo=dt.UTC),
            ),
            (item2, "Two", None, "https://example.com/cover.jpg", None),
        ],
        # Author lookup for the page.
        [(item1.work_id, "Author A"), (item1.work_id, "Author A")],
    ]

    result = list_library_items(
        cast(Any, session),
        user_id=uuid.uuid4(),
        limit=1,
        cursor=None,
        status="reading",
        tag=None,
        visibility=None,
    )
    assert len(result["items"]) == 1
    assert result["items"][0]["cover_url"] in (None, "https://example.com/cover.jpg")
    assert result["items"][0]["work_description"] == "First description"
    assert result["items"][0]["author_names"] == ["Author A"]
    assert result["items"][0]["last_read_at"] == "2026-02-10T12:00:00+00:00"
    assert result["next_cursor"] is not None


def test_get_library_item_by_work_returns_none_when_missing() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    item = get_library_item_by_work(
        cast(Any, session),
        user_id=uuid.uuid4(),
        work_id=uuid.uuid4(),
    )
    assert item is None


def test_update_library_item_requires_at_least_one_field() -> None:
    session = FakeSession()
    with pytest.raises(ValueError):
        update_library_item(
            cast(Any, session),
            user_id=uuid.uuid4(),
            item_id=uuid.uuid4(),
            updates={},
        )


def test_update_library_item_requires_ownership() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        update_library_item(
            cast(Any, session),
            user_id=uuid.uuid4(),
            item_id=uuid.uuid4(),
            updates={"status": "reading"},
        )


def test_update_library_item_applies_requested_fields() -> None:
    session = FakeSession()
    item = type(
        "Item",
        (),
        {
            "id": uuid.uuid4(),
            "work_id": uuid.uuid4(),
            "status": "to_read",
            "visibility": "private",
            "rating": None,
            "tags": [],
            "preferred_edition_id": None,
        },
    )()
    session.scalar_values = [item]

    updated = update_library_item(
        cast(Any, session),
        user_id=uuid.uuid4(),
        item_id=item.id,
        updates={"status": "reading", "rating": 9, "tags": ["memoir"]},
    )

    assert updated is item
    assert item.status == "reading"
    assert item.rating == 9
    assert item.tags == ["memoir"]
    assert session.committed is True


def test_delete_library_item_requires_ownership() -> None:
    session = FakeSession()
    session.scalar_values = [None]
    with pytest.raises(LookupError):
        delete_library_item(
            cast(Any, session),
            user_id=uuid.uuid4(),
            item_id=uuid.uuid4(),
        )


def test_delete_library_item_deletes_and_commits() -> None:
    session = FakeSession()
    item = object()
    session.scalar_values = [item]

    delete_library_item(
        cast(Any, session),
        user_id=uuid.uuid4(),
        item_id=uuid.uuid4(),
    )

    assert session.deleted == [item]
    assert session.committed is True


def test_get_library_item_by_work_detail_returns_cover_url() -> None:
    session = FakeSession()
    item = type(
        "Item",
        (),
        {
            "id": uuid.uuid4(),
            "work_id": uuid.uuid4(),
            "preferred_edition_id": None,
            "status": "reading",
            "visibility": "private",
            "rating": None,
            "tags": [],
            "created_at": dt.datetime.now(tz=dt.UTC).replace(microsecond=0),
        },
    )()
    session.execute_results = [[(item, "https://example.com/cover.jpg")]]

    result = get_library_item_by_work_detail(
        cast(Any, session),
        user_id=uuid.uuid4(),
        work_id=item.work_id,
    )
    assert result is not None
    assert result["cover_url"] == "https://example.com/cover.jpg"
