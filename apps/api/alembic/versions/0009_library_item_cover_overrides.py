"""Add per-user cover override columns to library_items.

Revision ID: 0009_cover_overrides
Revises: 0008_cover_provenance
Create Date: 2026-02-10 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# Alembic's default alembic_version.version_num is VARCHAR(32); keep revision <= 32 chars.
revision = "0009_cover_overrides"
down_revision = "0008_cover_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # CI starts Supabase (which applies supabase/migrations) and then runs Alembic.
    # Make this migration safe when the columns were already created by Supabase SQL.
    bind = op.get_bind()
    insp = sa.inspect(bind)

    cols = {c["name"] for c in insp.get_columns("library_items")}

    if "cover_override_url" not in cols:
        op.add_column("library_items", sa.Column("cover_override_url", sa.Text))
    if "cover_override_storage_path" not in cols:
        op.add_column(
            "library_items", sa.Column("cover_override_storage_path", sa.Text)
        )
    if "cover_override_set_by" not in cols:
        op.add_column(
            "library_items", sa.Column("cover_override_set_by", sa.UUID(as_uuid=True))
        )
    if "cover_override_set_at" not in cols:
        op.add_column(
            "library_items",
            sa.Column("cover_override_set_at", sa.DateTime(timezone=True)),
        )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    cols = {c["name"] for c in insp.get_columns("library_items")}

    if "cover_override_set_at" in cols:
        op.drop_column("library_items", "cover_override_set_at")
    if "cover_override_set_by" in cols:
        op.drop_column("library_items", "cover_override_set_by")
    if "cover_override_storage_path" in cols:
        op.drop_column("library_items", "cover_override_storage_path")
    if "cover_override_url" in cols:
        op.drop_column("library_items", "cover_override_url")
