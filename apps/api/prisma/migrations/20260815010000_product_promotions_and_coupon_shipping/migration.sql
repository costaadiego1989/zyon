-- Add shipping + scheduling fields to coupons
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "free_shipping_min_cart_total" DECIMAL(12,4);
ALTER TABLE "coupons" ADD COLUMN IF NOT EXISTS "min_per_buyer" INTEGER;
CREATE INDEX IF NOT EXISTS "coupons_ends_at_idx" ON "coupons"("ends_at");

-- CreateTable: product_promotions
CREATE TABLE IF NOT EXISTS "product_promotions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "category_id" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "promo_price_in_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX IF NOT EXISTS "product_promotions_merchant_active_ends_idx" ON "product_promotions"("merchant_id", "is_active", "ends_at");
CREATE INDEX IF NOT EXISTS "product_promotions_variant_active_idx" ON "product_promotions"("variant_id", "is_active");
CREATE INDEX IF NOT EXISTS "product_promotions_category_active_idx" ON "product_promotions"("category_id", "is_active");
