-- Add nullable ActivityPub URI columns for federation readiness.
-- These are intentionally optional for v1 and should not affect existing behavior.

ALTER TABLE users ADD COLUMN IF NOT EXISTS actor_uri TEXT;

ALTER TABLE reviews ADD COLUMN IF NOT EXISTS ap_uri TEXT;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS ap_uri TEXT;
ALTER TABLE highlights ADD COLUMN IF NOT EXISTS ap_uri TEXT;

