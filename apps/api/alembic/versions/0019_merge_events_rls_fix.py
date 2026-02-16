"""Backfill RLS policy for library item merge events.

Revision ID: 0019_merge_events_rls_fix
Revises: 0018_library_item_merges
Create Date: 2026-02-16
"""

from __future__ import annotations

from alembic import op

# revision identifiers, used by Alembic.
revision = "0019_merge_events_rls_fix"
down_revision = "0018_library_item_merges"
branch_labels = None
depends_on = None


def upgrade() -> None:
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
    op.execute(
        "DROP POLICY IF EXISTS library_item_merge_events_owner ON public.library_item_merge_events;"
    )
