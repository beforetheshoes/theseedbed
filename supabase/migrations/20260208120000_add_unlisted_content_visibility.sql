-- Add 'unlisted' to content_visibility enum for notes/highlights/reviews.
-- This is intentionally additive and backwards-compatible.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'content_visibility'
      AND e.enumlabel = 'unlisted'
  ) THEN
    ALTER TYPE content_visibility ADD VALUE 'unlisted';
  END IF;
END $$;

