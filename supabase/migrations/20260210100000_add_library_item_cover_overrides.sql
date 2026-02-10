-- Add per-user cover override columns to library_items.
-- Safe to run even if columns already exist (CI runs Supabase migrations then Alembic).

alter table public.library_items
  add column if not exists cover_override_url text,
  add column if not exists cover_override_storage_path text,
  add column if not exists cover_override_set_by uuid,
  add column if not exists cover_override_set_at timestamptz;

-- Ensure the bucket used for caching cover images exists.
do $$
begin
  if exists (
    select 1
    from information_schema.schemata
    where schema_name = 'storage'
  ) then
    insert into storage.buckets (id, name, public)
    values ('covers', 'covers', true)
    on conflict (id) do update
      set public = excluded.public;
  end if;
end $$;
