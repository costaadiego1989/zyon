CREATE TABLE prospect_audience_jobs (
  id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES prospect_campaigns(id), snapshot_id text NOT NULL,
  segment_version integer, filter_version integer NOT NULL, filters jsonb NOT NULL, explicit_cnpjs text[],
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','processing','complete','failed')),
  error_code text, cursor_cnpj text, hash text NOT NULL, company_count integer NOT NULL DEFAULT 0,
  missing_endpoint_count integer NOT NULL DEFAULT 0, recipient_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_audience_pending ON prospect_audience_jobs(created_at,id) WHERE state IN ('pending','processing');
CREATE TABLE prospect_audience_members (
  selection_id text NOT NULL REFERENCES prospect_audience_jobs(id), cnpj varchar(14) COLLATE "C" NOT NULL,
  prospect_id text REFERENCES platform_prospects(id), endpoint_ids text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (selection_id,cnpj)
);
