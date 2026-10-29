CREATE TABLE "merchant_payment_connections" (
  "merchant_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "external_account_id" TEXT,
  "secret_cipher" TEXT,
  "wallet_id" TEXT,
  "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
  "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
  "requirements" JSONB,
  "last_synced_at" TIMESTAMP(3),
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchant_payment_connections_pkey"
    PRIMARY KEY ("merchant_id", "provider"),
  CONSTRAINT "merchant_payment_connections_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "merchant_payment_connections_provider_status_idx"
ON "merchant_payment_connections"("provider", "status");

CREATE TABLE "merchant_billing_subscriptions" (
  "merchant_id" TEXT NOT NULL,
  "stripe_customer_id" TEXT,
  "stripe_subscription_id" TEXT,
  "stripe_price_id" TEXT,
  "status" TEXT NOT NULL DEFAULT 'trialing',
  "trial_ends_at" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchant_billing_subscriptions_pkey" PRIMARY KEY ("merchant_id"),
  CONSTRAINT "merchant_billing_subscriptions_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_customer_id_key"
ON "merchant_billing_subscriptions"("stripe_customer_id");

CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_subscription_id_key"
ON "merchant_billing_subscriptions"("stripe_subscription_id");

CREATE INDEX "merchant_billing_subscriptions_status_trial_ends_at_idx"
ON "merchant_billing_subscriptions"("status", "trial_ends_at");

INSERT INTO "merchant_billing_subscriptions" (
  "merchant_id",
  "status",
  "trial_ends_at",
  "updated_at"
)
SELECT
  "id",
  'trialing',
  CURRENT_TIMESTAMP + INTERVAL '14 days',
  CURRENT_TIMESTAMP
FROM "merchants"
ON CONFLICT ("merchant_id") DO NOTHING;
