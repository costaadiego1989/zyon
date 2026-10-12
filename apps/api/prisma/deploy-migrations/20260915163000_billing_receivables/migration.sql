-- Financial journal for subscription charges observed in authenticated billing
-- provider events. Historical provider data is intentionally not backfilled by
-- this migration.
CREATE TABLE "billing_receivables" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "provider_subscription_id" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "amount_cents" INTEGER,
    "due_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "first_observed_at" TIMESTAMP(3) NOT NULL,
    "last_provider_event_id" TEXT NOT NULL,
    "last_provider_event_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_receivables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "billing_receivables_provider_provider_payment_id_key"
ON "billing_receivables"("provider", "provider_payment_id");

CREATE INDEX "billing_receivables_merchant_id_status_due_at_idx"
ON "billing_receivables"("merchant_id", "status", "due_at");

CREATE INDEX "billing_receivables_provider_status_due_at_idx"
ON "billing_receivables"("provider", "status", "due_at");

CREATE INDEX "billing_receivables_paid_at_idx"
ON "billing_receivables"("paid_at");

ALTER TABLE "billing_receivables"
ADD CONSTRAINT "billing_receivables_merchant_id_fkey"
FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
