-- Product-level promotions + coupon-link (product-promotion-rules feature).
-- Extends product_promotions so a promotion can target a whole product (product_id)
-- and/or link an existing coupon (coupon_id) instead of an inline discount.
-- Inline discount columns become nullable because a coupon-linked promotion carries
-- no inline discount (inline XOR coupon invariant, enforced in the domain entity).
-- Idempotent: safe for environments already provisioned via `prisma db push`.

ALTER TABLE "product_promotions" ADD COLUMN IF NOT EXISTS "product_id" TEXT;
ALTER TABLE "product_promotions" ADD COLUMN IF NOT EXISTS "coupon_id" TEXT;

ALTER TABLE "product_promotions" ALTER COLUMN "discount_type" DROP NOT NULL;
ALTER TABLE "product_promotions" ALTER COLUMN "discount_value" DROP NOT NULL;

CREATE INDEX IF NOT EXISTS "product_promotions_merchant_id_product_id_is_active_idx"
  ON "product_promotions"("merchant_id", "product_id", "is_active");
