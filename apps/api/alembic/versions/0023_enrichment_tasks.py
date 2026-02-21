"""Add library item enrichment tasks and audit log.

Revision ID: 0023_enrichment_tasks
Revises: 0022_user_source_language
Create Date: 2026-02-19
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0023_enrichment_tasks"
down_revision = "0022_user_source_language"
branch_labels = None
depends_on = None


enrichment_task_status_enum = postgresql.ENUM(
    "pending",
    "in_progress",
    "complete",
    "needs_review",
    "failed",
    "skipped",
    name="enrichment_task_status",
)

enrichment_task_confidence_enum = postgresql.ENUM(
    "high",
    "medium",
    "low",
    "none",
    name="enrichment_task_confidence",
)

enrichment_trigger_source_enum = postgresql.ENUM(
    "post_import",
    "manual_bulk",
    "lazy",
    name="enrichment_trigger_source",
)

enrichment_audit_action_enum = postgresql.ENUM(
    "auto_applied",
    "queued_review",
    "skipped",
    "failed",
    "dismissed",
    "approved",
    name="enrichment_audit_action",
)

status_col = postgresql.ENUM(
    "pending",
    "in_progress",
    "complete",
    "needs_review",
    "failed",
    "skipped",
    name="enrichment_task_status",
    create_type=False,
)
confidence_col = postgresql.ENUM(
    "high",
    "medium",
    "low",
    "none",
    name="enrichment_task_confidence",
    create_type=False,
)
trigger_col = postgresql.ENUM(
    "post_import",
    "manual_bulk",
    "lazy",
    name="enrichment_trigger_source",
    create_type=False,
)
audit_action_col = postgresql.ENUM(
    "auto_applied",
    "queued_review",
    "skipped",
    "failed",
    "dismissed",
    "approved",
    name="enrichment_audit_action",
    create_type=False,
)


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name, schema="public")


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return any(
        index.get("name") == index_name
        for index in inspector.get_indexes(table_name, schema="public")
    )


def upgrade() -> None:
    enrichment_task_status_enum.create(op.get_bind(), checkfirst=True)
    enrichment_task_confidence_enum.create(op.get_bind(), checkfirst=True)
    enrichment_trigger_source_enum.create(op.get_bind(), checkfirst=True)
    enrichment_audit_action_enum.create(op.get_bind(), checkfirst=True)

    if not _has_table("library_item_enrichment_tasks"):
        op.create_table(
            "library_item_enrichment_tasks",
            sa.Column(
                "id",
                sa.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "library_item_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("library_items.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "work_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("works.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "edition_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("editions.id", ondelete="SET NULL"),
            ),
            sa.Column("trigger_source", trigger_col, nullable=False),
            sa.Column("import_source", sa.String(length=32)),
            sa.Column("import_job_id", sa.UUID(as_uuid=True)),
            sa.Column(
                "status",
                status_col,
                nullable=False,
                server_default=sa.text("'pending'::enrichment_task_status"),
            ),
            sa.Column(
                "confidence",
                confidence_col,
                nullable=False,
                server_default=sa.text("'none'::enrichment_task_confidence"),
            ),
            sa.Column(
                "priority",
                sa.SmallInteger,
                nullable=False,
                server_default=sa.text("100"),
            ),
            sa.Column(
                "missing_fields",
                postgresql.ARRAY(sa.Text()),
                nullable=False,
                server_default=sa.text("ARRAY[]::text[]"),
            ),
            sa.Column(
                "providers_attempted",
                postgresql.ARRAY(sa.Text()),
                nullable=False,
                server_default=sa.text("ARRAY[]::text[]"),
            ),
            sa.Column(
                "fields_applied",
                postgresql.ARRAY(sa.Text()),
                nullable=False,
                server_default=sa.text("ARRAY[]::text[]"),
            ),
            sa.Column("match_details", postgresql.JSONB()),
            sa.Column(
                "attempt_count",
                sa.SmallInteger,
                nullable=False,
                server_default=sa.text("0"),
            ),
            sa.Column(
                "max_attempts",
                sa.SmallInteger,
                nullable=False,
                server_default=sa.text("3"),
            ),
            sa.Column(
                "next_attempt_after",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("last_error", sa.Text()),
            sa.Column("idempotency_key", sa.String(length=255), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.Column("started_at", sa.DateTime(timezone=True)),
            sa.Column("finished_at", sa.DateTime(timezone=True)),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    if not _has_index(
        "library_item_enrichment_tasks", "ix_library_item_enrichment_tasks_status_next"
    ):
        op.create_index(
            "ix_library_item_enrichment_tasks_status_next",
            "library_item_enrichment_tasks",
            ["status", "next_attempt_after", "priority", "created_at"],
        )
    if not _has_index(
        "library_item_enrichment_tasks",
        "ix_library_item_enrichment_tasks_user_status_created",
    ):
        op.create_index(
            "ix_library_item_enrichment_tasks_user_status_created",
            "library_item_enrichment_tasks",
            ["user_id", "status", "created_at"],
        )
    if not _has_index(
        "library_item_enrichment_tasks", "uq_enrichment_task_active_dedupe"
    ):
        op.create_index(
            "uq_enrichment_task_active_dedupe",
            "library_item_enrichment_tasks",
            ["user_id", "library_item_id", "idempotency_key"],
            unique=True,
            postgresql_where=sa.text(
                "status IN ('pending', 'in_progress', 'needs_review')"
            ),
        )

    if not _has_table("library_item_enrichment_audit_log"):
        op.create_table(
            "library_item_enrichment_audit_log",
            sa.Column(
                "id",
                sa.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column(
                "task_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("library_item_enrichment_tasks.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "library_item_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("library_items.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "work_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("works.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("action", audit_action_col, nullable=False),
            sa.Column("provider", sa.String(length=64)),
            sa.Column(
                "confidence",
                confidence_col,
                nullable=False,
                server_default=sa.text("'none'::enrichment_task_confidence"),
            ),
            sa.Column("fields_changed", postgresql.JSONB()),
            sa.Column("details", postgresql.JSONB()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
        )

    if not _has_index(
        "library_item_enrichment_audit_log",
        "ix_library_item_enrichment_audit_user_created",
    ):
        op.create_index(
            "ix_library_item_enrichment_audit_user_created",
            "library_item_enrichment_audit_log",
            ["user_id", "created_at"],
        )
    if not _has_index(
        "library_item_enrichment_audit_log",
        "ix_library_item_enrichment_audit_task_created",
    ):
        op.create_index(
            "ix_library_item_enrichment_audit_task_created",
            "library_item_enrichment_audit_log",
            ["task_id", "created_at"],
        )

    op.execute(
        "ALTER TABLE public.library_item_enrichment_tasks ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS library_item_enrichment_tasks_owner ON public.library_item_enrichment_tasks;"
    )
    op.execute(
        """
        CREATE POLICY library_item_enrichment_tasks_owner
        ON public.library_item_enrichment_tasks
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute(
        "ALTER TABLE public.library_item_enrichment_audit_log ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS library_item_enrichment_audit_log_owner ON public.library_item_enrichment_audit_log;"
    )
    op.execute(
        """
        CREATE POLICY library_item_enrichment_audit_log_owner
        ON public.library_item_enrichment_audit_log
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS library_item_enrichment_audit_log_owner ON public.library_item_enrichment_audit_log;"
    )
    op.execute(
        "DROP POLICY IF EXISTS library_item_enrichment_tasks_owner ON public.library_item_enrichment_tasks;"
    )

    op.drop_index(
        "ix_library_item_enrichment_audit_task_created",
        table_name="library_item_enrichment_audit_log",
    )
    op.drop_index(
        "ix_library_item_enrichment_audit_user_created",
        table_name="library_item_enrichment_audit_log",
    )
    op.drop_table("library_item_enrichment_audit_log")

    op.drop_index(
        "ix_library_item_enrichment_tasks_user_status_created",
        table_name="library_item_enrichment_tasks",
    )
    op.drop_index(
        "ix_library_item_enrichment_tasks_status_next",
        table_name="library_item_enrichment_tasks",
    )
    op.drop_index(
        "uq_enrichment_task_active_dedupe",
        table_name="library_item_enrichment_tasks",
    )
    op.drop_table("library_item_enrichment_tasks")

    enrichment_audit_action_enum.drop(op.get_bind(), checkfirst=True)
    enrichment_trigger_source_enum.drop(op.get_bind(), checkfirst=True)
    enrichment_task_confidence_enum.drop(op.get_bind(), checkfirst=True)
    enrichment_task_status_enum.drop(op.get_bind(), checkfirst=True)
