ALTER TABLE public.reviews
  DROP CONSTRAINT IF EXISTS uq_reviews_user_library_item;

CREATE TABLE IF NOT EXISTS public.library_item_merge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_library_item_id uuid REFERENCES public.library_items(id) ON DELETE SET NULL,
  source_library_item_ids uuid[] NOT NULL,
  field_resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_library_item_merge_events_source_nonempty
    CHECK (cardinality(source_library_item_ids) >= 1)
);

CREATE INDEX IF NOT EXISTS ix_library_item_merge_events_user_id
  ON public.library_item_merge_events (user_id);
CREATE INDEX IF NOT EXISTS ix_library_item_merge_events_created_at
  ON public.library_item_merge_events (created_at);
CREATE INDEX IF NOT EXISTS ix_library_item_merge_events_target_library_item_id
  ON public.library_item_merge_events (target_library_item_id);

ALTER TABLE public.library_item_merge_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_item_merge_events_owner ON public.library_item_merge_events;
CREATE POLICY library_item_merge_events_owner
ON public.library_item_merge_events
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
