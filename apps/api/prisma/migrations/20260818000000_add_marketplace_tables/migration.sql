-- CreateTable marketplace_configs
CREATE TABLE "marketplace_configs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "merchant_id" TEXT NOT NULL UNIQUE,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "commission_rate_bps" INTEGER NOT NULL DEFAULT 1500,
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "payout_delay_days" INTEGER NOT NULL DEFAULT 14,
    "chargeback_window_days" INTEGER NOT NULL DEFAULT 30,
    "allowed_categories" TEXT NOT NULL DEFAULT '',
    "blocked_merchants" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketplace_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable federated_products
CREATE TABLE "federated_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable cross_store_line_items
CREATE TABLE "cross_store_line_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable marketplace_settlements
CREATE TABLE "marketplace_settlements" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "host_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "total_amount_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "seller_net_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_return_window',
    "return_window_until" DATETIME NOT NULL,
    "transfer_scheduled_at" DATETIME,
    "chargeback_window_until" DATETIME NOT NULL,
    "transferred_at" DATETIME,
    "finalized_at" DATETIME,
    "chargeback_at" DATETIME,
    "return_at" DATETIME,
    "provider_transfer_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable marketplace_seller_debts
CREATE TABLE "marketplace_seller_debts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seller_merchant_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "deducted_from_settlement_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "federated_products_source_merchant_id_source_product_id_key" ON "federated_products"("source_merchant_id", "source_product_id");

-- CreateIndex
CREATE INDEX "federated_products_category_idx" ON "federated_products"("category");

-- CreateIndex
CREATE INDEX "federated_products_source_merchant_id_idx" ON "federated_products"("source_merchant_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_host_merchant_id_idx" ON "cross_store_line_items"("host_merchant_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_seller_merchant_id_idx" ON "cross_store_line_items"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_order_id_idx" ON "cross_store_line_items"("order_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_host_merchant_id_idx" ON "marketplace_settlements"("host_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_seller_merchant_id_idx" ON "marketplace_settlements"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_status_idx" ON "marketplace_settlements"("status");

-- CreateIndex
CREATE INDEX "marketplace_settlements_transfer_scheduled_at_idx" ON "marketplace_settlements"("transfer_scheduled_at");

-- CreateIndex
CREATE INDEX "marketplace_seller_debts_seller_merchant_id_idx" ON "marketplace_seller_debts"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_seller_debts_status_idx" ON "marketplace_seller_debts"("status");
