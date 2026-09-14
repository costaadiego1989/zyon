ALTER TABLE "merchant_billing_subscriptions"
  ADD COLUMN "pending_upgrade_plan_key" TEXT,
  ADD COLUMN "pending_upgrade_amount_cents" INTEGER,
  ADD COLUMN "pending_upgrade_requested_at" TIMESTAMP(3),
  ADD COLUMN "billing_amount_cents" INTEGER,
  ADD COLUMN "last_billing_event_at" TIMESTAMP(3),
  ADD COLUMN "last_billing_payment_id" TEXT,
  ADD COLUMN "last_billing_payment_due_at" TIMESTAMP(3);

CREATE TABLE "billing_webhook_events" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "subscription_id" TEXT NOT NULL,
  "payment_id" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "outcome" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "billing_webhook_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "billing_webhook_events_provider_event_id_key" ON "billing_webhook_events"("provider", "event_id");
CREATE INDEX "billing_webhook_events_merchant_id_occurred_at_idx" ON "billing_webhook_events"("merchant_id", "occurred_at");
ALTER TABLE "billing_webhook_events" ADD CONSTRAINT "billing_webhook_events_merchant_id_fkey"
  FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
