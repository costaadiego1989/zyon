-- Existing codes stay private until an administrator explicitly publishes them.
ALTER TABLE "billing_promotions" ADD COLUMN "auto_apply" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "billing_promotions_auto_apply_enabled_starts_at_idx"
  ON "billing_promotions"("auto_apply", "enabled", "starts_at");
