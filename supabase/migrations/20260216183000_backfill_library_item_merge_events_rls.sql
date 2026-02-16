ALTER TABLE public.library_item_merge_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS library_item_merge_events_owner ON public.library_item_merge_events;

CREATE POLICY library_item_merge_events_owner
ON public.library_item_merge_events
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
