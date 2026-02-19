"""Add per-user default source language preference.

Revision ID: 0022_user_source_language
Revises: 0021_heading_font_family
Create Date: 2026-02-19
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0022_user_source_language"
down_revision = "0021_heading_font_family"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if _column_exists("users", "default_source_language"):
        return

    op.add_column(
        "users",
        sa.Column(
            "default_source_language",
            sa.String(length=8),
            nullable=False,
            server_default=sa.text("'eng'"),
        ),
    )


def downgrade() -> None:
    if not _column_exists("users", "default_source_language"):
        return
    op.drop_column("users", "default_source_language")
