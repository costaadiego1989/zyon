-- Synthetic local repository fixture only; no commerce API is contacted.
CREATE TYPE "MerchantPlan" AS ENUM ('CHECKOUT_ONLY', 'STORE_ONLY', 'BOTH', 'API');
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
CREATE TABLE merchant_commerce_connections (
  merchant_id TEXT NOT NULL PRIMARY KEY REFERENCES merchants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  provider TEXT NOT NULL DEFAULT 'shopify',
  shop_domain TEXT NOT NULL,
  admin_token_cipher TEXT NOT NULL,
  api_version TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_tested_at TIMESTAMP(3),
  last_synced_at TIMESTAMP(3),
  last_error_code TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL
);
CREATE INDEX merchant_commerce_connections_provider_status_idx ON merchant_commerce_connections(provider, status);
CREATE TABLE commerce_pending_orders (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  session_id TEXT NOT NULL,
  commerce_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payment_reference TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL,
  PRIMARY KEY(merchant_id, session_id)
);
CREATE INDEX commerce_pending_orders_merchant_id_status_updated_at_idx ON commerce_pending_orders(merchant_id, status, updated_at);
CREATE TABLE commerce_paid_events (
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE ON UPDATE CASCADE,
  payment_reference TEXT NOT NULL,
  commerce_order_id TEXT NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(merchant_id, payment_reference)
);
CREATE INDEX commerce_paid_events_merchant_id_created_at_idx ON commerce_paid_events(merchant_id, created_at);
CREATE TABLE outbox_messages (
  event_id TEXT NOT NULL PRIMARY KEY,
  event_type TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  merchant_id TEXT NOT NULL,
  occurred_at TIMESTAMP(3) NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT NOT NULL,
  producer TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TIMESTAMP(3),
  delivered_at TIMESTAMP(3),
  published_at TIMESTAMP(3),
  lease_token TEXT,
  lease_expires_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX outbox_messages_merchant_id_created_at_idx ON outbox_messages(merchant_id, created_at);
CREATE INDEX outbox_messages_status_created_at_idx ON outbox_messages(status, created_at);
CREATE INDEX outbox_messages_status_next_attempt_at_idx ON outbox_messages(status, next_attempt_at);
CREATE INDEX outbox_messages_status_lease_expires_at_idx ON outbox_messages(status, lease_expires_at);
