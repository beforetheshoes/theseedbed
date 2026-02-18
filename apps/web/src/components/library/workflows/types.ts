export type Edition = {
  id: string;
  title?: string | null;
  format?: string | null;
};

export type CoverCandidate = {
  source: "openlibrary" | "googlebooks" | string;
  source_id?: string | null;
  source_url?: string | null;
  image_url?: string | null;
  thumbnail_url?: string | null;
  cover_id?: number | null;
};

export type EnrichmentCandidate = {
  provider: "openlibrary" | "googlebooks";
  provider_id: string;
  value: unknown;
  display_value: string;
  source_label: string;
};

export type EnrichmentField = {
  field_key: string;
  current_value: unknown;
  has_conflict?: boolean;
  candidates: EnrichmentCandidate[];
};
