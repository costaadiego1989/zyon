-- Commerce hardening (ADR 0013): per-tenant Shopify credentials, durable
-- pending-order index and paid-event dedup, all scoped by merchant_id.

-- Per-tenant Shopify connection (admin token stored ciphered, never plaintext).
CREATE TABLE "merchant_commerce_connections" (
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'shopify',
    "shop_domain" TEXT NOT NULL,
    "admin_token_cipher" TEXT NOT NULL,
    "api_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_commerce_connections_pkey" PRIMARY KEY ("merchant_id")
);

ALTER TABLE "merchant_commerce_connections"
    ADD CONSTRAINT "merchant_commerce_connections_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Durable idempotent pending-order index: one pending order per (merchant, session).
CREATE TABLE "commerce_pending_orders" (
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "commerce_order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_pending_orders_pkey" PRIMARY KEY ("merchant_id", "session_id")
);

CREATE INDEX "commerce_pending_orders_merchant_id_status_updated_at_idx"
    ON "commerce_pending_orders"("merchant_id", "status", "updated_at");

ALTER TABLE "commerce_pending_orders"
    ADD CONSTRAINT "commerce_pending_orders_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Durable paid-event dedup: idempotency guard for markOrderPaid per payment ref.
CREATE TABLE "commerce_paid_events" (
    "merchant_id" TEXT NOT NULL,
    "payment_reference" TEXT NOT NULL,
    "commerce_order_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_paid_events_pkey" PRIMARY KEY ("merchant_id", "payment_reference")
);

CREATE INDEX "commerce_paid_events_merchant_id_created_at_idx"
    ON "commerce_paid_events"("merchant_id", "created_at");

ALTER TABLE "commerce_paid_events"
    ADD CONSTRAINT "commerce_paid_events_merchant_id_fkey"
    FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
