-- Disposable selected models with the real composite consent ownership FK.
CREATE TABLE buyer_intent_memory_consents (
  merchant_id TEXT NOT NULL,
  global_user_id TEXT NOT NULL,
  opted_in BOOLEAN NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL,
  PRIMARY KEY (merchant_id, global_user_id)
);
CREATE TABLE customer_intent_records (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  global_user_id TEXT NOT NULL,
  primary_intent TEXT NOT NULL,
  urgency TEXT NOT NULL,
  budget_tier TEXT NOT NULL,
  category_focus TEXT[],
  pain_points TEXT[],
  conversion_likelihood_pct INTEGER NOT NULL,
  behavioral_signals_json JSONB NOT NULL,
  generated_at TIMESTAMP(3) NOT NULL,
  CONSTRAINT customer_intent_records_consent_fkey FOREIGN KEY (merchant_id, global_user_id)
    REFERENCES buyer_intent_memory_consents (merchant_id, global_user_id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX customer_intent_records_merchant_id_global_user_id_idx ON customer_intent_records (merchant_id, global_user_id);
CREATE INDEX customer_intent_records_merchant_id_generated_at_idx ON customer_intent_records (merchant_id, generated_at);
