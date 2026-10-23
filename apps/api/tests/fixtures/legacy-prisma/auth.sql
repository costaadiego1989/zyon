-- Synthetic current scalar projections for the two exact legacy auth specs.
-- Repository writes create local rows only; no Stripe/email/provider is invoked.
-- This is deliberately not a migration or proof of the full production schema.
CREATE TYPE "MerchantPlan" AS ENUM ('CHECKOUT_ONLY', 'STORE_ONLY', 'BOTH', 'API');
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');
CREATE TABLE merchants (
  id TEXT NOT NULL PRIMARY KEY,
  billing_account_merchant_id TEXT,
  name TEXT NOT NULL,
  store_slug TEXT UNIQUE,
  theme JSONB,
  store_category TEXT,
  store_settings JSONB,
  stripe_connect_account_id TEXT,
  crypto_payments_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  melhor_envio_access_token TEXT,
  melhor_envio_refresh_token TEXT,
  melhor_envio_expires_at TIMESTAMP(3),
  melhor_envio_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  budget_mode_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  budget_email TEXT,
  budget_whatsapp TEXT,
  checkout_return_url TEXT,
  plan "MerchantPlan" NOT NULL DEFAULT 'BOTH',
  event_version INTEGER NOT NULL DEFAULT 0,
  shard_id INTEGER,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  FOREIGN KEY (billing_account_merchant_id) REFERENCES merchants(id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX merchants_billing_account_merchant_id_idx ON merchants(billing_account_merchant_id);
CREATE TABLE merchant_users (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL,
  auth_version INTEGER NOT NULL DEFAULT 0,
  disabled_at TIMESTAMP(3),
  oauth_provider TEXT,
  oauth_provider_id TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX merchant_users_merchant_id_idx ON merchant_users(merchant_id);
CREATE INDEX merchant_users_oauth_provider_oauth_provider_id_idx ON merchant_users(oauth_provider, oauth_provider_id);
CREATE TABLE merchant_team_members (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  role "MerchantRole" NOT NULL DEFAULT 'STAFF',
  invited_by TEXT,
  joined_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(merchant_id, user_id)
);
CREATE INDEX merchant_team_members_merchant_id_idx ON merchant_team_members(merchant_id);
CREATE TABLE merchant_auth_sessions (
  id TEXT NOT NULL PRIMARY KEY,
  family_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  merchant_id TEXT NOT NULL,
  auth_version INTEGER NOT NULL,
  refresh_expires_at TIMESTAMP(3) NOT NULL,
  consumed_at TIMESTAMP(3),
  revoked_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX merchant_auth_sessions_family_id_idx ON merchant_auth_sessions(family_id);
CREATE INDEX merchant_auth_sessions_user_id_revoked_at_idx ON merchant_auth_sessions(user_id, revoked_at);
CREATE INDEX merchant_auth_sessions_refresh_expires_at_idx ON merchant_auth_sessions(refresh_expires_at);
CREATE TABLE merchant_password_reset_tokens (
  token_hash TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES merchant_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  auth_version INTEGER NOT NULL,
  expires_at TIMESTAMP(3) NOT NULL,
  consumed_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX merchant_password_reset_tokens_user_id_idx ON merchant_password_reset_tokens(user_id);
CREATE INDEX merchant_password_reset_tokens_expires_at_idx ON merchant_password_reset_tokens(expires_at);
CREATE TABLE merchant_billing_subscriptions (
  merchant_id TEXT NOT NULL PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  status TEXT NOT NULL DEFAULT 'trialing',
  trial_ends_at TIMESTAMP(3),
  current_period_end TIMESTAMP(3),
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  provider TEXT DEFAULT 'asaas',
  plan_key TEXT,
  asaas_customer_id TEXT,
  asaas_subscription_id TEXT,
  pending_plan_key TEXT,
  pending_upgrade_plan_key TEXT,
  pending_upgrade_amount_cents INTEGER,
  pending_upgrade_requested_at TIMESTAMP(3),
  billing_amount_cents INTEGER,
  billing_cycle TEXT NOT NULL DEFAULT 'monthly',
  billing_discount_percent INTEGER NOT NULL DEFAULT 0,
  pending_billing_cycle TEXT,
  pending_billing_amount_cents INTEGER,
  pending_billing_discount_percent INTEGER,
  last_billing_event_at TIMESTAMP(3),
  last_billing_payment_id TEXT,
  last_billing_payment_due_at TIMESTAMP(3),
  pending_plan_effective_at TIMESTAMP(3),
  provider_cancellation_scheduled_at TIMESTAMP(3)
);
CREATE INDEX merchant_billing_subscriptions_status_trial_ends_at_idx ON merchant_billing_subscriptions(status, trial_ends_at);
CREATE INDEX merchant_billing_subscriptions_asaas_subscription_id_idx ON merchant_billing_subscriptions(asaas_subscription_id);
CREATE TABLE merchant_rules (
  id TEXT NOT NULL PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE,
  max_discount_percent DECIMAL(12,4) NOT NULL,
  minimum_margin_percent DECIMAL(12,4) NOT NULL,
  allow_free_shipping BOOLEAN NOT NULL,
  allow_shipping_discount BOOLEAN NOT NULL,
  allow_bonus_item BOOLEAN NOT NULL,
  allow_stack_discount_and_free_shipping BOOLEAN NOT NULL,
  coupon_box_enabled BOOLEAN NOT NULL,
  autonomous_engine_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  free_shipping_min_cart_value DECIMAL(12,4) NOT NULL,
  max_shipping_subsidy DECIMAL(12,4) NOT NULL,
  max_partial_shipping_discount DECIMAL(12,4) NOT NULL,
  offer_expiration_minutes INTEGER NOT NULL,
  blocked_regions TEXT[],
  brand_voice TEXT NOT NULL,
  origin_zip TEXT,
  quick_replies JSONB,
  crypto_payments JSONB,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE TABLE agent_rules (
  id TEXT NOT NULL PRIMARY KEY,
  agent_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  user_id TEXT REFERENCES merchant_users(id) ON DELETE CASCADE ON UPDATE CASCADE,
  scope TEXT NOT NULL,
  identity JSONB NOT NULL,
  capabilities JSONB NOT NULL,
  guardrails JSONB NOT NULL,
  checkout_settings JSONB NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  UNIQUE(merchant_id, agent_id),
  UNIQUE(merchant_id, user_id, scope)
);
CREATE INDEX agent_rules_merchant_id_user_id_idx ON agent_rules(merchant_id, user_id);
