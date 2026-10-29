CREATE TABLE "buyer_purchase_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "global_user_id" TEXT,
    "merchant_customer_id" TEXT,
    "currency" TEXT NOT NULL,
    "total_amount" DOUBLE PRECISION NOT NULL,
    "discount_amount" DOUBLE PRECISION NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_purchase_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "buyer_purchase_records_merchant_id_order_id_key" ON "buyer_purchase_records"("merchant_id", "order_id");
CREATE INDEX "buyer_purchase_records_merchant_id_global_user_id_idx" ON "buyer_purchase_records"("merchant_id", "global_user_id");
CREATE INDEX "buyer_purchase_records_merchant_id_merchant_customer_id_idx" ON "buyer_purchase_records"("merchant_id", "merchant_customer_id");
CREATE INDEX "buyer_purchase_records_merchant_id_completed_at_idx" ON "buyer_purchase_records"("merchant_id", "completed_at");
