ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS setup_version integer NOT NULL DEFAULT 1;
ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS business_context text;
ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS offer_policy jsonb;
ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS directory_snapshot_id text;
ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS audience_criteria jsonb;
ALTER TABLE prospect_campaigns ADD COLUMN IF NOT EXISTS planning_mode text;
ALTER TABLE prospect_campaigns ALTER COLUMN message DROP NOT NULL;
ALTER TABLE prospect_campaigns ALTER COLUMN send_window DROP NOT NULL;
CREATE TABLE IF NOT EXISTS prospect_campaign_companies (
 campaign_id text NOT NULL REFERENCES prospect_campaigns(id) ON DELETE RESTRICT,
 cnpj varchar(14) NOT NULL, snapshot_id text NOT NULL, public_snapshot jsonb NOT NULL,
 added_by text NOT NULL, added_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, removed_at timestamp(3),
 PRIMARY KEY(campaign_id,cnpj)
);
CREATE INDEX IF NOT EXISTS prospect_campaign_companies_campaign_id_removed_at_cnpj_idx ON prospect_campaign_companies(campaign_id,removed_at,cnpj);
CREATE TABLE IF NOT EXISTS prospect_campaign_planning_jobs (
 id text PRIMARY KEY, campaign_id text NOT NULL REFERENCES prospect_campaigns(id) ON DELETE RESTRICT,
 expected_revision integer NOT NULL, context_hash text NOT NULL, snapshot_id text NOT NULL, mode text,
 state text NOT NULL DEFAULT 'pending', criteria jsonb, error_code text, lease_token text, lease_expires_at timestamp(3),
 reserved_cents bigint NOT NULL DEFAULT 0, spent_cents bigint NOT NULL DEFAULT 0,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS prospect_campaign_planning_jobs_state_lease_expires_at_idx ON prospect_campaign_planning_jobs(state,lease_expires_at);
CREATE TABLE IF NOT EXISTS platform_prospect_templates (
 id text PRIMARY KEY, purpose text NOT NULL DEFAULT 'zyon_sales', name text NOT NULL, language text NOT NULL,
 body text NOT NULL, revision integer NOT NULL DEFAULT 1, content_hash text NOT NULL,
 binding_id text, binding_version integer, waba_id text, provider_id text, provider_revision text,
 state text NOT NULL DEFAULT 'draft', reason text, submission_id text UNIQUE, submitted_at timestamp(3), observed_at timestamp(3),
 created_by text NOT NULL, created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS platform_prospect_templates_purpose_binding_id_state_idx ON platform_prospect_templates(purpose,binding_id,state);
