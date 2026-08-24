-- AlterTable
CREATE TABLE "marketplace_connections" (
    "id" TEXT NOT NULL,
    "buyer_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_connections_buyer_merchant_id_seller_merchant_id_key" ON "marketplace_connections"("buyer_merchant_id", "seller_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_connections_buyer_merchant_id_status_idx" ON "marketplace_connections"("buyer_merchant_id", "status");
