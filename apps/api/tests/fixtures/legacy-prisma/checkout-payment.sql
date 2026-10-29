-- Owned disposable checkout/payment repository proof only; NOT a migration.
-- All selected current scalar columns and local FKs are present.
-- Empty strategy_assignments/strategy_incentive_assignments/checkout_chat_requests
-- are reader projections, NOT strategy execution/claim/publication proof.
-- StrategyAssignment.execution FK references an aggregate outside this fixture.
-- Its omission is an explicit projection limit; no strategy rows may be written
-- by these tests. Empty digital/catalog readers do not prove digital fulfillment.
-- No real provider, service booking, Redis, credentials, feature flags or seeds.
CREATE TYPE "MerchantPlan" AS ENUM ('CHECKOUT_ONLY', 'STORE_ONLY', 'BOTH', 'API');
CREATE TABLE "merchants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "billing_account_merchant_id" TEXT,
  "name" TEXT NOT NULL,
  "store_slug" TEXT UNIQUE,
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
  "plan" "MerchantPlan" NOT NULL DEFAULT 'BOTH'::"MerchantPlan",
  "event_version" INTEGER NOT NULL DEFAULT 0,
  "shard_id" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "synthetic_merchants_idx_1" ON "merchants" ("billing_account_merchant_id");
CREATE TABLE "merchant_rules" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL UNIQUE,
  "max_discount_percent" DECIMAL(12,4) NOT NULL,
  "minimum_margin_percent" DECIMAL(12,4) NOT NULL,
  "allow_free_shipping" BOOLEAN NOT NULL,
  "allow_shipping_discount" BOOLEAN NOT NULL,
  "allow_bonus_item" BOOLEAN NOT NULL,
  "allow_stack_discount_and_free_shipping" BOOLEAN NOT NULL,
  "coupon_box_enabled" BOOLEAN NOT NULL,
  "autonomous_engine_enabled" BOOLEAN NOT NULL DEFAULT true,
  "free_shipping_min_cart_value" DECIMAL(12,4) NOT NULL,
  "max_shipping_subsidy" DECIMAL(12,4) NOT NULL,
  "max_partial_shipping_discount" DECIMAL(12,4) NOT NULL,
  "offer_expiration_minutes" INTEGER NOT NULL,
  "blocked_regions" TEXT[],
  "brand_voice" TEXT NOT NULL,
  "origin_zip" TEXT,
  "quick_replies" JSONB,
  "crypto_payments" JSONB,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "buyer_identities" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "identity_key" TEXT NOT NULL,
  "global_user_id" TEXT NOT NULL,
  UNIQUE ("merchant_id", "identity_key")
);
CREATE INDEX "synthetic_buyer_identities_idx_1" ON "buyer_identities" ("merchant_id", "global_user_id");
CREATE TABLE "checkout_sessions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "global_user_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "cart" JSONB NOT NULL,
  "customer" JSONB,
  "shipping" JSONB,
  "shipping_options" JSONB,
  "abandonment_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trigger_agent" BOOLEAN NOT NULL DEFAULT false,
  "chat_history" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "payment_method" TEXT,
  "prompt_variant_id" TEXT,
  "cohort" TEXT,
  "features_applied" JSONB,
  "ai_cost_cents" INTEGER NOT NULL DEFAULT 0,
  "strategy_context_version" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("merchant_id", "session_id")
);
CREATE INDEX "synthetic_checkout_sessions_idx_1" ON "checkout_sessions" ("merchant_id", "updated_at");
CREATE INDEX "synthetic_checkout_sessions_idx_2" ON "checkout_sessions" ("merchant_id", "created_at");
CREATE INDEX "synthetic_checkout_sessions_idx_3" ON "checkout_sessions" ("merchant_id", "cohort", "created_at");
CREATE INDEX "synthetic_checkout_sessions_idx_4" ON "checkout_sessions" ("merchant_id", "prompt_variant_id", "created_at");
CREATE INDEX "synthetic_checkout_sessions_idx_5" ON "checkout_sessions" ("global_user_id", "merchant_id", "created_at");
CREATE TABLE "checkout_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "metadata" JSONB
);
CREATE INDEX "synthetic_checkout_events_idx_1" ON "checkout_events" ("merchant_id", "session_id", "occurred_at");
CREATE INDEX "synthetic_checkout_events_idx_2" ON "checkout_events" ("merchant_id", "event_name", "occurred_at", "session_id");
CREATE TABLE "authorized_offers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DECIMAL(12,4) NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "margin_after_offer" DECIMAL(12,4) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "discount_code" TEXT
);
CREATE INDEX "synthetic_authorized_offers_idx_1" ON "authorized_offers" ("merchant_id", "session_id");
CREATE TABLE "accepted_offers" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DECIMAL(12,4) NOT NULL,
  "margin_after_offer" DECIMAL(12,4) NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("merchant_id", "session_id", "offer_id")
);
CREATE INDEX "synthetic_accepted_offers_idx_1" ON "accepted_offers" ("merchant_id", "accepted_at");
CREATE TABLE "completed_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "order_total" DECIMAL(12,4) NOT NULL,
  "currency" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'approved',
  "accepted_offer_id" TEXT,
  "tracking_code" TEXT,
  "line_items_json" JSONB,
  "shipping_cents" INTEGER,
  "completed_at" TIMESTAMP(3) NOT NULL,
  "cancelled_at" TIMESTAMP(3),
  "cancellation_reason" TEXT,
  "fulfillment_json" JSONB,
  "fulfillment_version" INTEGER NOT NULL DEFAULT 0,
  "fulfilled_at" TIMESTAMP(3),
  UNIQUE ("id", "merchant_id"),
  UNIQUE ("merchant_id", "session_id", "external_order_id")
);
CREATE INDEX "synthetic_completed_orders_idx_1" ON "completed_orders" ("merchant_id", "completed_at");
CREATE INDEX "synthetic_completed_orders_idx_2" ON "completed_orders" ("merchant_id", "status", "completed_at");
CREATE TABLE "outbox_messages" (
  "event_id" TEXT NOT NULL PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "causation_id" TEXT NOT NULL,
  "producer" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "next_attempt_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "published_at" TIMESTAMP(3),
  "lease_token" TEXT,
  "lease_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "synthetic_outbox_messages_idx_1" ON "outbox_messages" ("merchant_id", "created_at");
CREATE INDEX "synthetic_outbox_messages_idx_2" ON "outbox_messages" ("status", "created_at");
CREATE INDEX "synthetic_outbox_messages_idx_3" ON "outbox_messages" ("status", "next_attempt_at");
CREATE INDEX "synthetic_outbox_messages_idx_4" ON "outbox_messages" ("status", "lease_expires_at");
CREATE TABLE "strategy_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "execution_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "global_user_id" TEXT NOT NULL,
  "variant_id" TEXT NOT NULL,
  "arm" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("id", "merchant_id"),
  UNIQUE ("merchant_id", "session_id"),
  UNIQUE ("execution_id", "merchant_id", "global_user_id")
);
CREATE INDEX "synthetic_strategy_assignments_idx_1" ON "strategy_assignments" ("execution_id", "merchant_id", "assigned_at");
CREATE TABLE "strategy_incentive_assignments" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "execution_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "buyer_id" TEXT NOT NULL,
  "arm" TEXT NOT NULL,
  "assigned_at" TIMESTAMP(3) NOT NULL,
  "cart_hash" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "cost_cents" INTEGER NOT NULL,
  "reservation_id" TEXT UNIQUE,
  UNIQUE ("merchant_id", "session_id"),
  UNIQUE ("execution_id", "merchant_id", "buyer_id"),
  UNIQUE ("id", "merchant_id")
);
CREATE INDEX "synthetic_strategy_incentive_assignments_idx_1" ON "strategy_incentive_assignments" ("execution_id", "merchant_id", "arm");
CREATE TABLE "checkout_chat_requests" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "response_hash" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL,
  "finished_at" TIMESTAMP(3),
  "protocol_version" INTEGER NOT NULL DEFAULT 2,
  "buyer_message_hash" TEXT,
  UNIQUE ("id", "merchant_id"),
  UNIQUE ("id", "merchant_id", "session_id"),
  UNIQUE ("merchant_id", "session_id", "message_id")
);
CREATE INDEX "synthetic_checkout_chat_requests_idx_1" ON "checkout_chat_requests" ("status", "started_at");
CREATE TABLE "payment_intents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "provider_payment_id" TEXT,
  "approved_amount_cents" INTEGER,
  "accepted_offer_id" TEXT,
  "commerce_order_id" TEXT,
  "buyer_facing" JSONB,
  "version" INTEGER NOT NULL DEFAULT 0,
  "amount_breakdown" JSONB,
  "creation" JSONB,
  "status_history" JSONB NOT NULL DEFAULT '[]'::JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "digital_content" JSONB,
  UNIQUE ("merchant_id", "session_id", "idempotency_key"),
  UNIQUE ("merchant_id", "provider_payment_id"),
  UNIQUE ("id", "merchant_id")
);
CREATE INDEX "synthetic_payment_intents_idx_1" ON "payment_intents" ("merchant_id", "session_id");
CREATE INDEX "synthetic_payment_intents_idx_2" ON "payment_intents" ("merchant_id", "commerce_order_id");
CREATE INDEX "synthetic_payment_intents_idx_3" ON "payment_intents" ("status", "updated_at");
CREATE TABLE "payment_provider_events" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL DEFAULT 'asaas',
  "merchant_id" TEXT,
  "event_id" TEXT NOT NULL,
  "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("provider", "merchant_id", "event_id")
);
CREATE INDEX "synthetic_payment_provider_events_idx_1" ON "payment_provider_events" ("merchant_id", "processed_at");
CREATE TABLE "product_categories" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "parent_id" TEXT,
  "description" TEXT,
  "image_url" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("merchant_id", "slug")
);
CREATE INDEX "synthetic_product_categories_idx_1" ON "product_categories" ("merchant_id");
CREATE TABLE "products" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "merchant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "type" TEXT NOT NULL DEFAULT 'physical',
  "metadata" JSONB,
  "category_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "deleted_at" TIMESTAMP(3),
  "seo_title" TEXT,
  "meta_description" TEXT,
  "slug" TEXT UNIQUE,
  "og_title" TEXT,
  "og_description" TEXT,
  "twitter_card" TEXT,
  "keywords" TEXT[] DEFAULT '{}'::TEXT[],
  "seo_generated_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "synthetic_products_idx_1" ON "products" ("merchant_id");
CREATE INDEX "synthetic_products_idx_2" ON "products" ("merchant_id", "is_active", "created_at");
CREATE INDEX "synthetic_products_idx_3" ON "products" ("merchant_id", "category_id", "is_active");
CREATE INDEX "synthetic_products_idx_4" ON "products" ("slug");
CREATE TABLE "product_variants" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "product_id" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "attributes" JSONB NOT NULL DEFAULT '{}'::JSONB,
  "barcode" TEXT,
  "weight_grams" INTEGER,
  "length_cm" DOUBLE PRECISION,
  "width_cm" DOUBLE PRECISION,
  "height_cm" DOUBLE PRECISION,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  UNIQUE ("product_id", "sku")
);
CREATE INDEX "synthetic_product_variants_idx_1" ON "product_variants" ("product_id");
ALTER TABLE "merchants" ADD FOREIGN KEY ("billing_account_merchant_id") REFERENCES "merchants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_events" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "authorized_offers" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accepted_offers" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accepted_offers" ADD FOREIGN KEY ("offer_id") REFERENCES "authorized_offers" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "completed_orders" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "strategy_assignments" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "checkout_chat_requests" ADD FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions" ("merchant_id", "session_id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "product_categories" ADD FOREIGN KEY ("parent_id") REFERENCES "product_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "products" ADD FOREIGN KEY ("category_id") REFERENCES "product_categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_variants" ADD FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
