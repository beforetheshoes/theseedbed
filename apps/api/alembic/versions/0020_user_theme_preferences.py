"""Add user theme preference columns.

Revision ID: 0020_user_theme_preferences
Revises: 0019_merge_events_rls_fix
Create Date: 2026-02-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0020_user_theme_preferences"
down_revision = "0019_merge_events_rls_fix"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if not _column_exists("users", "theme_primary_color"):
        op.add_column(
            "users", sa.Column("theme_primary_color", sa.Text(), nullable=True)
        )
    if not _column_exists("users", "theme_accent_color"):
        op.add_column(
            "users", sa.Column("theme_accent_color", sa.Text(), nullable=True)
        )
    if not _column_exists("users", "theme_font_family"):
        op.add_column(
            "users", sa.Column("theme_font_family", sa.String(length=32), nullable=True)
        )


def downgrade() -> None:
    if _column_exists("users", "theme_font_family"):
        op.drop_column("users", "theme_font_family")
    if _column_exists("users", "theme_accent_color"):
        op.drop_column("users", "theme_accent_color")
    if _column_exists("users", "theme_primary_color"):
        op.drop_column("users", "theme_primary_color")
