-- The exact legacy spec exercises CheckoutSession, NOT RecoveryAttempt.
-- All current scalar columns are present; reverse relations need no fake tables.
CREATE TABLE checkout_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  global_user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  cart JSONB NOT NULL,
  customer JSONB,
  shipping JSONB,
  shipping_options JSONB,
  abandonment_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  trigger_agent BOOLEAN NOT NULL DEFAULT FALSE,
  chat_history JSONB NOT NULL DEFAULT '[]'::JSONB,
  payment_method TEXT,
  prompt_variant_id TEXT,
  cohort TEXT,
  features_applied JSONB,
  ai_cost_cents INTEGER NOT NULL DEFAULT 0,
  strategy_context_version INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE (merchant_id, session_id)
);
CREATE INDEX checkout_sessions_merchant_id_updated_at_idx ON checkout_sessions (merchant_id, updated_at);
CREATE INDEX checkout_sessions_merchant_id_created_at_idx ON checkout_sessions (merchant_id, created_at);
CREATE INDEX checkout_sessions_merchant_id_cohort_created_at_idx ON checkout_sessions (merchant_id, cohort, created_at);
CREATE INDEX checkout_sessions_merchant_id_prompt_variant_id_created_at_idx ON checkout_sessions (merchant_id, prompt_variant_id, created_at);
CREATE INDEX checkout_sessions_global_user_id_merchant_id_created_at_idx ON checkout_sessions (global_user_id, merchant_id, created_at);
