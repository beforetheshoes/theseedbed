from __future__ import annotations

import datetime as dt
import uuid

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY, ENUM, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

enrichment_task_status_enum = ENUM(
    "pending",
    "in_progress",
    "complete",
    "needs_review",
    "failed",
    "skipped",
    name="enrichment_task_status",
    create_type=False,
)

enrichment_task_confidence_enum = ENUM(
    "high",
    "medium",
    "low",
    "none",
    name="enrichment_task_confidence",
    create_type=False,
)

enrichment_trigger_source_enum = ENUM(
    "post_import",
    "manual_bulk",
    "lazy",
    name="enrichment_trigger_source",
    create_type=False,
)


enrichment_audit_action_enum = ENUM(
    "auto_applied",
    "queued_review",
    "skipped",
    "failed",
    "dismissed",
    "approved",
    name="enrichment_audit_action",
    create_type=False,
)


class LibraryItemEnrichmentTask(Base):
    __tablename__ = "library_item_enrichment_tasks"
    __table_args__ = (
        sa.Index(
            "ix_library_item_enrichment_tasks_status_next",
            "status",
            "next_attempt_after",
            "priority",
            "created_at",
        ),
        sa.Index(
            "ix_library_item_enrichment_tasks_user_status_created",
            "user_id",
            "status",
            "created_at",
        ),
        sa.Index(
            "uq_enrichment_task_active_dedupe",
            "user_id",
            "library_item_id",
            "idempotency_key",
            unique=True,
            postgresql_where=sa.text(
                "status IN ('pending', 'in_progress', 'needs_review')"
            ),
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
    work_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("works.id", ondelete="CASCADE"),
        nullable=False,
    )
    edition_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("editions.id", ondelete="SET NULL"),
    )
    trigger_source: Mapped[str] = mapped_column(enrichment_trigger_source_enum)
    import_source: Mapped[str | None] = mapped_column(sa.String(32))
    import_job_id: Mapped[uuid.UUID | None] = mapped_column(sa.UUID(as_uuid=True))
    status: Mapped[str] = mapped_column(
        enrichment_task_status_enum,
        nullable=False,
        server_default=sa.text("'pending'::enrichment_task_status"),
    )
    confidence: Mapped[str] = mapped_column(
        enrichment_task_confidence_enum,
        nullable=False,
        server_default=sa.text("'none'::enrichment_task_confidence"),
    )
    priority: Mapped[int] = mapped_column(
        sa.SmallInteger,
        nullable=False,
        server_default=sa.text("100"),
    )
    missing_fields: Mapped[list[str]] = mapped_column(
        ARRAY(sa.Text),
        nullable=False,
        server_default=sa.text("ARRAY[]::text[]"),
    )
    providers_attempted: Mapped[list[str]] = mapped_column(
        ARRAY(sa.Text),
        nullable=False,
        server_default=sa.text("ARRAY[]::text[]"),
    )
    fields_applied: Mapped[list[str]] = mapped_column(
        ARRAY(sa.Text),
        nullable=False,
        server_default=sa.text("ARRAY[]::text[]"),
    )
    match_details: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    attempt_count: Mapped[int] = mapped_column(
        sa.SmallInteger,
        nullable=False,
        server_default=sa.text("0"),
    )
    max_attempts: Mapped[int] = mapped_column(
        sa.SmallInteger,
        nullable=False,
        server_default=sa.text("3"),
    )
    next_attempt_after: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    last_error: Mapped[str | None] = mapped_column(sa.Text)
    idempotency_key: Mapped[str] = mapped_column(sa.String(255), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )
    started_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(sa.DateTime(timezone=True))
    updated_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class LibraryItemEnrichmentAuditLog(Base):
    __tablename__ = "library_item_enrichment_audit_log"
    __table_args__ = (
        sa.Index(
            "ix_library_item_enrichment_audit_user_created",
            "user_id",
            "created_at",
        ),
        sa.Index(
            "ix_library_item_enrichment_audit_task_created",
            "task_id",
            "created_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("library_item_enrichment_tasks.id", ondelete="CASCADE"),
        nullable=False,
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
    work_id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("works.id", ondelete="CASCADE"),
        nullable=False,
    )
    action: Mapped[str] = mapped_column(enrichment_audit_action_enum, nullable=False)
    provider: Mapped[str | None] = mapped_column(sa.String(64))
    confidence: Mapped[str] = mapped_column(
        enrichment_task_confidence_enum,
        nullable=False,
        server_default=sa.text("'none'::enrichment_task_confidence"),
    )
    fields_changed: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    details: Mapped[dict[str, object] | None] = mapped_column(JSONB)
    created_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


class EnrichmentNoMatchCache(Base):
    __tablename__ = "enrichment_no_match_cache"
    __table_args__ = (
        sa.UniqueConstraint(
            "user_id",
            "work_id",
            "provider",
            name="uq_enrichment_no_match_cache_user_work_provider",
        ),
        sa.Index(
            "ix_enrichment_no_match_cache_expires_at",
            "expires_at",
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
        sa.ForeignKey("works.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    reason: Mapped[str | None] = mapped_column(sa.Text)
    expires_at: Mapped[dt.datetime] = mapped_column(
        sa.DateTime(timezone=True),
        nullable=False,
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


class EnrichmentProviderDailyUsage(Base):
    __tablename__ = "enrichment_provider_daily_usage"
    __table_args__ = (
        sa.UniqueConstraint(
            "usage_date",
            "provider",
            "user_id",
            name="uq_enrichment_provider_daily_usage_scope",
        ),
        sa.Index(
            "ix_enrichment_provider_daily_usage_date_provider",
            "usage_date",
            "provider",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        sa.UUID(as_uuid=True),
        primary_key=True,
        server_default=sa.text("gen_random_uuid()"),
    )
    usage_date: Mapped[dt.date] = mapped_column(sa.Date, nullable=False)
    provider: Mapped[str] = mapped_column(sa.String(64), nullable=False)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        sa.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
    )
    request_count: Mapped[int] = mapped_column(
        sa.Integer,
        nullable=False,
        server_default=sa.text("0"),
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
