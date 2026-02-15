"""Add indexes for library pagination and sorting.

Revision ID: 0014_library_pagination_indexes
Revises: 0013_storygraph_import_jobs
Create Date: 2026-02-15
"""

from __future__ import annotations

from sqlalchemy import inspect

from alembic import op

revision = "0014_library_pagination_indexes"
down_revision = "0013_storygraph_import_jobs"
branch_labels = None
depends_on = None


def _has_index(table_name: str, index_name: str) -> bool:
    inspector = inspect(op.get_bind())
    return any(
        index.get("name") == index_name
        for index in inspector.get_indexes(table_name, schema="public")
    )


def upgrade() -> None:
    if not _has_index("library_items", "ix_library_items_user_created_at_id"):
        op.create_index(
            "ix_library_items_user_created_at_id",
            "library_items",
            ["user_id", "created_at", "id"],
            schema="public",
        )
    if not _has_index("library_items", "ix_library_items_user_rating_id"):
        op.create_index(
            "ix_library_items_user_rating_id",
            "library_items",
            ["user_id", "rating", "id"],
            schema="public",
        )
    if not _has_index("library_items", "ix_library_items_user_status_created_at"):
        op.create_index(
            "ix_library_items_user_status_created_at",
            "library_items",
            ["user_id", "status", "created_at"],
            schema="public",
        )
    if not _has_index("library_items", "ix_library_items_user_visibility_created_at"):
        op.create_index(
            "ix_library_items_user_visibility_created_at",
            "library_items",
            ["user_id", "visibility", "created_at"],
            schema="public",
        )


def downgrade() -> None:
    op.drop_index(
        "ix_library_items_user_visibility_created_at",
        table_name="library_items",
        schema="public",
    )
    op.drop_index(
        "ix_library_items_user_status_created_at",
        table_name="library_items",
        schema="public",
    )
    op.drop_index(
        "ix_library_items_user_rating_id",
        table_name="library_items",
        schema="public",
    )
    op.drop_index(
        "ix_library_items_user_created_at_id",
        table_name="library_items",
        schema="public",
    )
