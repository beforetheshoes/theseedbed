# Canonical Public URL Patterns

This document defines stable, public-facing URLs for resources that may be shared publicly and later federated via ActivityPub.

## Goals
- Stable URLs that can be referenced externally.
- Clear separation between HTML pages and future ActivityPub (JSON-LD) representations.
- Avoid coupling public URLs to internal UI routes (which may change).

## URL Patterns

### User profiles
- HTML: `/u/{handle}`
- ActivityPub (reserved): same path with `Accept: application/activity+json` (currently returns `406 Not Acceptable`)

Notes:
- `{handle}` maps to `public.users.handle` and is unique (DB constraint `uq_users_handle`).

### Book pages
- HTML: `/book/{work_id}`

Notes:
- `{work_id}` is the UUID primary key for `public.works.id`.

### Public reviews
- HTML: `/review/{review_id}`

Notes:
- `{review_id}` is the UUID primary key for `public.reviews.id`.

## Well-known endpoints (reserved)

### WebFinger
- `GET /.well-known/webfinger` (reserved for federation discovery)
- Current behavior: returns `501 Not Implemented`

## Current Implementation Status
- The Nuxt app defines placeholder HTML pages for `/u/{handle}`, `/book/{work_id}`, and `/review/{review_id}`.
- No federation logic is implemented.
- Requests to `/u/{handle}` that explicitly ask for ActivityPub JSON via `Accept: application/activity+json` return `406 Not Acceptable` to make the lack of federation support explicit.

