ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS enable_google_books boolean NOT NULL DEFAULT false;

