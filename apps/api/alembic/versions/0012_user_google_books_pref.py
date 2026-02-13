"""Add per-user Google Books opt-in preference.

Revision ID: 0012_user_google_books_pref
Revises: 0011_revoke_alembic_privs
Create Date: 2026-02-13
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0012_user_google_books_pref"
down_revision = "0011_revoke_alembic_privs"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if _column_exists("users", "enable_google_books"):
        return

    op.add_column(
        "users",
        sa.Column(
            "enable_google_books",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    if not _column_exists("users", "enable_google_books"):
        return

    op.drop_column("users", "enable_google_books")
