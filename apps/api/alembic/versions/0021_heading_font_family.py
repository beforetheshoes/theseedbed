"""Add theme_heading_font_family column.

Revision ID: 0021_heading_font_family
Revises: 0020_user_theme_preferences
Create Date: 2026-02-17
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0021_heading_font_family"
down_revision = "0020_user_theme_preferences"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if not _column_exists("users", "theme_heading_font_family"):
        op.add_column(
            "users",
            sa.Column("theme_heading_font_family", sa.String(length=32), nullable=True),
        )


def downgrade() -> None:
    if _column_exists("users", "theme_heading_font_family"):
        op.drop_column("users", "theme_heading_font_family")
