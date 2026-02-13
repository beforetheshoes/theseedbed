# The Seedbed

Monorepo for The Seedbed services.

## Structure

- `apps/api` - FastAPI backend
- `apps/web` - Nuxt frontend
- `supabase` - Local Supabase config
- `docs` - Project documentation

## Requirements

- Docker (for local Supabase)
- Supabase CLI
- `uv` (Python tooling)
- `pnpm` (frontend tooling)

## Setup

```bash
make install
make supabase-env
```

## Development

```bash
make dev
```

This starts:
- API on `http://localhost:8000`
- Web on `http://localhost:3000`

All-in-one setup (install deps, generate Supabase env, link web `.env`, start dev servers):

```bash
make dev-up
```

Health check:

```bash
make supabase-health
```

### Local API with Bitwarden Secrets Manager

To avoid storing `GOOGLE_BOOKS_API_KEY` in `.env`, you can fetch it at runtime from Bitwarden:

1. Install SDK in API env:

```bash
cd apps/api
uv add --dev bitwarden-sdk
```

2. Export required vars:

```bash
export BITWARDEN_ACCESS_TOKEN=...
export GOOGLE_BOOKS_API_KEY_SECRET_ID=...
```

Optional for self-hosted Bitwarden:

```bash
export BITWARDEN_API_URL=https://api.bitwarden.com
export BITWARDEN_IDENTITY_URL=https://identity.bitwarden.com
```

3. Start API:

```bash
make dev-api-bitwarden
```

## Environments

Local development uses a local Supabase instance (`supabase start`). Staging and production use hosted Supabase projects with environment variables set in those environments. See `docs/supabase.md` for how local vs hosted are handled and when to use `supabase link`.

## Docs

- `docs/supabase.md` - Supabase environments and local setup
- `docs/cli.md` - CLI usage for Supabase, Vercel, and Render
