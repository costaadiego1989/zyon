-- Canonical auth and subscription tables used by the local HTTP integration fixture.
CREATE TYPE "MerchantPlan" AS ENUM ('CHECKOUT_ONLY', 'STORE_ONLY', 'BOTH', 'API');
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "billing_account_merchant_id" TEXT,
    "name" TEXT NOT NULL,
    "store_slug" TEXT,
    "theme" JSONB,
    "store_category" TEXT,
    "store_settings" JSONB,
    "stripe_connect_account_id" TEXT,
    "crypto_payments_enabled" BOOLEAN NOT NULL DEFAULT false,
    "melhor_envio_access_token" TEXT,
    "melhor_envio_refresh_token" TEXT,
    "melhor_envio_expires_at" TIMESTAMP(3),
    "melhor_envio_enabled" BOOLEAN NOT NULL DEFAULT true,
    "budget_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "budget_email" TEXT,
    "budget_whatsapp" TEXT,
    "checkout_return_url" TEXT,
    "plan" "MerchantPlan" NOT NULL DEFAULT 'BOTH',
    "event_version" INTEGER NOT NULL DEFAULT 0,
    "shard_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);
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
    "provider" TEXT DEFAULT 'asaas',
    "plan_key" TEXT,
    "asaas_customer_id" TEXT,
    "asaas_subscription_id" TEXT,
    "pending_plan_key" TEXT,
    "pending_upgrade_plan_key" TEXT,
    "pending_upgrade_amount_cents" INTEGER,
    "pending_upgrade_requested_at" TIMESTAMP(3),
    "billing_amount_cents" INTEGER,
    "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
    "billing_discount_percent" INTEGER NOT NULL DEFAULT 0,
    "pending_billing_cycle" TEXT,
    "pending_billing_amount_cents" INTEGER,
    "pending_billing_discount_percent" INTEGER,
    "last_billing_event_at" TIMESTAMP(3),
    "last_billing_payment_id" TEXT,
    "last_billing_payment_due_at" TIMESTAMP(3),
    "pending_plan_effective_at" TIMESTAMP(3),
    "provider_cancellation_scheduled_at" TIMESTAMP(3),

    CONSTRAINT "merchant_billing_subscriptions_pkey" PRIMARY KEY ("merchant_id")
);
CREATE TABLE "billing_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "payment_id" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "merchant_users" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL DEFAULT 0,
    "disabled_at" TIMESTAMP(3),
    "oauth_provider" TEXT,
    "oauth_provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "merchant_auth_sessions" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "auth_version" INTEGER NOT NULL,
    "refresh_expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_auth_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "payment_provider_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "merchant_id" TEXT,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "merchant_team_members" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'STAFF',
    "invited_by" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_team_members_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "merchants_store_slug_key" ON "merchants"("store_slug");
CREATE INDEX "merchants_billing_account_merchant_id_idx" ON "merchants"("billing_account_merchant_id");
CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_customer_id_key" ON "merchant_billing_subscriptions"("stripe_customer_id");
CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_subscription_id_key" ON "merchant_billing_subscriptions"("stripe_subscription_id");
CREATE INDEX "merchant_billing_subscriptions_status_trial_ends_at_idx" ON "merchant_billing_subscriptions"("status", "trial_ends_at");
CREATE INDEX "merchant_billing_subscriptions_asaas_subscription_id_idx" ON "merchant_billing_subscriptions"("asaas_subscription_id");
CREATE INDEX "billing_webhook_events_merchant_id_occurred_at_idx" ON "billing_webhook_events"("merchant_id", "occurred_at");
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_id_key" ON "billing_webhook_events"("provider", "event_id");
CREATE INDEX "merchant_users_merchant_id_idx" ON "merchant_users"("merchant_id");
CREATE INDEX "merchant_users_oauth_provider_oauth_provider_id_idx" ON "merchant_users"("oauth_provider", "oauth_provider_id");
CREATE UNIQUE INDEX "merchant_users_email_key" ON "merchant_users"("email");
CREATE INDEX "merchant_auth_sessions_family_id_idx" ON "merchant_auth_sessions"("family_id");
CREATE INDEX "merchant_auth_sessions_user_id_revoked_at_idx" ON "merchant_auth_sessions"("user_id", "revoked_at");
CREATE INDEX "merchant_auth_sessions_refresh_expires_at_idx" ON "merchant_auth_sessions"("refresh_expires_at");
CREATE INDEX "payment_provider_events_merchant_id_processed_at_idx" ON "payment_provider_events"("merchant_id", "processed_at");
CREATE UNIQUE INDEX "payment_provider_events_provider_merchant_id_event_id_key" ON "payment_provider_events"("provider", "merchant_id", "event_id");
CREATE INDEX "merchant_team_members_merchant_id_idx" ON "merchant_team_members"("merchant_id");
CREATE UNIQUE INDEX "merchant_team_members_merchant_id_user_id_key" ON "merchant_team_members"("merchant_id", "user_id");
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_billing_account_merchant_id_fkey" FOREIGN KEY ("billing_account_merchant_id") REFERENCES "merchants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "merchant_billing_subscriptions" ADD CONSTRAINT "merchant_billing_subscriptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_auth_sessions" ADD CONSTRAINT "merchant_auth_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "merchant_team_members" ADD CONSTRAINT "merchant_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
