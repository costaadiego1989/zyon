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
-- Real selected write tables below; fixture is NOT a production migration.
CREATE TABLE completed_orders (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, session_id TEXT NOT NULL,
  external_order_id TEXT NOT NULL, order_total DECIMAL(12,4) NOT NULL,
  currency TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'approved',
  accepted_offer_id TEXT, tracking_code TEXT, line_items_json JSONB, shipping_cents INTEGER,
  completed_at TIMESTAMP(3) NOT NULL, cancelled_at TIMESTAMP(3), cancellation_reason TEXT,
  fulfillment_json JSONB, fulfillment_version INTEGER NOT NULL DEFAULT 0, fulfilled_at TIMESTAMP(3),
  UNIQUE (id,merchant_id), UNIQUE (merchant_id,session_id,external_order_id),
  FOREIGN KEY (merchant_id,session_id) REFERENCES checkout_sessions(merchant_id,session_id) ON DELETE CASCADE
);
CREATE INDEX completed_orders_merchant_id_completed_at_idx ON completed_orders(merchant_id,completed_at);
CREATE INDEX completed_orders_merchant_id_status_completed_at_idx ON completed_orders(merchant_id,status,completed_at);
CREATE TABLE attribution_tags (
  id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, order_id TEXT NOT NULL,
  session_id TEXT NOT NULL, global_user_id TEXT NOT NULL, cohort TEXT NOT NULL,
  negotiation_applied BOOLEAN NOT NULL DEFAULT FALSE,
  cross_sell_applied BOOLEAN NOT NULL DEFAULT FALSE,
  progressive_discount_applied BOOLEAN NOT NULL DEFAULT FALSE,
  cart_recovery_applied BOOLEAN NOT NULL DEFAULT FALSE,
  intent_personalization_applied BOOLEAN NOT NULL DEFAULT FALSE,
  experiment_variant_id TEXT, order_value_cents INTEGER NOT NULL,
  discount_given_cents INTEGER NOT NULL DEFAULT 0,
  shipping_subsidy_cents INTEGER NOT NULL DEFAULT 0,
  ai_cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(merchant_id,order_id)
);
CREATE INDEX attribution_tags_merchant_id_cohort_created_at_idx ON attribution_tags(merchant_id,cohort,created_at);
