"""Harden and re-apply RLS policies (idempotent).

Revision ID: 0010_rls_hardening
Revises: 0009_cover_overrides
Create Date: 2026-02-10 00:00:00

This mirrors the Supabase SQL migration that re-enables RLS and recreates
policies to prevent environment drift.
"""

from __future__ import annotations

from alembic import op

revision = "0010_rls_hardening"
down_revision = "0009_cover_overrides"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # User-owned tables (private by default)
    op.execute("ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS users_owner ON public.users;")
    op.execute(
        """
        CREATE POLICY users_owner
        ON public.users
        FOR ALL
        TO authenticated
        USING (id = auth.uid())
        WITH CHECK (id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS library_items_owner ON public.library_items;")
    op.execute(
        """
        CREATE POLICY library_items_owner
        ON public.library_items
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;")
    op.execute(
        "DROP POLICY IF EXISTS reading_sessions_owner ON public.reading_sessions;"
    )
    op.execute(
        """
        CREATE POLICY reading_sessions_owner
        ON public.reading_sessions
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.reading_state_events ENABLE ROW LEVEL SECURITY;")
    op.execute(
        "DROP POLICY IF EXISTS reading_state_events_owner ON public.reading_state_events;"
    )
    op.execute(
        """
        CREATE POLICY reading_state_events_owner
        ON public.reading_state_events
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS notes_owner ON public.notes;")
    op.execute(
        """
        CREATE POLICY notes_owner
        ON public.notes
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS highlights_owner ON public.highlights;")
    op.execute(
        """
        CREATE POLICY highlights_owner
        ON public.highlights
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    op.execute("ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS reviews_owner ON public.reviews;")
    op.execute(
        """
        CREATE POLICY reviews_owner
        ON public.reviews
        FOR ALL
        TO authenticated
        USING (user_id = auth.uid())
        WITH CHECK (user_id = auth.uid());
        """
    )

    # Shared read (authenticated only) for public reviews; 'unlisted' stays private.
    op.execute("DROP POLICY IF EXISTS reviews_public_read ON public.reviews;")
    op.execute(
        """
        CREATE POLICY reviews_public_read
        ON public.reviews
        FOR SELECT
        TO authenticated
        USING (visibility = 'public'::content_visibility);
        """
    )

    op.execute("ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS api_clients_owner ON public.api_clients;")
    op.execute(
        """
        CREATE POLICY api_clients_owner
        ON public.api_clients
        FOR ALL
        TO authenticated
        USING (owner_user_id = auth.uid())
        WITH CHECK (owner_user_id = auth.uid());
        """
    )

    # Audit logs: scoped read
    op.execute("ALTER TABLE public.api_audit_logs ENABLE ROW LEVEL SECURITY;")
    op.execute("DROP POLICY IF EXISTS api_audit_logs_read ON public.api_audit_logs;")
    op.execute(
        """
        CREATE POLICY api_audit_logs_read
        ON public.api_audit_logs
        FOR SELECT
        TO authenticated
        USING (
            EXISTS (
                SELECT 1
                FROM public.api_clients
                WHERE api_clients.client_id = api_audit_logs.client_id
                  AND api_clients.owner_user_id = auth.uid()
            )
        );
        """
    )

    # Catalog/read-only tables (authenticated reads only; no writes)
    for table in (
        "authors",
        "works",
        "editions",
        "work_authors",
        "external_ids",
        "source_records",
    ):
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")
        op.execute(f"DROP POLICY IF EXISTS {table}_read ON public.{table};")
        op.execute(
            f"""
            CREATE POLICY {table}_read
            ON public.{table}
            FOR SELECT
            TO authenticated
            USING (true);
            """
        )


def downgrade() -> None:
    # Minimal rollback: remove the newly introduced shared-read policy.
    op.execute("DROP POLICY IF EXISTS reviews_public_read ON public.reviews;")
