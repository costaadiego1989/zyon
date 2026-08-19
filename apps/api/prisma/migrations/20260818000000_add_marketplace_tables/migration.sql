-- CreateTable marketplace_configs
CREATE TABLE "marketplace_configs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "commission_rate_bps" INTEGER NOT NULL DEFAULT 1500,
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "payout_delay_days" INTEGER NOT NULL DEFAULT 14,
    "chargeback_window_days" INTEGER NOT NULL DEFAULT 30,
    "allowed_categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_merchants" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_configs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "marketplace_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "marketplace_configs_merchant_id_key" ON "marketplace_configs"("merchant_id");

-- CreateTable federated_products
CREATE TABLE "federated_products" (
    "id" TEXT NOT NULL,
    "source_merchant_id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "stock_available" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "searchable_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federated_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable cross_store_line_items
CREATE TABLE "cross_store_line_items" (
    "id" TEXT NOT NULL,
    "checkout_session_id" TEXT NOT NULL,
    "order_id" TEXT,
    "host_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "federated_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "commission_rate_bps" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "seller_net_cents" INTEGER NOT NULL,
    "fulfillment_status" TEXT NOT NULL DEFAULT 'pending',
    "fulfillment_reference" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_store_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable marketplace_settlements
CREATE TABLE "marketplace_settlements" (
    "id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "total_amount_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "seller_net_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_return_window',
    "return_window_until" TIMESTAMPTZ NOT NULL,
    "transfer_scheduled_at" TIMESTAMPTZ,
    "chargeback_window_until" TIMESTAMPTZ NOT NULL,
    "transferred_at" TIMESTAMPTZ,
    "finalized_at" TIMESTAMPTZ,
    "chargeback_at" TIMESTAMPTZ,
    "return_at" TIMESTAMPTZ,
    "provider_transfer_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable marketplace_seller_debts
CREATE TABLE "marketplace_seller_debts" (
    "id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "deducted_from_settlement_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "marketplace_seller_debts_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX "federated_products_source_merchant_id_source_product_id_key" ON "federated_products"("source_merchant_id", "source_product_id");
CREATE INDEX "federated_products_category_idx" ON "federated_products"("category");
CREATE INDEX "federated_products_source_merchant_id_idx" ON "federated_products"("source_merchant_id");

CREATE INDEX "cross_store_line_items_host_merchant_id_idx" ON "cross_store_line_items"("host_merchant_id");
CREATE INDEX "cross_store_line_items_seller_merchant_id_idx" ON "cross_store_line_items"("seller_merchant_id");
CREATE INDEX "cross_store_line_items_order_id_idx" ON "cross_store_line_items"("order_id");

CREATE INDEX "marketplace_settlements_host_merchant_id_idx" ON "marketplace_settlements"("host_merchant_id");
CREATE INDEX "marketplace_settlements_seller_merchant_id_idx" ON "marketplace_settlements"("seller_merchant_id");
CREATE INDEX "marketplace_settlements_status_idx" ON "marketplace_settlements"("status");
CREATE INDEX "marketplace_settlements_transfer_scheduled_at_idx" ON "marketplace_settlements"("transfer_scheduled_at");

CREATE INDEX "marketplace_seller_debts_seller_merchant_id_idx" ON "marketplace_seller_debts"("seller_merchant_id");
CREATE INDEX "marketplace_seller_debts_status_idx" ON "marketplace_seller_debts"("status");
