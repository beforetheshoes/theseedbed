# The Seedbed Web Next (Migration)

This is the React/Next.js migration app that runs side-by-side with the existing Nuxt app.

## Stack

- Next.js 16.1.6 (App Router)
- React 19.2.4
- Tailwind CSS 4.1.18
- Supabase JS + `@supabase/ssr`
- Vitest + Testing Library
- Playwright

## Run

```bash
pnpm install
pnpm dev
```

The app runs on `http://localhost:3001` by default so Nuxt can continue running on `http://localhost:3000`.

## Environment

Set the following in `apps/web-next/.env.local` (or shell env):

```bash
NEXT_PUBLIC_API_BASE_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`NEXT_PUBLIC_API_BASE_URL` falls back to `http://localhost:8000` when unset.

## Quality

```bash
pnpm quality
```

Quality enforces:

- formatting check
- eslint (`--max-warnings 0`)
- strict typecheck
- unit tests with per-file coverage thresholds of 95%
- production build

## Current migration status

Implemented:

- route and layout parity across all migrated routes
- auth entry routes (`/login`, `/auth/callback`, `/oauth/consent`)
- public canonical routes (`/u/:handle`, `/book/:workId`, `/review/:reviewId`)
- middleware behavior for protected paths and ActivityPub placeholder responses
- `/.well-known/webfinger` placeholder handler
- shared API client/error semantics port
- color mode cookie/system handling + `window.__setColorMode` E2E hook
- native feature flows for `/books/search`, `/library`, `/books/[workId]`, and `/settings`

Status:

- all routes are served natively by Next/React (no Nuxt middleware proxy/rewrite).
