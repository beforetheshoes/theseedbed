# Issue #189: Automatic Metadata/Cover Enrichment — Feasibility Assessment

## Context

After large CSV imports (Goodreads/Storygraph), users end up with many library items missing covers and metadata. The only way to fix this today is the manual right-click "Set Cover and Metadata" dialog — one book at a time. This doesn't scale for imports of 200-1000 books.

**Critical constraint**: The app must remain on free tiers for Render, Vercel, and Supabase.

---

## Free Tier Limits (researched)

| Service | Limit | Source |
|---------|-------|--------|
| **Render** | 750 hrs/mo compute. Sleeps after 15 min without inbound traffic. Cold-starts on next request. | [Render Docs](https://render.com/docs/free) |
| **Supabase DB** | 500 MB database storage | [Supabase Pricing](https://supabase.com/pricing) |
| **Supabase Storage** | 1 GB file storage (covers bucket) | [Supabase Pricing](https://supabase.com/pricing) |
| **Supabase Edge Functions** | 500K invocations/month | [Supabase Docs](https://supabase.com/docs/guides/functions/limits) |
| **Supabase Egress** | 2 GB database + 2 GB storage | [Supabase Pricing](https://supabase.com/pricing) |
| **Open Library** | 100 requests per 5 min per IP (cover endpoints). General API: no hard limit but asks for throttling. | [Open Library API](https://openlibrary.org/developers/api) |
| **Google Books** | 1,000 requests/day (free API key) | [Google Books API](https://developers.google.com/books/docs/v1/using) |

---

## Feasibility Analysis: 1000-Book Import

### Key insight: imports already fetch provider data

The existing import services (`goodreads_imports.py`, `storygraph_imports.py`) already call Open Library and Google Books for each imported row. Most works will already have `source_records` cached after import. Auto-enrichment would primarily **reuse cached data**, not make net-new API calls.

### Storage impact estimate

| Resource | Per-item estimate | 1000 books | Against limit |
|----------|------------------|------------|---------------|
| `enrichment_queue` rows | ~500 bytes | ~500 KB | 0.1% of 500 MB |
| `enrichment_audit_log` rows | ~1 KB | ~1 MB | 0.2% of 500 MB |
| 3 new columns on `works` | ~50 bytes | ~50 KB | negligible |
| Cover images (Supabase Storage) | ~100-200 KB each | ~100-200 MB | 10-20% of 1 GB |

**Verdict**: DB storage is not a concern. **Cover storage is the only real pressure point** — but this already happens with manual enrichment, just slower. Could mitigate by storing only thumbnail-size covers or by only caching covers on demand.

### API call budget

For books **without** cached `source_records` (worst case):

| Provider | Calls per book | 1000 books | Against limit | Time to process |
|----------|---------------|------------|---------------|-----------------|
| Open Library | ~2 (search + fetch) | ~2000 | 100 req/5min = ~100 min | ~1.5 hours |
| Google Books | ~2 (search + fetch) | ~2000 | 1000/day = 2 days | 2 days |

**But in practice**: Most books already have source_records from the import itself. Realistic net-new calls would be a fraction of this — maybe 10-30% of items need fresh provider calls.

### Render sleep problem

This is the biggest constraint. Render sleeps the server after 15 min of inactivity. During an active import + enrichment, the server stays awake because the client is polling. But:

- **Import phase**: Server is awake (user is actively waiting). Import already takes minutes for 1000 rows.
- **Post-import enrichment**: If we batch-process enrichment as a continuation of the import BackgroundTask (same process), it stays alive as long as the user's browser tab is open and polling for import status.
- **Risk**: If the user closes the tab before enrichment finishes, the server eventually sleeps, killing in-flight BackgroundTasks.
- **Mitigation**: The `enrichment_queue` table is persistent. When the server wakes up next (on any request), it can resume processing pending items. Items stuck in `in_progress` for > 5 min get reset to `pending` (same stale-job pattern imports use).

**Verdict**: Enrichment may not finish in one session for very large imports, but it will **resume incrementally** on subsequent visits. No data loss. For a 200-book import, enrichment would likely finish within the import session itself (~10-20 min of cached lookups).

### Supabase Edge Functions

Not needed. The `BackgroundTasks` approach avoids Edge Functions entirely. This limit is irrelevant.

### Egress

Cover images served from Supabase Storage count against 2 GB storage egress. 1000 covers × 150 KB = ~150 MB per full library load. With lazy loading and browser caching, realistic monthly egress would be much lower. **Not a near-term concern** but worth monitoring.

---

## Feasibility Verdict

| Concern | Risk Level | Notes |
|---------|------------|-------|
| Render compute time | **Low** | 750 hrs/mo is ample. Enrichment runs during active sessions. |
| Render sleep/restart | **Medium** | Persistent queue + stale recovery handles this. Enrichment resumes on next visit. |
| Supabase DB storage | **Low** | New tables add < 2 MB per 1000 books. |
| Supabase file storage | **Medium** | Cover images are the main cost (~100-200 MB per 1000 books). Already happens with manual enrichment. |
| Open Library API | **Low** | Most data cached from import. Rate limiter keeps us well under 100 req/5min. |
| Google Books API | **Low-Medium** | 1000 req/day limit could be tight for very large imports without cache hits. Google is secondary provider — can skip if budget exhausted. |
| Supabase Edge Functions | **None** | Not used. |
| Egress | **Low** | Cover images cached by browsers. Would need monitoring at scale. |

**Overall: This is feasible on free tiers.** The main architectural trick is that imports already do the expensive provider calls. Auto-enrichment mostly reuses cached data and applies it. The persistent queue handles Render's sleep behavior gracefully.

---

## Recommended Architecture

**Approach**: Post-import background enrichment using the existing `BackgroundTasks` pattern. No new infrastructure needed.

### How it works

1. During import, after each book is successfully imported, enqueue it in `enrichment_queue` (a simple DB insert — negligible cost)
2. After the import job completes, kick off `process_enrichment_batch()` as a BackgroundTask
3. The batch processor works through pending items, rate-limited, reusing cached `source_records` when available
4. If the server sleeps before finishing, remaining items stay `pending` and resume on next activity
5. Users can also manually trigger enrichment via a "Enrich Missing" button

### Key design decisions

- **Work-scoped, not user-scoped** — enrichment targets `works`/`editions` (shared data). If User A's import enriches a book, User B benefits too.
- **Only fill empty fields, never overwrite** — auto-enrichment writes to NULL fields only. Existing data is always preserved.
- **Covers first** — covers are the highest-value, lowest-risk target. Medium confidence is enough for covers; high confidence required for metadata text fields.
- **Cache-first** — always check `source_records` before making provider calls. Most post-import enrichment uses zero external API calls.

### Confidence tiers (reusing existing scoring from `work_metadata_enrichment.py:355-504`)

| Tier | Criteria | Action |
|------|----------|--------|
| **High** | ISBN match >= 4 AND title match >= 3 | Auto-apply covers + empty metadata fields |
| **Medium** | Title >= 3 AND author >= 2 (no ISBN) | Auto-apply covers only; queue metadata for review |
| **Low** | Title >= 2 but author < 2 | Mark `needs_review` |
| **None** | Title < 2 | Mark `skipped` |

---

## Database Changes

### New table: `enrichment_queue`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `work_id` | uuid FK → works | What to enrich |
| `edition_id` | uuid FK → editions | Target edition (nullable) |
| `triggered_by` | uuid FK → users | Who triggered (null for system) |
| `trigger_source` | enum | `post_import`, `manual_bulk` |
| `status` | enum | `pending` → `in_progress` → `completed` / `needs_review` / `failed` / `skipped` |
| `confidence` | enum | `high`, `medium`, `low`, `none` |
| `priority` | smallint | Lower = higher priority (manual=50, import=100) |
| `providers_attempted` | text[] | Which providers were called |
| `fields_applied` | text[] | Which fields were auto-applied |
| `cover_applied` | boolean | Whether a cover was applied |
| `match_details` | jsonb | Scoring details for audit |
| `attempt_count` / `max_attempts` | smallint | Retry tracking (max 3) |
| `next_attempt_after` | timestamptz | Exponential backoff |
| `last_error` | text | Last failure message |
| Timestamps | timestamptz | `created_at`, `started_at`, `finished_at`, `updated_at` |

**Indexes**: Partial unique on `(work_id) WHERE status IN ('pending','in_progress')`. Priority+created_at for worker polling.

### New table: `enrichment_audit_log`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | uuid PK | |
| `enrichment_queue_id` | uuid FK | Link to queue item |
| `work_id` | uuid | |
| `action` | varchar | `auto_applied`, `queued_review`, `skipped`, `failed` |
| `provider` / `confidence` | varchar / enum | Match details |
| `fields_changed` | jsonb | `{"work.description": {"old": null, "new": "..."}}` |
| `previous_values` | jsonb | Snapshot before changes |

### New columns on `works`
- `enrichment_status` varchar(32)
- `enrichment_confidence` varchar(16)
- `last_enriched_at` timestamptz

### Feature flags (env vars in `Settings`)
- `ENRICHMENT_AUTO_ENABLED` (bool, default false) — master switch
- `ENRICHMENT_AUTO_APPLY_COVERS` (bool, default true)
- `ENRICHMENT_AUTO_APPLY_METADATA` (bool, default false) — conservative start
- `ENRICHMENT_BATCH_SIZE` (int, default 10)
- `ENRICHMENT_PROVIDER_DELAY_MS` (int, default 500)

---

## Provider Budget Strategy

- **Cache-first**: Check `source_records` table (already populated during import). Skip if `fetched_at` < 7 days.
- **"No match" caching**: Record misses with `{"no_match": true}` so we don't retry the same book for 14 days.
- **Rate limiter**: Token-bucket per provider — Open Library: 0.33 req/sec (burst 10), Google Books: 0.01 req/sec (burst 5).
- **Circuit breaker**: After 5 consecutive failures to a provider, stop calling it for 60 seconds.
- **Google Books budget-aware**: Track daily call count. If approaching 1000/day, skip Google Books for remaining items (Open Library is the primary provider anyway).

---

## Files to Create

| File | Purpose |
|------|---------|
| `apps/api/app/db/models/enrichment.py` | SQLAlchemy models |
| `apps/api/app/services/auto_enrichment.py` | Core orchestrator |
| `apps/api/app/services/provider_rate_limiter.py` | Token-bucket rate limiter |
| `apps/api/app/services/provider_circuit_breaker.py` | Circuit breaker |
| `apps/api/app/routers/enrichment.py` | REST endpoints |
| `supabase/migrations/20260220120000_add_enrichment_queue.sql` | SQL migration |
| `apps/api/alembic/versions/0023_enrichment_queue.py` | Alembic migration |
| `apps/web/src/components/library/workflows/EnrichmentReviewPanel.tsx` | Review UI |

## Files to Modify

| File | Change |
|------|--------|
| `apps/api/app/core/config.py` | Add enrichment feature flags |
| `apps/api/app/db/models/__init__.py` | Export new models |
| `apps/api/app/db/models/bibliography.py` | Add enrichment columns to `Work` |
| `apps/api/app/main.py` | Register enrichment router |
| `apps/api/app/services/goodreads_imports.py` | Enqueue after row success (~line 540), trigger batch after job completes (~line 572) |
| `apps/api/app/services/storygraph_imports.py` | Same hooks |
| `apps/api/app/routers/works.py` | Include enrichment fields in work detail response |
| `apps/web/src/app/(app)/library/library-page-client.tsx` | Enrichment status badges, bulk controls |

## Existing code to reuse

| Function | File | Purpose |
|----------|------|---------|
| `_title_match_score()` | `work_metadata_enrichment.py:355` | Title comparison scoring |
| `_author_match_score()` | `work_metadata_enrichment.py:377` | Author comparison scoring |
| `_isbn_match_score()` | `work_metadata_enrichment.py:425` | ISBN comparison scoring |
| `_best_google_bundle()` | `work_metadata_enrichment.py:484` | Rank Google results |
| `FIELD_DEFINITIONS` | `work_metadata_enrichment.py:29` | Enrichable fields list |
| Stale job recovery pattern | `goodreads_imports.py` | 3-min timeout → mark failed |

---

## API Endpoints (`/api/v1/enrichment/`)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/status?work_ids=...` | Batch enrichment status for library list |
| `GET` | `/queue?status=&limit=&cursor=` | List user's enrichment queue |
| `POST` | `/trigger` | Enqueue specific work_ids |
| `POST` | `/trigger-all` | Enqueue all user's works missing covers/metadata |
| `POST` | `/{queue_id}/approve` | Apply from `needs_review` item |
| `POST` | `/{queue_id}/dismiss` | Dismiss → `skipped` |

---

## Rollout Milestones

### M1: Foundation (feature-flagged OFF)
DB schema, models, feature flags, `enqueue_enrichment()`, basic status endpoint.

### M2: Worker Core
Rate limiter, circuit breaker, `process_single_enrichment()`, confidence scoring, auto-apply. Unit tests.

### M3: Import Integration
Wire into import services. Trigger batch after import completes.

### M4: API + Manual Triggers
`/trigger`, `/trigger-all`, `/approve`, `/dismiss` endpoints.

### M5: Frontend UI
Status badges, review panel, bulk controls, post-import messaging.

### M6: Monitoring
Structured logging, success/failure tracking. Watch storage usage trends.

---

## Verification

1. **Unit tests**: Confidence scoring, rate limiter, circuit breaker, enqueue dedup
2. **Integration tests**: Import CSV → enrichment enqueued → batch processed → works updated
3. **Manual test**: Import 20-book Goodreads CSV with missing covers. Verify covers appear within minutes.
4. **Free-tier monitoring**: After first real use, check Supabase storage dashboard and Render usage.
