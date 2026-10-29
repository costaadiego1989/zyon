-- CreateTable: storefront_carts (browsing-phase cart for agent)
CREATE TABLE IF NOT EXISTS "storefront_carts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "coupon_code" TEXT,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_carts_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "storefront_carts_merchant_id_session_id_key" ON "storefront_carts"("merchant_id", "session_id");
CREATE INDEX IF NOT EXISTS "storefront_carts_expires_at_idx" ON "storefront_carts"("expires_at");
