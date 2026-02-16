ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS theme_primary_color text,
ADD COLUMN IF NOT EXISTS theme_accent_color text,
ADD COLUMN IF NOT EXISTS theme_font_family varchar(32);
