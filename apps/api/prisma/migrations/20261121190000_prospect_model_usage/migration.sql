CREATE TABLE prospect_model_usage (
  request_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES prospect_conversations(id) ON DELETE RESTRICT,
  campaign_id text NOT NULL REFERENCES prospect_campaigns(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK(amount_cents > 0),
  state text NOT NULL CHECK(state IN ('reserved','unknown','committed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prospect_model_usage_campaign_idx ON prospect_model_usage(campaign_id, state);
