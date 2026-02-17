from __future__ import annotations

import os
from collections.abc import Iterator
from contextlib import contextmanager

import sqlalchemy as sa
from sqlalchemy.orm import Session

from app.db.session import get_db_session


class SchemaGuardError(RuntimeError):
    pass


_STAGING_ENV_LABELS = {"staging", "stage"}
_PROD_ENV_LABELS = {"prod", "production"}

_REQUIRED_ENUM_LABELS: tuple[tuple[str, str], ...] = (
    ("content_visibility", "unlisted"),
)
_REQUIRED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("notes", "ap_uri"),
    ("highlights", "ap_uri"),
    ("reviews", "ap_uri"),
    ("users", "actor_uri"),
    # User settings fields used directly by GET/PATCH /api/v1/me.
    ("users", "enable_google_books"),
    ("users", "theme_primary_color"),
    ("users", "theme_accent_color"),
    ("users", "theme_font_family"),
    ("users", "theme_heading_font_family"),
    ("users", "default_progress_unit"),
    # Cover provenance columns: if these aren't present, basic work fetches can 500.
    ("editions", "cover_set_by"),
    ("editions", "cover_set_at"),
    ("editions", "cover_storage_path"),
    ("works", "default_cover_set_by"),
    ("works", "default_cover_set_at"),
    ("works", "default_cover_storage_path"),
    # Per-user cover overrides: if these aren't present, library list queries can 500.
    ("library_items", "cover_override_url"),
    ("library_items", "cover_override_storage_path"),
    ("library_items", "cover_override_set_by"),
    ("library_items", "cover_override_set_at"),
)


def _normalize_env(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def should_run_schema_guard() -> bool:
    env_label = _normalize_env(os.getenv("SUPABASE_ENV"))
    if env_label is not None:
        return env_label in _STAGING_ENV_LABELS | _PROD_ENV_LABELS

    # Fallback: if SUPABASE_ENV isn't set (common in Render), still protect hosted
    # deployments from schema drift. We skip only when it looks like a local
    # Supabase instance.
    supabase_url = _normalize_env(os.getenv("SUPABASE_URL"))
    if supabase_url is None:
        return False

    local_markers = ("localhost", "127.0.0.1", "0.0.0.0")
    return not any(marker in supabase_url for marker in local_markers)


@contextmanager
def _open_db_session() -> Iterator[Session]:
    # `get_db_session` is a generator dependency; we need to exhaust it to
    # ensure the `finally: session.close()` runs deterministically.
    gen = get_db_session()
    session = next(gen)
    try:
        yield session
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def _has_enum_label(session: Session, enum_name: str, enum_label: str) -> bool:
    result = session.execute(
        sa.text(
            """
            select 1
            from pg_type t
            join pg_enum e on t.oid = e.enumtypid
            where t.typname = :enum_name
              and e.enumlabel = :enum_label
            limit 1
            """
        ),
        {"enum_name": enum_name, "enum_label": enum_label},
    ).first()
    return result is not None


def _has_column(session: Session, table: str, column: str) -> bool:
    result = session.execute(
        sa.text(
            """
            select 1
            from information_schema.columns
            where table_schema = 'public'
              and table_name = :table_name
              and column_name = :column_name
            limit 1
            """
        ),
        {"table_name": table, "column_name": column},
    ).first()
    return result is not None


def find_missing_schema_requirements(session: Session) -> list[str]:
    missing: list[str] = []
    for enum_name, enum_label in _REQUIRED_ENUM_LABELS:
        if not _has_enum_label(session, enum_name=enum_name, enum_label=enum_label):
            missing.append(f"enum {enum_name} missing label {enum_label!r}")

    for table, column in _REQUIRED_COLUMNS:
        if not _has_column(session, table=table, column=column):
            missing.append(f"missing column public.{table}.{column}")

    return missing


def run_schema_guard() -> None:
    if not should_run_schema_guard():
        return

    with _open_db_session() as session:
        missing = find_missing_schema_requirements(session)

    if not missing:
        return

    joined = "\n- ".join(["", *missing])
    raise SchemaGuardError(
        "Database schema appears behind the API. Apply Supabase migrations before deploying.\n"
        f"Missing requirements:{joined}\n"
        "Action: run `supabase db push` against staging/prod, then redeploy the API."
    )
