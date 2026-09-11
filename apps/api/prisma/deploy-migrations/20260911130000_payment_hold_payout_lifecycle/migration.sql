-- A delayed merchant payout is only financially released after the provider
-- confirms its transfer. This table is the operational state machine for
-- payout work and refund/chargeback blocking; the settlement ledger remains
-- append-only.
CREATE TABLE IF NOT EXISTS "payment_holds" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "payment_intent_id" TEXT NOT NULL,
  "order_id" TEXT,
  "provider" TEXT NOT NULL,
  "provider_payment_id" TEXT,
  "payout_destination" TEXT NOT NULL,
  "total_amount_cents" INTEGER NOT NULL,
  "platform_fee_cents" INTEGER NOT NULL,
  "merchant_net_cents" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'held',
  "hold_until" TIMESTAMP(3) NOT NULL,
  "payout_reference" TEXT,
  "payout_provider_transfer_id" TEXT,
  "payout_attempted_at" TIMESTAMP(3),
  "payout_confirmed_at" TIMESTAMP(3),
  "failure_code" TEXT,
  "released_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_holds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_holds_payment_intent_id_key" UNIQUE ("payment_intent_id"),
  CONSTRAINT "payment_holds_amounts_nonnegative_check" CHECK (
    "total_amount_cents" >= 0
    AND "platform_fee_cents" >= 0
    AND "merchant_net_cents" >= 0
    AND "platform_fee_cents" + "merchant_net_cents" = "total_amount_cents"
  ),
  CONSTRAINT "payment_holds_release_requires_provider_confirmation_check" CHECK (
    "status" <> 'released'
    OR (
      "payout_provider_transfer_id" IS NOT NULL
      AND "payout_confirmed_at" IS NOT NULL
      AND "released_at" IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS "payment_holds_merchant_id_status_idx"
  ON "payment_holds"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "payment_holds_status_hold_until_idx"
  ON "payment_holds"("status", "hold_until");
CREATE INDEX IF NOT EXISTS "payment_holds_provider_provider_payment_id_idx"
  ON "payment_holds"("provider", "provider_payment_id");
