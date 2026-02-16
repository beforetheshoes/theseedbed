-- Reading Sessions v2 foundation: read cycles + progress logs.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'reading_progress_unit'
  ) THEN
    CREATE TYPE public.reading_progress_unit AS ENUM (
      'pages_read',
      'percent_complete',
      'minutes_listened'
    );
  END IF;
END $$;

ALTER TABLE public.editions
  ADD COLUMN IF NOT EXISTS total_pages integer,
  ADD COLUMN IF NOT EXISTS total_audio_minutes integer;

ALTER TABLE public.editions
  DROP CONSTRAINT IF EXISTS ck_editions_total_pages_positive,
  ADD CONSTRAINT ck_editions_total_pages_positive
    CHECK (total_pages IS NULL OR total_pages >= 1),
  DROP CONSTRAINT IF EXISTS ck_editions_total_audio_minutes_positive,
  ADD CONSTRAINT ck_editions_total_audio_minutes_positive
    CHECK (total_audio_minutes IS NULL OR total_audio_minutes >= 1);

ALTER TABLE public.reading_sessions
  ADD COLUMN IF NOT EXISTS title varchar(255);

ALTER TABLE public.reading_sessions
  DROP CONSTRAINT IF EXISTS ck_reading_sessions_pages_read_nonnegative,
  DROP CONSTRAINT IF EXISTS ck_reading_sessions_progress_percent_range;

ALTER TABLE public.reading_sessions
  DROP COLUMN IF EXISTS pages_read,
  DROP COLUMN IF EXISTS progress_percent;

CREATE TABLE IF NOT EXISTS public.reading_progress_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  library_item_id uuid NOT NULL REFERENCES public.library_items(id) ON DELETE CASCADE,
  reading_session_id uuid NOT NULL REFERENCES public.reading_sessions(id) ON DELETE CASCADE,
  logged_at timestamptz NOT NULL,
  unit public.reading_progress_unit NOT NULL,
  value numeric(10,2) NOT NULL,
  canonical_percent numeric(6,3),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reading_progress_logs_value_nonnegative CHECK (value >= 0),
  CONSTRAINT ck_reading_progress_logs_canonical_percent_range
    CHECK (canonical_percent IS NULL OR (canonical_percent >= 0 AND canonical_percent <= 100))
);

CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_user_id
  ON public.reading_progress_logs (user_id);
CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_library_item_logged_at
  ON public.reading_progress_logs (library_item_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS ix_reading_progress_logs_session_logged_at
  ON public.reading_progress_logs (reading_session_id, logged_at DESC);

ALTER TABLE public.reading_progress_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS reading_progress_logs_owner ON public.reading_progress_logs;
CREATE POLICY reading_progress_logs_owner
ON public.reading_progress_logs
FOR ALL
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
