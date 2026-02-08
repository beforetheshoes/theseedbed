"""Add cover provenance columns.

Revision ID: 0008_cover_provenance
Revises: 0007_rls_policies
Create Date: 2026-02-08 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0008_cover_provenance"
down_revision = "0007_rls_policies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # CI starts Supabase (which applies supabase/migrations) and then runs Alembic.
    # Make this migration safe when the columns were already created by Supabase SQL.
    bind = op.get_bind()
    insp = sa.inspect(bind)

    editions_cols = {c["name"] for c in insp.get_columns("editions")}
    works_cols = {c["name"] for c in insp.get_columns("works")}

    if "cover_set_by" not in editions_cols:
        op.add_column("editions", sa.Column("cover_set_by", sa.UUID(as_uuid=True)))
    if "cover_set_at" not in editions_cols:
        op.add_column("editions", sa.Column("cover_set_at", sa.DateTime(timezone=True)))
    if "cover_storage_path" not in editions_cols:
        op.add_column("editions", sa.Column("cover_storage_path", sa.Text))

    if "default_cover_set_by" not in works_cols:
        op.add_column("works", sa.Column("default_cover_set_by", sa.UUID(as_uuid=True)))
    if "default_cover_set_at" not in works_cols:
        op.add_column(
            "works", sa.Column("default_cover_set_at", sa.DateTime(timezone=True))
        )
    if "default_cover_storage_path" not in works_cols:
        op.add_column("works", sa.Column("default_cover_storage_path", sa.Text))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    editions_cols = {c["name"] for c in insp.get_columns("editions")}
    works_cols = {c["name"] for c in insp.get_columns("works")}

    if "default_cover_storage_path" in works_cols:
        op.drop_column("works", "default_cover_storage_path")
    if "default_cover_set_at" in works_cols:
        op.drop_column("works", "default_cover_set_at")
    if "default_cover_set_by" in works_cols:
        op.drop_column("works", "default_cover_set_by")

    if "cover_storage_path" in editions_cols:
        op.drop_column("editions", "cover_storage_path")
    if "cover_set_at" in editions_cols:
        op.drop_column("editions", "cover_set_at")
    if "cover_set_by" in editions_cols:
        op.drop_column("editions", "cover_set_by")
