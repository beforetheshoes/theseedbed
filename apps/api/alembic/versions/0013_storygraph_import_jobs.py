"""Add StoryGraph import jobs and row results.

Revision ID: 0013_storygraph_import_jobs
Revises: 0012_user_google_books_pref
Create Date: 2026-02-14
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0013_storygraph_import_jobs"
down_revision = "0012_user_google_books_pref"
branch_labels = None
depends_on = None


storygraph_import_job_status_enum = postgresql.ENUM(
    "queued",
    "running",
    "completed",
    "failed",
    name="storygraph_import_job_status",
)

storygraph_import_row_result_enum = postgresql.ENUM(
    "imported",
    "failed",
    "skipped",
    name="storygraph_import_row_result",
)

storygraph_import_job_status_enum_column = postgresql.ENUM(
    "queued",
    "running",
    "completed",
    "failed",
    name="storygraph_import_job_status",
    create_type=False,
)

storygraph_import_row_result_enum_column = postgresql.ENUM(
    "imported",
    "failed",
    "skipped",
    name="storygraph_import_row_result",
    create_type=False,
)


def upgrade() -> None:
    storygraph_import_job_status_enum.create(op.get_bind(), checkfirst=True)
    storygraph_import_row_result_enum.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "storygraph_import_jobs",
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
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("status", storygraph_import_job_status_enum_column, nullable=False),
        sa.Column(
            "total_rows",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "processed_rows",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "imported_rows",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "failed_rows",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column(
            "skipped_rows",
            sa.Integer,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("error_summary", sa.Text),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_storygraph_import_jobs_user_created",
        "storygraph_import_jobs",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_storygraph_import_jobs_status",
        "storygraph_import_jobs",
        ["status"],
    )

    op.create_table(
        "storygraph_import_job_rows",
        sa.Column(
            "id",
            sa.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "job_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("storygraph_import_jobs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("row_number", sa.Integer, nullable=False),
        sa.Column("identity_hash", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=512)),
        sa.Column("uid", sa.String(length=255)),
        sa.Column("result", storygraph_import_row_result_enum_column, nullable=False),
        sa.Column("message", sa.Text, nullable=False),
        sa.Column("work_id", sa.UUID(as_uuid=True)),
        sa.Column("library_item_id", sa.UUID(as_uuid=True)),
        sa.Column("review_id", sa.UUID(as_uuid=True)),
        sa.Column("session_id", sa.UUID(as_uuid=True)),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.UniqueConstraint(
            "job_id",
            "identity_hash",
            name="uq_storygraph_import_job_rows_job_identity",
        ),
    )
    op.create_index(
        "ix_storygraph_import_job_rows_job_row",
        "storygraph_import_job_rows",
        ["job_id", "row_number"],
    )
    op.create_index(
        "ix_storygraph_import_job_rows_job_result",
        "storygraph_import_job_rows",
        ["job_id", "result"],
    )

    op.execute("ALTER TABLE public.storygraph_import_jobs ENABLE ROW LEVEL SECURITY;")
    op.execute(
        "DROP POLICY IF EXISTS storygraph_import_jobs_owner ON public.storygraph_import_jobs;"
    )
    op.execute(
        """
        CREATE POLICY storygraph_import_jobs_owner
        ON public.storygraph_import_jobs
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute(
        "ALTER TABLE public.storygraph_import_job_rows ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS storygraph_import_job_rows_owner ON public.storygraph_import_job_rows;"
    )
    op.execute(
        """
        CREATE POLICY storygraph_import_job_rows_owner
        ON public.storygraph_import_job_rows
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS storygraph_import_job_rows_owner ON public.storygraph_import_job_rows;"
    )
    op.execute(
        "DROP POLICY IF EXISTS storygraph_import_jobs_owner ON public.storygraph_import_jobs;"
    )

    op.drop_index(
        "ix_storygraph_import_job_rows_job_result",
        table_name="storygraph_import_job_rows",
    )
    op.drop_index(
        "ix_storygraph_import_job_rows_job_row",
        table_name="storygraph_import_job_rows",
    )
    op.drop_table("storygraph_import_job_rows")

    op.drop_index(
        "ix_storygraph_import_jobs_status",
        table_name="storygraph_import_jobs",
    )
    op.drop_index(
        "ix_storygraph_import_jobs_user_created",
        table_name="storygraph_import_jobs",
    )
    op.drop_table("storygraph_import_jobs")

    storygraph_import_row_result_enum.drop(op.get_bind(), checkfirst=True)
    storygraph_import_job_status_enum.drop(op.get_bind(), checkfirst=True)
