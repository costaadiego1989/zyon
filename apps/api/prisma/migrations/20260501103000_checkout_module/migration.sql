CREATE TABLE "checkout_sessions" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "global_user_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "cart" JSONB NOT NULL,
  "customer" JSONB,
  "shipping" JSONB,
  "abandonment_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trigger_agent" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "checkout_events" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "checkout_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "buyer_identities" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "identity_key" TEXT NOT NULL,
  "global_user_id" TEXT NOT NULL,
  CONSTRAINT "buyer_identities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "merchant_rules" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "max_discount_percent" DOUBLE PRECISION NOT NULL,
  "minimum_margin_percent" DOUBLE PRECISION NOT NULL,
  "allow_free_shipping" BOOLEAN NOT NULL,
  "allow_shipping_discount" BOOLEAN NOT NULL,
  "allow_bonus_item" BOOLEAN NOT NULL,
  "allow_stack_discount_and_free_shipping" BOOLEAN NOT NULL,
  "free_shipping_min_cart_value" DOUBLE PRECISION NOT NULL,
  "max_shipping_subsidy" DOUBLE PRECISION NOT NULL,
  "max_partial_shipping_discount" DOUBLE PRECISION NOT NULL,
  "offer_expiration_minutes" INTEGER NOT NULL,
  "blocked_regions" TEXT[] NOT NULL,
  "brand_voice" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "merchant_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "authorized_offers" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "reason" TEXT NOT NULL,
  "margin_after_offer" DOUBLE PRECISION NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "discount_code" TEXT,
  CONSTRAINT "authorized_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "accepted_offers" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "margin_after_offer" DOUBLE PRECISION NOT NULL,
  "accepted_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "accepted_offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "completed_orders" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "external_order_id" TEXT NOT NULL,
  "order_total" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL,
  "accepted_offer_id" TEXT,
  "completed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "completed_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_messages" (
  "event_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "schema_version" INTEGER NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "correlation_id" TEXT NOT NULL,
  "causation_id" TEXT NOT NULL,
  "producer" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "published_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("event_id")
);

CREATE UNIQUE INDEX "checkout_sessions_merchant_id_session_id_key" ON "checkout_sessions"("merchant_id", "session_id");
CREATE INDEX "checkout_sessions_merchant_id_updated_at_idx" ON "checkout_sessions"("merchant_id", "updated_at");
CREATE INDEX "checkout_events_merchant_id_session_id_occurred_at_idx" ON "checkout_events"("merchant_id", "session_id", "occurred_at");
CREATE UNIQUE INDEX "buyer_identities_merchant_id_identity_key_key" ON "buyer_identities"("merchant_id", "identity_key");
CREATE INDEX "buyer_identities_merchant_id_global_user_id_idx" ON "buyer_identities"("merchant_id", "global_user_id");
CREATE UNIQUE INDEX "merchant_rules_merchant_id_key" ON "merchant_rules"("merchant_id");
CREATE INDEX "authorized_offers_merchant_id_session_id_idx" ON "authorized_offers"("merchant_id", "session_id");
CREATE UNIQUE INDEX "accepted_offers_merchant_id_session_id_offer_id_key" ON "accepted_offers"("merchant_id", "session_id", "offer_id");
CREATE INDEX "accepted_offers_merchant_id_accepted_at_idx" ON "accepted_offers"("merchant_id", "accepted_at");
CREATE UNIQUE INDEX "completed_orders_merchant_id_session_id_external_order_id_key" ON "completed_orders"("merchant_id", "session_id", "external_order_id");
CREATE INDEX "completed_orders_merchant_id_completed_at_idx" ON "completed_orders"("merchant_id", "completed_at");
CREATE INDEX "outbox_messages_merchant_id_created_at_idx" ON "outbox_messages"("merchant_id", "created_at");
CREATE INDEX "outbox_messages_status_created_at_idx" ON "outbox_messages"("status", "created_at");

ALTER TABLE "checkout_events" ADD CONSTRAINT "checkout_events_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "authorized_offers" ADD CONSTRAINT "authorized_offers_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accepted_offers" ADD CONSTRAINT "accepted_offers_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accepted_offers" ADD CONSTRAINT "accepted_offers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "authorized_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "completed_orders" ADD CONSTRAINT "completed_orders_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;
