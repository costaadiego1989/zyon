CREATE TABLE "inventory_sale_receipts" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "order_id" TEXT NOT NULL,
  "payload_hash" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "inventory_sale_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inventory_sale_receipts_merchant_id_order_id_key" ON "inventory_sale_receipts"("merchant_id", "order_id");
CREATE INDEX "inventory_sale_receipts_merchant_id_created_at_idx" ON "inventory_sale_receipts"("merchant_id", "created_at");
