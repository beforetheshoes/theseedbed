"""Add enrichment no-match cache and provider daily usage tables.

Revision ID: 0024_enrichment_budget
Revises: 0023_enrichment_tasks
Create Date: 2026-02-19
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy import inspect

from alembic import op

revision = "0024_enrichment_budget"
down_revision = "0023_enrichment_tasks"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return inspect(op.get_bind()).has_table(table_name, schema="public")


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return any(
        index.get("name") == index_name
        for index in inspector.get_indexes(table_name, schema="public")
    )


def upgrade() -> None:
    if not _has_table("enrichment_no_match_cache"):
        op.create_table(
            "enrichment_no_match_cache",
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
                "work_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("works.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("provider", sa.String(length=64), nullable=False),
            sa.Column("reason", sa.Text),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
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
            sa.UniqueConstraint(
                "user_id",
                "work_id",
                "provider",
                name="uq_enrichment_no_match_cache_user_work_provider",
            ),
        )

    if not _has_index(
        "enrichment_no_match_cache", "ix_enrichment_no_match_cache_expires_at"
    ):
        op.create_index(
            "ix_enrichment_no_match_cache_expires_at",
            "enrichment_no_match_cache",
            ["expires_at"],
        )

    if not _has_table("enrichment_provider_daily_usage"):
        op.create_table(
            "enrichment_provider_daily_usage",
            sa.Column(
                "id",
                sa.UUID(as_uuid=True),
                primary_key=True,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column("usage_date", sa.Date(), nullable=False),
            sa.Column("provider", sa.String(length=64), nullable=False),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
            ),
            sa.Column(
                "request_count",
                sa.Integer(),
                nullable=False,
                server_default=sa.text("0"),
            ),
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
            sa.UniqueConstraint(
                "usage_date",
                "provider",
                "user_id",
                name="uq_enrichment_provider_daily_usage_scope",
            ),
        )

    if not _has_index(
        "enrichment_provider_daily_usage",
        "ix_enrichment_provider_daily_usage_date_provider",
    ):
        op.create_index(
            "ix_enrichment_provider_daily_usage_date_provider",
            "enrichment_provider_daily_usage",
            ["usage_date", "provider"],
        )

    op.execute(
        "ALTER TABLE public.enrichment_no_match_cache ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS enrichment_no_match_cache_owner ON public.enrichment_no_match_cache;"
    )
    op.execute(
        """
        CREATE POLICY enrichment_no_match_cache_owner
        ON public.enrichment_no_match_cache
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute(
        "ALTER TABLE public.enrichment_provider_daily_usage ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS enrichment_provider_daily_usage_owner ON public.enrichment_provider_daily_usage;"
    )
    op.execute(
        """
        CREATE POLICY enrichment_provider_daily_usage_owner
        ON public.enrichment_provider_daily_usage
        FOR ALL
        TO authenticated
        USING (user_id IS NULL OR user_id = auth.uid())
        WITH CHECK (user_id IS NULL OR user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS enrichment_provider_daily_usage_owner ON public.enrichment_provider_daily_usage;"
    )
    op.execute(
        "DROP POLICY IF EXISTS enrichment_no_match_cache_owner ON public.enrichment_no_match_cache;"
    )

    op.drop_index(
        "ix_enrichment_provider_daily_usage_date_provider",
        table_name="enrichment_provider_daily_usage",
    )
    op.drop_table("enrichment_provider_daily_usage")

    op.drop_index(
        "ix_enrichment_no_match_cache_expires_at",
        table_name="enrichment_no_match_cache",
    )
    op.drop_table("enrichment_no_match_cache")
