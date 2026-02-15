create index if not exists ix_library_items_user_created_at_id
  on public.library_items (user_id, created_at, id);

create index if not exists ix_library_items_user_rating_id
  on public.library_items (user_id, rating, id);

create index if not exists ix_library_items_user_status_created_at
  on public.library_items (user_id, status, created_at);

create index if not exists ix_library_items_user_visibility_created_at
  on public.library_items (user_id, visibility, created_at);
