CREATE TABLE "billing_admin_notices" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "provider" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "invoice_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "plan_key" TEXT NOT NULL,
  "billing_cycle" TEXT NOT NULL,
  "amount_paid_cents" INTEGER NOT NULL,
  "discount_cents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_until" TIMESTAMP(3),
  "claim_token" TEXT,
  "provider_message_id" TEXT,
  "last_error_code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "billing_admin_notices_amount_check" CHECK ("amount_paid_cents" >= 0 AND "discount_cents" >= 0)
);
CREATE UNIQUE INDEX "billing_admin_notices_provider_subscription_id_key" ON "billing_admin_notices"("provider", "subscription_id");
CREATE INDEX "billing_admin_notices_status_next_attempt_at_idx" ON "billing_admin_notices"("status", "next_attempt_at");
