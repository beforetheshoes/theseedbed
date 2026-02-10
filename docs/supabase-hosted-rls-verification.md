# Hosted Supabase RLS Verification (Staging + Production)

This is the runbook for verifying Row Level Security (RLS) in the hosted Supabase
projects after applying migrations. It is intentionally SQL-first and does not
require sharing secrets.

## Apply migrations (staging first)

From the repo root:

```bash
supabase link --project-ref kypwcksvicrbrrwscdze
supabase db push
```

Repeat for production only after staging validation passes:

```bash
supabase link --project-ref aaohmjvcsgyqqlxomegu
supabase db push
```

## Verify via Supabase Dashboard SQL editor

Run:

```sql
-- RLS enabled flags
select relname, relrowsecurity
from pg_class
join pg_namespace on pg_namespace.oid = pg_class.relnamespace
where nspname = 'public'
  and relname in (
    'users',
    'library_items',
    'reading_sessions',
    'reading_state_events',
    'notes',
    'highlights',
    'reviews',
    'api_clients',
    'api_audit_logs',
    'authors',
    'works',
    'editions',
    'work_authors',
    'external_ids',
    'source_records'
  )
order by relname;
```

Then:

```sql
-- Policies present and scoped correctly
select schemaname,
       tablename,
       policyname,
       cmd,
       roles,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'users',
    'library_items',
    'reading_sessions',
    'reading_state_events',
    'notes',
    'highlights',
    'reviews',
    'api_clients',
    'api_audit_logs',
    'authors',
    'works',
    'editions',
    'work_authors',
    'external_ids',
    'source_records'
  )
order by tablename, policyname;
```

Expected notes:
- User-owned tables have `*_owner` policies with `USING (<owner_column> = auth.uid())`.
- `api_audit_logs_read` is `SELECT` only and scoped via `api_clients.owner_user_id = auth.uid()`.
- Read-only catalog tables have `*_read` policies with `USING (true)` and no write policies.
- `reviews_public_read` exists and allows authenticated users to read other users' reviews only when
  `visibility = 'public'`.
- `visibility = 'unlisted'` is treated as private in RLS.

## Smoke checks (staging)

1. Confirm authenticated user flows work (library, notes, highlights, sessions, reviews CRUD).
2. Confirm any public review listing endpoint still works as expected.
3. Confirm private/unlisted user content is not readable cross-user via the Supabase Data API.

