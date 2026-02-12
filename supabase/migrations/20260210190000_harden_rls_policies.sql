-- Harden and make RLS policies drift-resistant (idempotent).
--
-- Goals:
-- - Ensure RLS is enabled consistently across environments.
-- - Ensure policies are explicit and can be re-applied safely.
-- - visibility='unlisted' is treated as private at the DB layer.
-- - Only reviews with visibility='public' are readable cross-user, and only for role=authenticated.

-- User-owned tables (private by default)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_owner ON public.users;
CREATE POLICY users_owner
  ON public.users
  FOR ALL
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

ALTER TABLE public.library_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_items_owner ON public.library_items;
CREATE POLICY library_items_owner
  ON public.library_items
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reading_sessions_owner ON public.reading_sessions;
CREATE POLICY reading_sessions_owner
  ON public.reading_sessions
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.reading_state_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reading_state_events_owner ON public.reading_state_events;
CREATE POLICY reading_state_events_owner
  ON public.reading_state_events
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS notes_owner ON public.notes;
CREATE POLICY notes_owner
  ON public.notes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.highlights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS highlights_owner ON public.highlights;
CREATE POLICY highlights_owner
  ON public.highlights
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reviews_owner ON public.reviews;
CREATE POLICY reviews_owner
  ON public.reviews
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Explicit shared read (authenticated only) for public reviews.
-- 'unlisted' is intentionally NOT shared.
DROP POLICY IF EXISTS reviews_public_read ON public.reviews;
CREATE POLICY reviews_public_read
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (visibility = 'public'::content_visibility);

ALTER TABLE public.api_clients ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_clients_owner ON public.api_clients;
CREATE POLICY api_clients_owner
  ON public.api_clients
  FOR ALL
  TO authenticated
  USING (owner_user_id = auth.uid())
  WITH CHECK (owner_user_id = auth.uid());

-- Audit logs: readable only by the owning user of the associated API client.
ALTER TABLE public.api_audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_audit_logs_read ON public.api_audit_logs;
CREATE POLICY api_audit_logs_read
  ON public.api_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.api_clients
      WHERE api_clients.client_id = api_audit_logs.client_id
        AND api_clients.owner_user_id = auth.uid()
    )
  );

-- Catalog/read-only tables (authenticated reads only; no writes)
ALTER TABLE public.authors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS authors_read ON public.authors;
CREATE POLICY authors_read
  ON public.authors
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.works ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS works_read ON public.works;
CREATE POLICY works_read
  ON public.works
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.editions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS editions_read ON public.editions;
CREATE POLICY editions_read
  ON public.editions
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.work_authors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS work_authors_read ON public.work_authors;
CREATE POLICY work_authors_read
  ON public.work_authors
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.external_ids ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS external_ids_read ON public.external_ids;
CREATE POLICY external_ids_read
  ON public.external_ids
  FOR SELECT
  TO authenticated
  USING (true);

ALTER TABLE public.source_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS source_records_read ON public.source_records;
CREATE POLICY source_records_read
  ON public.source_records
  FOR SELECT
  TO authenticated
  USING (true);

