#!/bin/sh

set -eu

MODE="${1:-run}"
shift || true

if [ "$MODE" != "run" ] && [ "$MODE" != "open" ]; then
  echo "Unsupported Cypress mode: $MODE (expected run|open)" >&2
  exit 2
fi

# pnpm forwards script args as: <script> -- <args>. Drop the sentinel if present.
if [ "${1:-}" = "--" ]; then
  shift
fi

PORT="$(node -e "const net=require('node:net'); const server=net.createServer(); server.listen(0,()=>{console.log(server.address().port); server.close();});")"
BASE_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ]; then
    kill "${SERVER_PID}" 2>/dev/null || true
    wait "${SERVER_PID}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

NUXT_PUBLIC_SUPABASE_URL="${NUXT_PUBLIC_SUPABASE_URL:-http://localhost:54321}" \
NUXT_PUBLIC_SUPABASE_ANON_KEY="${NUXT_PUBLIC_SUPABASE_ANON_KEY:-test-anon-key}" \
pnpm preview --port "${PORT}" >/tmp/chapterverse-preview-${PORT}.log 2>&1 &
SERVER_PID="$!"

ATTEMPTS=0
until curl -sf "${BASE_URL}/login" >/dev/null; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -gt 120 ]; then
    echo "Preview server did not become ready at ${BASE_URL}" >&2
    exit 1
  fi
  sleep 0.5
done

WARMUP_BASE_URL="${BASE_URL}" node scripts/warmup-e2e.mjs
pnpm exec cypress "${MODE}" --config "baseUrl=${BASE_URL}" "$@"
