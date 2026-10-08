CREATE TABLE "marketplace_payouts" (
  "settlement_id" TEXT PRIMARY KEY REFERENCES "marketplace_settlements"("id") ON DELETE RESTRICT,
  "provider" TEXT NOT NULL,
  "account_fingerprint" TEXT NOT NULL,
  "provider_payment_id" TEXT NOT NULL,
  "destination" TEXT NOT NULL,
  "amount_cents" INTEGER NOT NULL CHECK ("amount_cents" > 0),
  "currency" TEXT NOT NULL CHECK ("currency" = 'BRL'),
  "reference" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'planned',
  "version" INTEGER NOT NULL DEFAULT 0,
  "provider_transfer_id" TEXT,
  "claimed_at" TIMESTAMP(3),
  "reconciled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "marketplace_payouts_receipt_key"
  ON "marketplace_payouts"("provider", "account_fingerprint", "provider_transfer_id");
CREATE INDEX "marketplace_payouts_status_updated_at_idx" ON "marketplace_payouts"("status", "updated_at");
