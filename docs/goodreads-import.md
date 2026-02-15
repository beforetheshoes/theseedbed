# Goodreads import

Chapterverse supports importing a user-owned Goodreads CSV export through `POST /api/v1/imports/goodreads`.

## Supported columns

The importer currently requires these columns from the Goodreads CSV header:

- `Book Id`
- `Title`
- `Author`
- `Additional Authors`
- `ISBN`
- `ISBN13`
- `My Rating`
- `Date Read`
- `Date Added`
- `Bookshelves`
- `Exclusive Shelf`
- `My Review`
- `Read Count`

## Mapping rules

### Status mapping

- `read` -> `completed`
- `to-read` -> `to_read`
- `currently-reading` -> `reading`
- `paused` -> `reading`
- `did-not-finish` / `dnf` / `abandoned` -> `abandoned`

If `Exclusive Shelf` is missing/unknown, import falls back to `Bookshelves` tokens.

### Ratings

- Goodreads `My Rating` maps to `library_items.rating` (0-10) as `my_rating * 2` for `1..5`.
- `My Rating = 0` is treated as unrated.
- Imported review rating uses 1-5 (`My Rating`) when present.

### Tags

- Tags come from `Bookshelves` only.
- Reading-state shelves (`read`, `to-read`, `currently-reading`, `paused`, `did-not-finish`, `dnf`, `abandoned`) are excluded.
- Remaining shelves are trimmed and deduplicated case-insensitively.

### Reviews

- Non-empty `My Review` creates or updates a work review for the user.
- Imported review visibility defaults to `private`.

### Reading sessions

One reading session can be created per row when at least one date is available:

1. `Date Read` if present
2. `Date Added`

The session note stores a deterministic marker (`goodreads:{book_id_or_hash}`) to prevent duplicates on re-import.

## Work resolution strategy

1. If normalized ISBN looks like ISBN10/ISBN13, try existing local editions first.
2. If not found locally, query Open Library by ISBN and import that work.
3. If unresolved (or non-ISBN), create/get a manual work keyed by deterministic identity.

## Async job flow

- `POST /api/v1/imports/goodreads` creates a queued job.
- Background processing moves status through `queued -> running -> completed|failed`.
- Use `GET /api/v1/imports/goodreads/{job_id}` for progress and preview rows.
- Use `GET /api/v1/imports/goodreads/{job_id}/rows` for paginated row-level details.

## Idempotency

- Re-import is duplicate-safe per user.
- Existing library items are upserted (`status`, `rating`, `tags`) instead of duplicated.
- Review upserts key off user + work.
- Reading session dedupe uses deterministic marker.
- Row records are deduplicated per job using row identity hash.

## Troubleshooting

- `400 file must be a .csv export`: upload a CSV file.
- `400 file is empty`: exported file has no content.
- `failed` job with `error_summary`: malformed header/data or provider lookup failures; inspect preview rows and `/rows` endpoint for details.
