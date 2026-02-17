#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <base_sha> <head_sha>" >&2
  exit 2
fi

base_sha="$1"
head_sha="$2"

changed_files="$(git diff --name-only "$base_sha" "$head_sha")"

if [[ -z "$changed_files" ]]; then
  echo "No changed files between $base_sha and $head_sha."
  exit 0
fi

if echo "$changed_files" | rg -q '^apps/api/alembic/versions/.*\.py$'; then
  if ! echo "$changed_files" | rg -q '^supabase/migrations/.*\.sql$'; then
    echo "::error::Alembic migration changes detected without matching Supabase SQL migration changes."
    echo "Changed Alembic files:"
    echo "$changed_files" | rg '^apps/api/alembic/versions/.*\.py$' || true
    echo
    echo "Add a corresponding SQL file under supabase/migrations/ in the same PR."
    exit 1
  fi
fi

echo "Migration sync check passed."
