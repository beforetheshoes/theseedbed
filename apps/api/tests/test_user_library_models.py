from typing import cast

import sqlalchemy as sa

from app.db.base import Base
from app.db.models import (
    LibraryItem,
    LibraryItemMergeEvent,
    ReadingProgressLog,
    ReadingSession,
    ReadingStateEvent,
    User,
)


def _get_table(name: str) -> sa.Table:
    return Base.metadata.tables[name]


def test_user_library_tables_registered() -> None:
    assert User.__tablename__ in Base.metadata.tables
    assert LibraryItem.__tablename__ in Base.metadata.tables
    assert ReadingSession.__tablename__ in Base.metadata.tables
    assert ReadingProgressLog.__tablename__ in Base.metadata.tables
    assert ReadingStateEvent.__tablename__ in Base.metadata.tables
    assert LibraryItemMergeEvent.__tablename__ in Base.metadata.tables


def test_users_table_schema() -> None:
    table = _get_table("users")
    assert set(table.columns.keys()) == {
        "id",
        "handle",
        "display_name",
        "avatar_url",
        "enable_google_books",
        "default_progress_unit",
        "actor_uri",
        "created_at",
        "updated_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert table.columns["id"].server_default is None
    assert isinstance(table.columns["handle"].type, sa.String)
    assert table.columns["handle"].type.length == 64
    assert isinstance(table.columns["display_name"].type, sa.String)
    assert table.columns["display_name"].type.length == 255
    assert isinstance(table.columns["avatar_url"].type, sa.Text)
    assert isinstance(table.columns["enable_google_books"].type, sa.Boolean)
    assert isinstance(table.columns["default_progress_unit"].type, sa.Enum)
    assert table.columns["default_progress_unit"].type.enums == [
        "pages_read",
        "percent_complete",
        "minutes_listened",
    ]

    created_at_type = cast(sa.DateTime, table.columns["created_at"].type)
    updated_at_type = cast(sa.DateTime, table.columns["updated_at"].type)
    assert created_at_type.timezone is True
    assert updated_at_type.timezone is True

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "auth.users.id" in fk_targets
    auth_fk = next(
        fk for fk in table.foreign_keys if fk.target_fullname == "auth.users.id"
    )
    assert auth_fk.ondelete == "CASCADE"

    unique_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    ]
    unique_sets = {
        tuple(constraint.columns.keys()) for constraint in unique_constraints
    }
    assert ("handle",) in unique_sets

    assert not table.indexes


def test_library_items_table_schema() -> None:
    table = _get_table("library_items")
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "work_id",
        "preferred_edition_id",
        "status",
        "visibility",
        "rating",
        "tags",
        "cover_override_url",
        "cover_override_storage_path",
        "cover_override_set_by",
        "cover_override_set_at",
        "created_at",
        "updated_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert isinstance(table.columns["user_id"].type, sa.UUID)
    assert isinstance(table.columns["work_id"].type, sa.UUID)
    assert isinstance(table.columns["preferred_edition_id"].type, sa.UUID)
    assert isinstance(table.columns["status"].type, sa.Enum)
    assert table.columns["status"].type.enums == [
        "to_read",
        "reading",
        "completed",
        "abandoned",
    ]
    assert isinstance(table.columns["visibility"].type, sa.Enum)
    assert table.columns["visibility"].type.enums == ["private", "public"]
    assert isinstance(table.columns["rating"].type, sa.SmallInteger)
    assert isinstance(table.columns["tags"].type, sa.ARRAY)
    assert isinstance(table.columns["tags"].type.item_type, sa.String)
    assert table.columns["tags"].type.item_type.length == 64

    created_at_type = cast(sa.DateTime, table.columns["created_at"].type)
    updated_at_type = cast(sa.DateTime, table.columns["updated_at"].type)
    assert created_at_type.timezone is True
    assert updated_at_type.timezone is True

    unique_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.UniqueConstraint)
    ]
    unique_sets = {
        tuple(constraint.columns.keys()) for constraint in unique_constraints
    }
    assert ("user_id", "work_id") in unique_sets

    check_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    ]
    check_names = {constraint.name for constraint in check_constraints}
    assert "ck_library_items_rating_range" in check_names

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "users.id" in fk_targets
    assert "works.id" in fk_targets
    assert "editions.id" in fk_targets

    users_fk = next(fk for fk in table.foreign_keys if fk.target_fullname == "users.id")
    works_fk = next(fk for fk in table.foreign_keys if fk.target_fullname == "works.id")
    editions_fk = next(
        fk for fk in table.foreign_keys if fk.target_fullname == "editions.id"
    )
    assert users_fk.ondelete == "CASCADE"
    assert works_fk.ondelete == "RESTRICT"
    assert editions_fk.ondelete == "SET NULL"

    index_names = {index.name for index in table.indexes}
    assert "ix_library_items_user_id" in index_names
    assert "ix_library_items_status" in index_names
    assert "ix_library_items_visibility" in index_names
    assert "ix_library_items_tags" in index_names
    tags_index = next(
        index for index in table.indexes if index.name == "ix_library_items_tags"
    )
    assert tags_index.dialect_options["postgresql"]["using"] == "gin"


def test_reading_sessions_table_schema() -> None:
    table = _get_table("reading_sessions")
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "library_item_id",
        "started_at",
        "ended_at",
        "title",
        "note",
        "created_at",
        "updated_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert isinstance(table.columns["user_id"].type, sa.UUID)
    assert isinstance(table.columns["library_item_id"].type, sa.UUID)
    assert isinstance(table.columns["started_at"].type, sa.DateTime)
    assert isinstance(table.columns["ended_at"].type, sa.DateTime)
    assert isinstance(table.columns["title"].type, sa.String)
    assert isinstance(table.columns["note"].type, sa.Text)

    started_at_type = table.columns["started_at"].type
    ended_at_type = table.columns["ended_at"].type
    assert started_at_type.timezone is True
    assert ended_at_type.timezone is True

    created_at_type = cast(sa.DateTime, table.columns["created_at"].type)
    updated_at_type = cast(sa.DateTime, table.columns["updated_at"].type)
    assert created_at_type.timezone is True
    assert updated_at_type.timezone is True

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "users.id" in fk_targets
    assert "library_items.id" in fk_targets
    user_fk = next(fk for fk in table.foreign_keys if fk.target_fullname == "users.id")
    library_item_fk = next(
        fk for fk in table.foreign_keys if fk.target_fullname == "library_items.id"
    )
    assert user_fk.ondelete == "CASCADE"
    assert library_item_fk.ondelete == "CASCADE"

    check_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    ]
    check_names = {constraint.name for constraint in check_constraints}
    assert "ck_reading_sessions_ended_after_start" in check_names

    index_names = {index.name for index in table.indexes}
    assert "ix_reading_sessions_user_id" in index_names
    assert "ix_reading_sessions_library_item_id" in index_names


def test_reading_progress_logs_table_schema() -> None:
    table = _get_table("reading_progress_logs")
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "library_item_id",
        "reading_session_id",
        "logged_at",
        "unit",
        "value",
        "canonical_percent",
        "note",
        "created_at",
        "updated_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert isinstance(table.columns["user_id"].type, sa.UUID)
    assert isinstance(table.columns["library_item_id"].type, sa.UUID)
    assert isinstance(table.columns["reading_session_id"].type, sa.UUID)
    assert isinstance(table.columns["logged_at"].type, sa.DateTime)
    assert isinstance(table.columns["unit"].type, sa.Enum)
    assert table.columns["unit"].type.enums == [
        "pages_read",
        "percent_complete",
        "minutes_listened",
    ]
    assert isinstance(table.columns["value"].type, sa.Numeric)
    assert isinstance(table.columns["canonical_percent"].type, sa.Numeric)
    assert isinstance(table.columns["note"].type, sa.Text)

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "users.id" in fk_targets
    assert "library_items.id" in fk_targets
    assert "reading_sessions.id" in fk_targets

    check_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    ]
    check_names = {constraint.name for constraint in check_constraints}
    assert "ck_reading_progress_logs_value_nonnegative" in check_names
    assert "ck_reading_progress_logs_canonical_percent_range" in check_names

    index_names = {index.name for index in table.indexes}
    assert "ix_reading_progress_logs_user_id" in index_names
    assert "ix_reading_progress_logs_library_item_logged_at" in index_names
    assert "ix_reading_progress_logs_session_logged_at" in index_names


def test_reading_state_events_table_schema() -> None:
    table = _get_table("reading_state_events")
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "library_item_id",
        "event_type",
        "occurred_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert isinstance(table.columns["user_id"].type, sa.UUID)
    assert isinstance(table.columns["library_item_id"].type, sa.UUID)
    assert isinstance(table.columns["event_type"].type, sa.String)
    assert table.columns["event_type"].type.length == 32

    occurred_at_type = cast(sa.DateTime, table.columns["occurred_at"].type)
    assert occurred_at_type.timezone is True

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "users.id" in fk_targets
    assert "library_items.id" in fk_targets
    user_fk = next(fk for fk in table.foreign_keys if fk.target_fullname == "users.id")
    library_item_fk = next(
        fk for fk in table.foreign_keys if fk.target_fullname == "library_items.id"
    )
    assert user_fk.ondelete == "CASCADE"
    assert library_item_fk.ondelete == "CASCADE"

    index_names = {index.name for index in table.indexes}
    assert "ix_reading_state_events_user_id" in index_names
    assert "ix_reading_state_events_library_item_id" in index_names
    assert "ix_reading_state_events_occurred_at" in index_names


def test_library_item_merge_events_table_schema() -> None:
    table = _get_table("library_item_merge_events")
    assert set(table.columns.keys()) == {
        "id",
        "user_id",
        "target_library_item_id",
        "source_library_item_ids",
        "field_resolution",
        "result_summary",
        "created_at",
    }
    assert isinstance(table.columns["id"].type, sa.UUID)
    assert isinstance(table.columns["user_id"].type, sa.UUID)
    assert isinstance(table.columns["target_library_item_id"].type, sa.UUID)
    assert isinstance(table.columns["source_library_item_ids"].type, sa.ARRAY)
    assert isinstance(table.columns["field_resolution"].type, sa.JSON)
    assert isinstance(table.columns["result_summary"].type, sa.JSON)
    created_at_type = cast(sa.DateTime, table.columns["created_at"].type)
    assert created_at_type.timezone is True

    fk_targets = {fk.target_fullname for fk in table.foreign_keys}
    assert "users.id" in fk_targets
    assert "library_items.id" in fk_targets
    users_fk = next(fk for fk in table.foreign_keys if fk.target_fullname == "users.id")
    target_fk = next(
        fk for fk in table.foreign_keys if fk.target_fullname == "library_items.id"
    )
    assert users_fk.ondelete == "CASCADE"
    assert target_fk.ondelete == "SET NULL"

    check_constraints = [
        constraint
        for constraint in table.constraints
        if isinstance(constraint, sa.CheckConstraint)
    ]
    check_names = {constraint.name for constraint in check_constraints}
    assert "ck_library_item_merge_events_source_nonempty" in check_names

    index_names = {index.name for index in table.indexes}
    assert "ix_library_item_merge_events_user_id" in index_names
    assert "ix_library_item_merge_events_created_at" in index_names
    assert "ix_library_item_merge_events_target_library_item_id" in index_names
