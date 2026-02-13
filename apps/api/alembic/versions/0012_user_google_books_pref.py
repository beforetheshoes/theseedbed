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


def upgrade() -> None:
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
    op.drop_column("users", "enable_google_books")
