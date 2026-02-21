DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrichment_task_status') THEN
    CREATE TYPE enrichment_task_status AS ENUM (
      'pending',
      'in_progress',
      'complete',
      'needs_review',
      'failed',
      'skipped'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrichment_task_confidence') THEN
    CREATE TYPE enrichment_task_confidence AS ENUM ('high', 'medium', 'low', 'none');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrichment_trigger_source') THEN
    CREATE TYPE enrichment_trigger_source AS ENUM ('post_import', 'manual_bulk', 'lazy');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enrichment_audit_action') THEN
    CREATE TYPE enrichment_audit_action AS ENUM (
      'auto_applied',
      'queued_review',
      'skipped',
      'failed',
      'dismissed',
      'approved'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.library_item_enrichment_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  edition_id uuid REFERENCES public.editions(id) ON DELETE SET NULL,
  trigger_source enrichment_trigger_source NOT NULL,
  import_source varchar(32),
  import_job_id uuid,
  status enrichment_task_status NOT NULL DEFAULT 'pending',
  confidence enrichment_task_confidence NOT NULL DEFAULT 'none',
  priority smallint NOT NULL DEFAULT 100,
  missing_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  providers_attempted text[] NOT NULL DEFAULT ARRAY[]::text[],
  fields_applied text[] NOT NULL DEFAULT ARRAY[]::text[],
  match_details jsonb,
  attempt_count smallint NOT NULL DEFAULT 0,
  max_attempts smallint NOT NULL DEFAULT 3,
  next_attempt_after timestamptz NOT NULL DEFAULT now(),
  last_error text,
  idempotency_key varchar(255) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_library_item_enrichment_tasks_status_next
  ON public.library_item_enrichment_tasks (status, next_attempt_after, priority, created_at);
CREATE INDEX IF NOT EXISTS ix_library_item_enrichment_tasks_user_status_created
  ON public.library_item_enrichment_tasks (user_id, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_task_active_dedupe
  ON public.library_item_enrichment_tasks (user_id, library_item_id, idempotency_key)
  WHERE status IN ('pending', 'in_progress', 'needs_review');

CREATE TABLE IF NOT EXISTS public.library_item_enrichment_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.library_item_enrichment_tasks(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  action enrichment_audit_action NOT NULL,
  provider varchar(64),
  confidence enrichment_task_confidence NOT NULL DEFAULT 'none',
  fields_changed jsonb,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_library_item_enrichment_audit_user_created
  ON public.library_item_enrichment_audit_log (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_library_item_enrichment_audit_task_created
  ON public.library_item_enrichment_audit_log (task_id, created_at);

ALTER TABLE public.library_item_enrichment_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_item_enrichment_tasks_owner ON public.library_item_enrichment_tasks;
CREATE POLICY library_item_enrichment_tasks_owner
  ON public.library_item_enrichment_tasks
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.library_item_enrichment_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS library_item_enrichment_audit_log_owner ON public.library_item_enrichment_audit_log;
CREATE POLICY library_item_enrichment_audit_log_owner
  ON public.library_item_enrichment_audit_log
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
