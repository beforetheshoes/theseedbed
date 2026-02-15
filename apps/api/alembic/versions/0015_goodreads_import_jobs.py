"""Add Goodreads import jobs and row results.

Revision ID: 0015_goodreads_import_jobs
Revises: 0014_library_pagination_indexes
Create Date: 2026-02-14
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0015_goodreads_import_jobs"
down_revision = "0014_library_pagination_indexes"
branch_labels = None
depends_on = None


goodreads_import_job_status_enum = postgresql.ENUM(
    "queued",
    "running",
    "completed",
    "failed",
    name="goodreads_import_job_status",
)

goodreads_import_row_result_enum = postgresql.ENUM(
    "imported",
    "failed",
    "skipped",
    name="goodreads_import_row_result",
)

goodreads_import_job_status_enum_column = postgresql.ENUM(
    "queued",
    "running",
    "completed",
    "failed",
    name="goodreads_import_job_status",
    create_type=False,
)

goodreads_import_row_result_enum_column = postgresql.ENUM(
    "imported",
    "failed",
    "skipped",
    name="goodreads_import_row_result",
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
    goodreads_import_job_status_enum.create(op.get_bind(), checkfirst=True)
    goodreads_import_row_result_enum.create(op.get_bind(), checkfirst=True)

    if not _has_table("goodreads_import_jobs"):
        op.create_table(
            "goodreads_import_jobs",
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
            sa.Column(
                "status", goodreads_import_job_status_enum_column, nullable=False
            ),
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
    if not _has_index(
        "goodreads_import_jobs",
        "ix_goodreads_import_jobs_user_created",
    ):
        op.create_index(
            "ix_goodreads_import_jobs_user_created",
            "goodreads_import_jobs",
            ["user_id", "created_at"],
        )
    if not _has_index(
        "goodreads_import_jobs",
        "ix_goodreads_import_jobs_status",
    ):
        op.create_index(
            "ix_goodreads_import_jobs_status",
            "goodreads_import_jobs",
            ["status"],
        )

    if not _has_table("goodreads_import_job_rows"):
        op.create_table(
            "goodreads_import_job_rows",
            sa.Column(
                "id",
                sa.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column(
                "job_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("goodreads_import_jobs.id", ondelete="CASCADE"),
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
            sa.Column(
                "result", goodreads_import_row_result_enum_column, nullable=False
            ),
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
                name="uq_goodreads_import_job_rows_job_identity",
            ),
        )
    if not _has_index(
        "goodreads_import_job_rows",
        "ix_goodreads_import_job_rows_job_row",
    ):
        op.create_index(
            "ix_goodreads_import_job_rows_job_row",
            "goodreads_import_job_rows",
            ["job_id", "row_number"],
        )
    if not _has_index(
        "goodreads_import_job_rows",
        "ix_goodreads_import_job_rows_job_result",
    ):
        op.create_index(
            "ix_goodreads_import_job_rows_job_result",
            "goodreads_import_job_rows",
            ["job_id", "result"],
        )

    op.execute("ALTER TABLE public.goodreads_import_jobs ENABLE ROW LEVEL SECURITY;")
    op.execute(
        "DROP POLICY IF EXISTS goodreads_import_jobs_owner ON public.goodreads_import_jobs;"
    )
    op.execute(
        """
        CREATE POLICY goodreads_import_jobs_owner
        ON public.goodreads_import_jobs
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute(
        "ALTER TABLE public.goodreads_import_job_rows ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS goodreads_import_job_rows_owner ON public.goodreads_import_job_rows;"
    )
    op.execute(
        """
        CREATE POLICY goodreads_import_job_rows_owner
        ON public.goodreads_import_job_rows
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS goodreads_import_job_rows_owner ON public.goodreads_import_job_rows;"
    )
    op.execute(
        "DROP POLICY IF EXISTS goodreads_import_jobs_owner ON public.goodreads_import_jobs;"
    )

    op.drop_index(
        "ix_goodreads_import_job_rows_job_result",
        table_name="goodreads_import_job_rows",
    )
    op.drop_index(
        "ix_goodreads_import_job_rows_job_row",
        table_name="goodreads_import_job_rows",
    )
    op.drop_table("goodreads_import_job_rows")

    op.drop_index(
        "ix_goodreads_import_jobs_status",
        table_name="goodreads_import_jobs",
    )
    op.drop_index(
        "ix_goodreads_import_jobs_user_created",
        table_name="goodreads_import_jobs",
    )
    op.drop_table("goodreads_import_jobs")

    goodreads_import_row_result_enum.drop(op.get_bind(), checkfirst=True)
    goodreads_import_job_status_enum.drop(op.get_bind(), checkfirst=True)
