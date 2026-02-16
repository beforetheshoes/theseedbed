"""Reading sessions v2 foundation: read cycles + progress logs.

Revision ID: 0016_reading_sessions_v2
Revises: 0015_goodreads_import_jobs
Create Date: 2026-02-16 00:00:00
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0016_reading_sessions_v2"
down_revision = "0015_goodreads_import_jobs"
branch_labels = None
depends_on = None

reading_progress_unit_enum = postgresql.ENUM(
    "pages_read",
    "percent_complete",
    "minutes_listened",
    name="reading_progress_unit",
    create_type=False,
)


def upgrade() -> None:
    reading_progress_unit_enum.create(op.get_bind(), checkfirst=True)

    op.execute(
        """
        ALTER TABLE editions
        ADD COLUMN IF NOT EXISTS total_pages INTEGER;
        """
    )
    op.execute(
        """
        ALTER TABLE editions
        ADD COLUMN IF NOT EXISTS total_audio_minutes INTEGER;
        """
    )
    op.execute(
        "ALTER TABLE editions DROP CONSTRAINT IF EXISTS ck_editions_total_pages_positive;"
    )
    op.execute(
        """
        ALTER TABLE editions
        ADD CONSTRAINT ck_editions_total_pages_positive
        CHECK (total_pages IS NULL OR total_pages >= 1);
        """
    )
    op.execute(
        "ALTER TABLE editions DROP CONSTRAINT IF EXISTS ck_editions_total_audio_minutes_positive;"
    )
    op.execute(
        """
        ALTER TABLE editions
        ADD CONSTRAINT ck_editions_total_audio_minutes_positive
        CHECK (total_audio_minutes IS NULL OR total_audio_minutes >= 1);
        """
    )

    op.execute(
        "ALTER TABLE reading_sessions DROP CONSTRAINT IF EXISTS ck_reading_sessions_pages_read_nonnegative;"
    )
    op.execute(
        "ALTER TABLE reading_sessions DROP CONSTRAINT IF EXISTS ck_reading_sessions_progress_percent_range;"
    )
    op.execute(
        """
        ALTER TABLE reading_sessions
        DROP COLUMN IF EXISTS pages_read;
        """
    )
    op.execute(
        """
        ALTER TABLE reading_sessions
        DROP COLUMN IF EXISTS progress_percent;
        """
    )
    op.execute(
        """
        ALTER TABLE reading_sessions
        ADD COLUMN IF NOT EXISTS title VARCHAR(255);
        """
    )

    op.execute(
        """
        CREATE TABLE IF NOT EXISTS reading_progress_logs (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            library_item_id UUID NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
            reading_session_id UUID NOT NULL REFERENCES reading_sessions(id) ON DELETE CASCADE,
            logged_at TIMESTAMPTZ NOT NULL,
            unit reading_progress_unit NOT NULL,
            value NUMERIC(10,2) NOT NULL,
            canonical_percent NUMERIC(6,3),
            note TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT ck_reading_progress_logs_value_nonnegative CHECK (value >= 0),
            CONSTRAINT ck_reading_progress_logs_canonical_percent_range
                CHECK (canonical_percent IS NULL OR (canonical_percent >= 0 AND canonical_percent <= 100))
        );
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_user_id
        ON reading_progress_logs (user_id);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_library_item_logged_at
        ON reading_progress_logs (library_item_id, logged_at DESC);
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_session_logged_at
        ON reading_progress_logs (reading_session_id, logged_at DESC);
        """
    )

    op.execute("ALTER TABLE public.reading_progress_logs ENABLE ROW LEVEL SECURITY;")
    op.execute(
        "DROP POLICY IF EXISTS reading_progress_logs_owner ON public.reading_progress_logs;"
    )
    op.execute(
        """
        CREATE POLICY reading_progress_logs_owner
        ON public.reading_progress_logs
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )


def downgrade() -> None:
    op.execute(
        "DROP POLICY IF EXISTS reading_progress_logs_owner ON public.reading_progress_logs;"
    )
    op.drop_index(
        "ix_reading_progress_logs_session_logged_at",
        table_name="reading_progress_logs",
    )
    op.drop_index(
        "ix_reading_progress_logs_library_item_logged_at",
        table_name="reading_progress_logs",
    )
    op.drop_index(
        "ix_reading_progress_logs_user_id", table_name="reading_progress_logs"
    )
    op.drop_table("reading_progress_logs")

    op.drop_column("reading_sessions", "title")
    op.add_column(
        "reading_sessions",
        sa.Column("progress_percent", sa.Numeric(5, 2), nullable=True),
    )
    op.add_column(
        "reading_sessions",
        sa.Column("pages_read", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_reading_sessions_pages_read_nonnegative",
        "reading_sessions",
        "pages_read >= 0",
    )
    op.create_check_constraint(
        "ck_reading_sessions_progress_percent_range",
        "reading_sessions",
        "progress_percent >= 0 AND progress_percent <= 100",
    )

    op.drop_constraint(
        "ck_editions_total_audio_minutes_positive",
        "editions",
        type_="check",
    )
    op.drop_constraint(
        "ck_editions_total_pages_positive",
        "editions",
        type_="check",
    )
    op.drop_column("editions", "total_audio_minutes")
    op.drop_column("editions", "total_pages")

    reading_progress_unit_enum.drop(op.get_bind(), checkfirst=True)
