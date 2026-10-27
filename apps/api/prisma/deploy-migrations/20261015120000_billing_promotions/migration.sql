CREATE TABLE "billing_promotions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "discount_type" TEXT NOT NULL,
  "discount_value" INTEGER NOT NULL,
  "duration" TEXT NOT NULL,
  "duration_months" INTEGER,
  "plans" TEXT[] NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "max_redemptions" INTEGER,
  "first_time_only" BOOLEAN NOT NULL DEFAULT false,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "provisioned" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "deleted_at" TIMESTAMP(3),
  "stripe_coupon_id" TEXT,
  "stripe_promotion_code_id" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_promotions_discount_check" CHECK ("discount_type" IN ('percent', 'fixed') AND "discount_value" > 0),
  CONSTRAINT "billing_promotions_duration_check" CHECK ("duration" IN ('once', 'repeating', 'forever') AND ("duration" <> 'repeating' OR "duration_months" > 0)),
  CONSTRAINT "billing_promotions_dates_check" CHECK ("expires_at" > "starts_at")
);
CREATE UNIQUE INDEX "billing_promotions_code_key" ON "billing_promotions"("code");
CREATE UNIQUE INDEX "billing_promotions_stripe_coupon_id_key" ON "billing_promotions"("stripe_coupon_id");
CREATE UNIQUE INDEX "billing_promotions_stripe_promotion_code_id_key" ON "billing_promotions"("stripe_promotion_code_id");
CREATE INDEX "billing_promotions_enabled_starts_at_idx" ON "billing_promotions"("enabled", "starts_at");
CREATE INDEX "billing_promotions_created_at_id_idx" ON "billing_promotions"("created_at", "id");
