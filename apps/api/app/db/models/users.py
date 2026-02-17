from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

library_item_status_enum = ENUM(
    "to_read",
    "reading",
    "completed",
    "abandoned",
    name="library_item_status",
    create_type=False,
)
library_item_visibility_enum = ENUM(
    "private",
    "public",
    name="library_item_visibility",
    create_type=False,
)
reading_progress_unit_enum = ENUM(
    "pages_read",
    "percent_complete",
    "minutes_listened",
    name="reading_progress_unit",
    create_type=False,
)

# Minimal auth.users metadata so SQLAlchemy can resolve FK dependency
# for public.users.id -> auth.users.id during flush ordering.
auth_users_table = sa.Table(
    "users",
    Base.metadata,
    sa.Column("id", sa.UUID(as_uuid=True), primary_key=True),
    schema="auth",
)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (sa.UniqueConstraint("handle", name="uq_users_handle"),)

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("auth.users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    handle: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(sa.String(255))
    avatar_url: Mapped[str | None] = mapped_column(sa.Text)
    enable_google_books: Mapped[bool] = mapped_column(
        sa.Boolean,
        nullable=False,
        server_default=sa.text("false"),
    )
    theme_primary_color: Mapped[str | None] = mapped_column(sa.Text)
    theme_accent_color: Mapped[str | None] = mapped_column(sa.Text)
    theme_font_family: Mapped[str | None] = mapped_column(sa.String(32))
    theme_heading_font_family: Mapped[str | None] = mapped_column(sa.String(32))
    default_progress_unit: Mapped[str] = mapped_column(
        reading_progress_unit_enum,
        nullable=False,
        server_default=sa.text("'pages_read'::reading_progress_unit"),
    )
    actor_uri: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class LibraryItem(Base):
    __tablename__ = "library_items"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id",
            "work_id",
            name="uq_library_items_user_work",
        ),
        sa.CheckConstraint(
            "rating >= 0 AND rating <= 10",
            name="ck_library_items_rating_range",
        ),
        sa.Index("ix_library_items_user_id", "user_id"),
        sa.Index("ix_library_items_status", "status"),
        sa.Index("ix_library_items_visibility", "visibility"),
        sa.Index("ix_library_items_tags", "tags", postgresql_using="gin"),
        sa.Index(
            "ix_library_items_user_created_at_id",
            "user_id",
            "created_at",
            "id",
        ),
        sa.Index("ix_library_items_user_rating_id", "user_id", "rating", "id"),
        sa.Index(
            "ix_library_items_user_status_created_at",
            "user_id",
            "status",
            "created_at",
        ),
        sa.Index(
            "ix_library_items_user_visibility_created_at",
            "user_id",
            "visibility",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    work_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("works.id", ondelete="RESTRICT"),
        nullable=False,
    )
    preferred_edition_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("editions.id", ondelete="SET NULL"),
    )
    status: Mapped[str] = mapped_column(library_item_status_enum, nullable=False)
    visibility: Mapped[str] = mapped_column(
        library_item_visibility_enum,
        nullable=False,
    )
    rating: Mapped[int | None] = mapped_column(sa.SmallInteger)
    tags: Mapped[list[str] | None] = mapped_column(ARRAY(sa.String(64)))
    cover_override_url: Mapped[str | None] = mapped_column(sa.Text)
    cover_override_storage_path: Mapped[str | None] = mapped_column(sa.Text)
    cover_override_set_by: Mapped[uuid.UUID | None] = mapped_column(
        sa.UUID(as_uuid=True)
    )
    cover_override_set_at: Mapped[dt.datetime | None] = mapped_column(
        sa.DateTime(timezone=True)
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class ReadingSession(Base):
    __tablename__ = "reading_sessions"
    __table_args__ = (
        sa.CheckConstraint(
            "ended_at IS NULL OR ended_at >= started_at",
            name="ck_reading_sessions_ended_after_start",
        ),
        sa.Index("ix_reading_sessions_user_id", "user_id"),
        sa.Index("ix_reading_sessions_library_item_id", "library_item_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    library_item_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("library_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    started_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
    )
    ended_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    title: Mapped[str | None] = mapped_column(sa.String(255))
    note: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class ReadingProgressLog(Base):
    __tablename__ = "reading_progress_logs"
    __table_args__ = (
        sa.CheckConstraint(
            "value >= 0",
            name="ck_reading_progress_logs_value_nonnegative",
        ),
        sa.CheckConstraint(
            "canonical_percent IS NULL OR (canonical_percent >= 0 AND canonical_percent <= 100)",
            name="ck_reading_progress_logs_canonical_percent_range",
        ),
        sa.Index("ix_reading_progress_logs_user_id", "user_id"),
        sa.Index(
            "ix_reading_progress_logs_library_item_logged_at",
            "library_item_id",
            sa.text("logged_at DESC"),
        ),
        sa.Index(
            "ix_reading_progress_logs_session_logged_at",
            "reading_session_id",
            sa.text("logged_at DESC"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    library_item_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("library_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    reading_session_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("reading_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    logged_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
    )
    unit: Mapped[str] = mapped_column(reading_progress_unit_enum, nullable=False)
    value: Mapped[float] = mapped_column(sa.Numeric(10, 2), nullable=False)
    canonical_percent: Mapped[float | None] = mapped_column(sa.Numeric(6, 3))
    note: Mapped[str | None] = mapped_column(sa.Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class ReadingStateEvent(Base):
    __tablename__ = "reading_state_events"
    __table_args__ = (
        sa.Index("ix_reading_state_events_user_id", "user_id"),
        sa.Index("ix_reading_state_events_library_item_id", "library_item_id"),
        sa.Index("ix_reading_state_events_occurred_at", "occurred_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    library_item_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("library_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    event_type: Mapped[str] = mapped_column(sa.String(32), nullable=False)
    occurred_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class LibraryItemMergeEvent(Base):
    __tablename__ = "library_item_merge_events"
    __table_args__ = (
        sa.CheckConstraint(
            "cardinality(source_library_item_ids) >= 1",
            name="ck_library_item_merge_events_source_nonempty",
        ),
        sa.Index("ix_library_item_merge_events_user_id", "user_id"),
        sa.Index("ix_library_item_merge_events_created_at", "created_at"),
        sa.Index(
            "ix_library_item_merge_events_target_library_item_id",
            "target_library_item_id",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_library_item_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("library_items.id", ondelete="SET NULL"),
    )
    source_library_item_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(sa.UUID(as_uuid=True)),
        nullable=False,
    )
    field_resolution: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )
    result_summary: Mapped[dict[str, object]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa.text("'{}'::jsonb"),
    )
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
