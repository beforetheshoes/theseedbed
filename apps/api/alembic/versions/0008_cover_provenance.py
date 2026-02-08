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
    op.add_column(
        "editions",
        sa.Column("cover_set_by", sa.UUID(as_uuid=True)),
    )
    op.add_column(
        "editions",
        sa.Column("cover_set_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "editions",
        sa.Column("cover_storage_path", sa.Text),
    )

    op.add_column(
        "works",
        sa.Column("default_cover_set_by", sa.UUID(as_uuid=True)),
    )
    op.add_column(
        "works",
        sa.Column("default_cover_set_at", sa.DateTime(timezone=True)),
    )
    op.add_column(
        "works",
        sa.Column("default_cover_storage_path", sa.Text),
    )


def downgrade() -> None:
    op.drop_column("works", "default_cover_storage_path")
    op.drop_column("works", "default_cover_set_at")
    op.drop_column("works", "default_cover_set_by")

    op.drop_column("editions", "cover_storage_path")
    op.drop_column("editions", "cover_set_at")
    op.drop_column("editions", "cover_set_by")
