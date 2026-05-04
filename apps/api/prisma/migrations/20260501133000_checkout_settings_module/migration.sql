CREATE TABLE "checkout_settings" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "widget_behavior" JSONB NOT NULL,
  "intervention_policy" JSONB NOT NULL,
  "trigger_rules" JSONB NOT NULL,
  "suppression_rules" JSONB NOT NULL,
  "handoff" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "checkout_settings_merchant_id_key" ON "checkout_settings"("merchant_id");
CREATE INDEX "checkout_settings_merchant_id_idx" ON "checkout_settings"("merchant_id");
