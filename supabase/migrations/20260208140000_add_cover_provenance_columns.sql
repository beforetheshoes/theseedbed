-- Cover provenance fields for manual uploads and caching workflows.
-- These are nullable and backwards-compatible.

ALTER TABLE public.editions
  ADD COLUMN IF NOT EXISTS cover_set_by UUID,
  ADD COLUMN IF NOT EXISTS cover_set_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS cover_storage_path TEXT;

ALTER TABLE public.works
  ADD COLUMN IF NOT EXISTS default_cover_set_by UUID,
  ADD COLUMN IF NOT EXISTS default_cover_set_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS default_cover_storage_path TEXT;

