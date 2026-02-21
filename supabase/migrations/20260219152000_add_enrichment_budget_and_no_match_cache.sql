CREATE TABLE IF NOT EXISTS public.enrichment_no_match_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  work_id uuid NOT NULL REFERENCES public.works(id) ON DELETE CASCADE,
  provider varchar(64) NOT NULL,
  reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrichment_no_match_cache_user_work_provider
    UNIQUE (user_id, work_id, provider)
);

CREATE INDEX IF NOT EXISTS ix_enrichment_no_match_cache_expires_at
  ON public.enrichment_no_match_cache (expires_at);

CREATE TABLE IF NOT EXISTS public.enrichment_provider_daily_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_date date NOT NULL,
  provider varchar(64) NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  request_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_enrichment_provider_daily_usage_scope
    UNIQUE (usage_date, provider, user_id)
);

CREATE INDEX IF NOT EXISTS ix_enrichment_provider_daily_usage_date_provider
  ON public.enrichment_provider_daily_usage (usage_date, provider);

ALTER TABLE public.enrichment_no_match_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enrichment_no_match_cache_owner ON public.enrichment_no_match_cache;
CREATE POLICY enrichment_no_match_cache_owner
  ON public.enrichment_no_match_cache
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.enrichment_provider_daily_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enrichment_provider_daily_usage_owner ON public.enrichment_provider_daily_usage;
CREATE POLICY enrichment_provider_daily_usage_owner
  ON public.enrichment_provider_daily_usage
  FOR ALL
  TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid())
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());
