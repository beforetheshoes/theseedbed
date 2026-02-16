"""Add per-user default progress unit preference.

Revision ID: 0017_user_default_progress_unit
Revises: 0016_reading_sessions_v2
Create Date: 2026-02-16
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision = "0017_user_default_progress_unit"
down_revision = "0016_reading_sessions_v2"
branch_labels = None
depends_on = None


def _column_exists(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = inspector.get_columns(table_name)
    return any(column["name"] == column_name for column in columns)


def upgrade() -> None:
    if _column_exists("users", "default_progress_unit"):
        return

    reading_progress_unit = postgresql.ENUM(
        "pages_read",
        "percent_complete",
        "minutes_listened",
        name="reading_progress_unit",
        create_type=False,
    )
    op.add_column(
        "users",
        sa.Column(
            "default_progress_unit",
            reading_progress_unit,
            nullable=False,
            server_default=sa.text("'pages_read'::reading_progress_unit"),
        ),
    )


def downgrade() -> None:
    if not _column_exists("users", "default_progress_unit"):
        return

    op.drop_column("users", "default_progress_unit")
