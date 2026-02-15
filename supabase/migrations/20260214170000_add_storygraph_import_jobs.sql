DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storygraph_import_job_status') THEN
    CREATE TYPE storygraph_import_job_status AS ENUM ('queued', 'running', 'completed', 'failed');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'storygraph_import_row_result') THEN
    CREATE TYPE storygraph_import_row_result AS ENUM ('imported', 'failed', 'skipped');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.storygraph_import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  filename varchar(255) NOT NULL,
  status storygraph_import_job_status NOT NULL,
  total_rows integer NOT NULL DEFAULT 0,
  processed_rows integer NOT NULL DEFAULT 0,
  imported_rows integer NOT NULL DEFAULT 0,
  failed_rows integer NOT NULL DEFAULT 0,
  skipped_rows integer NOT NULL DEFAULT 0,
  error_summary text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_storygraph_import_jobs_user_created
  ON public.storygraph_import_jobs (user_id, created_at);
CREATE INDEX IF NOT EXISTS ix_storygraph_import_jobs_status
  ON public.storygraph_import_jobs (status);

CREATE TABLE IF NOT EXISTS public.storygraph_import_job_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.storygraph_import_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  identity_hash varchar(64) NOT NULL,
  title varchar(512),
  uid varchar(255),
  result storygraph_import_row_result NOT NULL,
  message text NOT NULL,
  work_id uuid,
  library_item_id uuid,
  review_id uuid,
  session_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_storygraph_import_job_rows_job_identity UNIQUE (job_id, identity_hash)
);

CREATE INDEX IF NOT EXISTS ix_storygraph_import_job_rows_job_row
  ON public.storygraph_import_job_rows (job_id, row_number);
CREATE INDEX IF NOT EXISTS ix_storygraph_import_job_rows_job_result
  ON public.storygraph_import_job_rows (job_id, result);

ALTER TABLE public.storygraph_import_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storygraph_import_jobs_owner ON public.storygraph_import_jobs;
CREATE POLICY storygraph_import_jobs_owner
  ON public.storygraph_import_jobs
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.storygraph_import_job_rows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS storygraph_import_job_rows_owner ON public.storygraph_import_job_rows;
CREATE POLICY storygraph_import_job_rows_owner
  ON public.storygraph_import_job_rows
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
