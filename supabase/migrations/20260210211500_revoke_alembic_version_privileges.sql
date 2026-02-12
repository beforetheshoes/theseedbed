-- Revoke access to Alembic's internal version table from client roles.
--
-- `public.alembic_version` is not user data and should not be readable or
-- writable by `anon`/`authenticated`.

REVOKE ALL ON TABLE public.alembic_version FROM anon;
REVOKE ALL ON TABLE public.alembic_version FROM authenticated;

