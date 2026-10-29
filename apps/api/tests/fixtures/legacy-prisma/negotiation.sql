-- Selected current model only: no fingerprint uniqueness or expiry invented.
CREATE TABLE negotiation_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  global_user_id TEXT,
  cart_fingerprint TEXT NOT NULL,
  result_json JSONB NOT NULL,
  applied_offer_json JSONB,
  estimated_ai_calls INTEGER NOT NULL,
  estimated_ai_cost_cents INTEGER NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX negotiation_sessions_merchant_id_created_at_idx ON negotiation_sessions (merchant_id, created_at);
