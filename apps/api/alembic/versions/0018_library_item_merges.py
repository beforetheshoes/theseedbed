"""Add library item merge events and relax review uniqueness.

Revision ID: 0018_library_item_merges
Revises: 0017_user_default_progress_unit
Create Date: 2026-02-16
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "0018_library_item_merges"
down_revision = "0017_user_default_progress_unit"
branch_labels = None
depends_on = None


def _has_unique_constraint(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    constraints = inspector.get_unique_constraints(table_name)
    return any(constraint.get("name") == constraint_name for constraint in constraints)


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def upgrade() -> None:
    if _has_unique_constraint("reviews", "uq_reviews_user_library_item"):
        op.drop_constraint(
            "uq_reviews_user_library_item",
            "reviews",
            type_="unique",
        )

    if not _has_table("library_item_merge_events"):
        op.create_table(
            "library_item_merge_events",
            sa.Column(
                "id",
                sa.UUID(as_uuid=True),
                primary_key=True,
                nullable=False,
                server_default=sa.text("gen_random_uuid()"),
            ),
            sa.Column(
                "user_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "target_library_item_id",
                sa.UUID(as_uuid=True),
                sa.ForeignKey("library_items.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column(
                "source_library_item_ids",
                postgresql.ARRAY(sa.UUID(as_uuid=True)),
                nullable=False,
            ),
            sa.Column(
                "field_resolution",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column(
                "result_summary",
                postgresql.JSONB,
                nullable=False,
                server_default=sa.text("'{}'::jsonb"),
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("now()"),
            ),
            sa.CheckConstraint(
                "cardinality(source_library_item_ids) >= 1",
                name="ck_library_item_merge_events_source_nonempty",
            ),
        )
        op.create_index(
            "ix_library_item_merge_events_user_id",
            "library_item_merge_events",
            ["user_id"],
        )
        op.create_index(
            "ix_library_item_merge_events_created_at",
            "library_item_merge_events",
            ["created_at"],
        )
        op.create_index(
            "ix_library_item_merge_events_target_library_item_id",
            "library_item_merge_events",
            ["target_library_item_id"],
        )
    op.execute(
        "ALTER TABLE public.library_item_merge_events ENABLE ROW LEVEL SECURITY;"
    )
    op.execute(
        "DROP POLICY IF EXISTS library_item_merge_events_owner ON public.library_item_merge_events;"
    )
    op.execute(
        """
        CREATE POLICY library_item_merge_events_owner
        ON public.library_item_merge_events
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    if _has_table("library_item_merge_events"):
        op.execute(
            "DROP POLICY IF EXISTS library_item_merge_events_owner ON public.library_item_merge_events;"
        )
        op.drop_index(
            "ix_library_item_merge_events_target_library_item_id",
            table_name="library_item_merge_events",
        )
        op.drop_index(
            "ix_library_item_merge_events_created_at",
            table_name="library_item_merge_events",
        )
        op.drop_index(
            "ix_library_item_merge_events_user_id",
            table_name="library_item_merge_events",
        )
        op.drop_table("library_item_merge_events")

    if not _has_unique_constraint("reviews", "uq_reviews_user_library_item"):
        op.create_unique_constraint(
            "uq_reviews_user_library_item",
            "reviews",
            ["user_id", "library_item_id"],
        )
