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

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS theme_heading_font_family varchar(32);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS default_progress_unit public.reading_progress_unit;

UPDATE public.users
SET default_progress_unit = 'pages_read'::public.reading_progress_unit
WHERE default_progress_unit IS NULL;

ALTER TABLE public.users
  ALTER COLUMN default_progress_unit SET DEFAULT 'pages_read'::public.reading_progress_unit,
  ALTER COLUMN default_progress_unit SET NOT NULL;
