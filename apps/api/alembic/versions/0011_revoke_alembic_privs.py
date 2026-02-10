"""Revoke client-role privileges on alembic_version.

Revision ID: 0011_revoke_alembic_privs
Revises: 0010_rls_hardening
Create Date: 2026-02-10
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0011_revoke_alembic_privs"
down_revision = "0010_rls_hardening"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Alembic's internal table should not be accessible from client roles.
    op.execute("REVOKE ALL ON TABLE public.alembic_version FROM anon;")
    op.execute("REVOKE ALL ON TABLE public.alembic_version FROM authenticated;")


def downgrade() -> None:
    # We intentionally keep these revoked; re-granting would reintroduce the
    # original security warning condition.
    pass
