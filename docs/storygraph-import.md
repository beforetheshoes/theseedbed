# StoryGraph import

Chapterverse supports importing a user-owned StoryGraph CSV export through `POST /api/v1/imports/storygraph`.

## Supported columns

The importer currently requires these columns from the StoryGraph CSV header:

- `Title`
- `Authors`
- `ISBN/UID`
- `Read Status`
- `Date Added`
- `Last Date Read`
- `Dates Read`
- `Read Count`
- `Star Rating`
- `Review`
- `Tags`

## Mapping rules

### Status mapping

- `read` -> `completed`
- `to-read` -> `to_read`
- `currently-reading` -> `reading`
- `paused` -> `reading`
- `did-not-finish` -> `abandoned`

### Ratings

- StoryGraph `Star Rating` is mapped to `library_items.rating` (0-10) using `round(stars * 2)`.
- If a review is imported, review rating is stored on a 1-5 scale via `round(stars)`.

### Tags

- StoryGraph tags are split by comma, trimmed, de-duplicated (case-insensitive), and written to `library_items.tags`.

### Reviews

- Non-empty StoryGraph `Review` creates or updates a work review for the user.
- Imported review visibility defaults to `private`.

### Reading sessions

One reading session can be created per row when at least one date is available:

1. `Dates Read` range (`YYYY/MM/DD-YYYY/MM/DD`) if present
2. `Last Date Read`
3. `Date Added`

The session note stores a deterministic marker (`storygraph:{row_hash}`) to prevent duplicates on re-import.

## Work resolution strategy

1. If `ISBN/UID` looks like ISBN10/ISBN13, try existing local editions first.
2. If not found locally, query Open Library by ISBN and import that work.
3. If unresolved (or non-ISBN UID), create/get a manual work keyed by deterministic identity hash (`title|authors|uid`).

## Async job flow

- `POST /api/v1/imports/storygraph` creates a queued job.
- Background processing moves status through `queued -> running -> completed|failed`.
- Use `GET /api/v1/imports/storygraph/{job_id}` for progress and preview rows.
- Use `GET /api/v1/imports/storygraph/{job_id}/rows` for paginated row-level details.

## Idempotency

- Re-import is duplicate-safe per user.
- Existing library items are upserted (`status`, `rating`, `tags`) instead of duplicated.
- Review upserts key off user + library item.
- Reading session dedupe uses deterministic marker.
- Row records are de-duplicated per job using row identity hash.

## Troubleshooting

- `400 file must be a .csv export`: upload a CSV file.
- `400 file is empty`: exported file has no content.
- `failed` job with `error_summary`: malformed header/data or provider lookup failures; inspect preview rows and `/rows` endpoint for details.
