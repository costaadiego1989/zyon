-- Foundations phase: shared persistence + downstream growth-context tables.
-- Adds the OTP store, login-abuse counters, the outbox per-handler execution
-- ledger, an optimistic-lock version on checkout sessions, and Prisma-backed
-- tables for coupons, cross-sell, scraping-agent and self-checkout wallets.
-- Generated to accompany schema.prisma; `prisma migrate dev` was not run
-- because no local dev DB is configured in this environment.

-- --- Outbox per-(handler, event) execution ledger ---
CREATE TABLE "outbox_handler_executions" (
    "event_id" TEXT NOT NULL,
    "handler_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_handler_executions_pkey" PRIMARY KEY ("event_id", "handler_id")
);

CREATE INDEX "outbox_handler_executions_event_id_idx"
ON "outbox_handler_executions"("event_id");

-- --- Optimistic-lock version on checkout sessions ---
ALTER TABLE "checkout_sessions" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

-- --- Buyer phone OTP store ---
CREATE TABLE "buyer_phone_otps" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_phone_otps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "buyer_phone_otps_phone_key" ON "buyer_phone_otps"("phone");
CREATE INDEX "buyer_phone_otps_expires_at_idx" ON "buyer_phone_otps"("expires_at");

-- --- Login attempt counters (shared, persistent) ---
CREATE TABLE "login_attempt_counters" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_ends_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempt_counters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "login_attempt_counters_scope_key_key" ON "login_attempt_counters"("scope_key");
CREATE INDEX "login_attempt_counters_window_ends_at_idx" ON "login_attempt_counters"("window_ends_at");

-- --- Coupons ---
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DOUBLE PRECISION NOT NULL,
    "min_cart_total" DOUBLE PRECISION,
    "max_usages" INTEGER,
    "max_per_buyer" INTEGER,
    "usages_count" INTEGER NOT NULL DEFAULT 0,
    "allowed_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coupons_merchant_id_code_key" ON "coupons"("merchant_id", "code");
CREATE INDEX "coupons_merchant_id_status_idx" ON "coupons"("merchant_id", "status");

CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "buyer_global_user_id" TEXT,
    "discount_applied" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "coupon_redemptions_merchant_id_session_id_coupon_id_key"
ON "coupon_redemptions"("merchant_id", "session_id", "coupon_id");
CREATE INDEX "coupon_redemptions_merchant_id_coupon_id_status_idx"
ON "coupon_redemptions"("merchant_id", "coupon_id", "status");
CREATE INDEX "coupon_redemptions_merchant_id_buyer_global_user_id_coupon_id_status_idx"
ON "coupon_redemptions"("merchant_id", "buyer_global_user_id", "coupon_id", "status");

ALTER TABLE "coupon_redemptions"
ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey"
FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Cross-sell ---
CREATE TABLE "cross_sell_promotions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "recommended_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discount_percent" DOUBLE PRECISION NOT NULL,
    "max_discount_percent" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_sell_promotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cross_sell_promotions_merchant_id_status_idx"
ON "cross_sell_promotions"("merchant_id", "status");

CREATE TABLE "cross_sell_suggestions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "promo_id" TEXT NOT NULL,
    "ranked_items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_copy" TEXT NOT NULL,
    "computed_discount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suggested_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "cross_sell_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cross_sell_suggestions_merchant_id_session_id_promo_id_status_idx"
ON "cross_sell_suggestions"("merchant_id", "session_id", "promo_id", "status");
CREATE INDEX "cross_sell_suggestions_merchant_id_status_idx"
ON "cross_sell_suggestions"("merchant_id", "status");

ALTER TABLE "cross_sell_suggestions"
ADD CONSTRAINT "cross_sell_suggestions_promo_id_fkey"
FOREIGN KEY ("promo_id") REFERENCES "cross_sell_promotions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- --- Scraping-agent price-quote jobs ---
CREATE TABLE "price_quote_jobs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "buyer_global_user_id" TEXT,
    "raw_query" TEXT NOT NULL,
    "normalized_query" JSONB,
    "requested_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "results" JSONB NOT NULL DEFAULT '[]',
    "ranked_results" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "routing_decision" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_quote_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "price_quote_jobs_merchant_id_status_created_at_idx"
ON "price_quote_jobs"("merchant_id", "status", "created_at");
CREATE INDEX "price_quote_jobs_merchant_id_session_id_idx"
ON "price_quote_jobs"("merchant_id", "session_id");

-- --- Self-checkout buyer wallet & templates ---
CREATE TABLE "self_checkout_buyer_users" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "consent_version" TEXT NOT NULL,
    "consent_updated_at" TIMESTAMP(3) NOT NULL,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_checkout_buyer_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "self_checkout_buyer_users_merchant_id_email_key"
ON "self_checkout_buyer_users"("merchant_id", "email");

CREATE TABLE "self_checkout_wallets" (
    "id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_checkout_wallets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "self_checkout_wallets_buyer_user_id_key"
ON "self_checkout_wallets"("buyer_user_id");

ALTER TABLE "self_checkout_wallets"
ADD CONSTRAINT "self_checkout_wallets_buyer_user_id_fkey"
FOREIGN KEY ("buyer_user_id") REFERENCES "self_checkout_buyer_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "self_checkout_saved_addresses" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "self_checkout_saved_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "self_checkout_saved_addresses_wallet_id_idx"
ON "self_checkout_saved_addresses"("wallet_id");

ALTER TABLE "self_checkout_saved_addresses"
ADD CONSTRAINT "self_checkout_saved_addresses_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "self_checkout_wallets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "self_checkout_saved_payment_methods" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_token" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "self_checkout_saved_payment_methods_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "self_checkout_saved_payment_methods_wallet_id_idx"
ON "self_checkout_saved_payment_methods"("wallet_id");

ALTER TABLE "self_checkout_saved_payment_methods"
ADD CONSTRAINT "self_checkout_saved_payment_methods_wallet_id_fkey"
FOREIGN KEY ("wallet_id") REFERENCES "self_checkout_wallets"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "self_checkout_templates" (
    "id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "saved_address_id" TEXT NOT NULL,
    "saved_payment_method_id" TEXT NOT NULL,
    "preferred_shipping_method_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_checkout_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "self_checkout_templates_buyer_user_id_idx"
ON "self_checkout_templates"("buyer_user_id");
CREATE INDEX "self_checkout_templates_merchant_id_buyer_user_id_idx"
ON "self_checkout_templates"("merchant_id", "buyer_user_id");

ALTER TABLE "self_checkout_templates"
ADD CONSTRAINT "self_checkout_templates_buyer_user_id_fkey"
FOREIGN KEY ("buyer_user_id") REFERENCES "self_checkout_buyer_users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
