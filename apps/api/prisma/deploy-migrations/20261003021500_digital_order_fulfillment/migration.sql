-- CreateTable
CREATE TABLE "digital_entitlements" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "download_url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "last_access_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digital_entitlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "entitlement_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "buyer_name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_id" TEXT,
    "reason" TEXT,
    "claimed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "digital_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "digital_entitlements_merchant_id_order_id_idx" ON "digital_entitlements"("merchant_id", "order_id");

-- CreateIndex
CREATE UNIQUE INDEX "digital_entitlements_id_merchant_id_key" ON "digital_entitlements"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "digital_entitlements_merchant_id_order_id_variant_id_key" ON "digital_entitlements"("merchant_id", "order_id", "variant_id");

-- CreateIndex
CREATE INDEX "digital_deliveries_merchant_id_status_idx" ON "digital_deliveries"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "digital_deliveries_merchant_id_entitlement_id_channel_key" ON "digital_deliveries"("merchant_id", "entitlement_id", "channel");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "completed_orders_id_merchant_id_key" ON "completed_orders"("id", "merchant_id");

-- AddForeignKey
ALTER TABLE "digital_entitlements" ADD CONSTRAINT "digital_entitlements_order_id_merchant_id_fkey" FOREIGN KEY ("order_id", "merchant_id") REFERENCES "completed_orders"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_entitlements" ADD CONSTRAINT "digital_entitlements_payment_intent_id_merchant_id_fkey" FOREIGN KEY ("payment_intent_id", "merchant_id") REFERENCES "payment_intents"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_deliveries" ADD CONSTRAINT "digital_deliveries_entitlement_id_merchant_id_fkey" FOREIGN KEY ("entitlement_id", "merchant_id") REFERENCES "digital_entitlements"("id", "merchant_id") ON DELETE CASCADE ON UPDATE CASCADE;
