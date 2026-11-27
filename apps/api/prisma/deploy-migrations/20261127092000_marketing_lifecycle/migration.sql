CREATE TABLE marketing_history_jobs (
  merchant_id text PRIMARY KEY, status text NOT NULL, updated_at timestamptz NOT NULL, data jsonb NOT NULL
);
CREATE INDEX marketing_history_jobs_due ON marketing_history_jobs(status,updated_at);
CREATE TABLE marketing_suppressions (
  merchant_id text NOT NULL, identity_hash text NOT NULL, recorded_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(merchant_id,identity_hash)
);
