-- SYNTHETIC test fixture, not a migration; mirrors current CheckoutSetting model.
CREATE TABLE checkout_settings (
  id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL,
  widget_behavior JSONB NOT NULL,
  intervention_policy JSONB NOT NULL,
  trigger_rules JSONB NOT NULL,
  suppression_rules JSONB NOT NULL,
  handoff JSONB NOT NULL,
  advanced_rules JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX checkout_settings_merchant_id_idx ON checkout_settings(merchant_id);
