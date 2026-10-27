-- `payment_holds` exists in the production baseline. Evolve it in place
-- instead of using CREATE TABLE IF NOT EXISTS, which would skip the columns
-- and leave the later provider index invalid on an existing database.
ALTER TABLE "payment_holds"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS "provider_payment_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payout_destination" TEXT NOT NULL DEFAULT 'legacy_unroutable',
  ADD COLUMN IF NOT EXISTS "payout_reference" TEXT,
  ADD COLUMN IF NOT EXISTS "payout_provider_transfer_id" TEXT,
  ADD COLUMN IF NOT EXISTS "payout_attempted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "payout_confirmed_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failure_code" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Historical holds predate a provider destination snapshot. Do not let the
-- worker treat them as payable; they require an operations reconciliation.
UPDATE "payment_holds"
SET
  "status" = 'payout_failed',
  "failure_code" = COALESCE("failure_code", 'legacy_payment_hold_reconciliation_required')
WHERE "provider" = 'legacy_unknown'
  AND "status" <> 'released';

ALTER TABLE "payment_holds"
  ALTER COLUMN "provider" DROP DEFAULT,
  ALTER COLUMN "payout_destination" DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_holds_amounts_nonnegative_check'
      AND conrelid = 'payment_holds'::regclass
  ) THEN
    ALTER TABLE "payment_holds"
      ADD CONSTRAINT "payment_holds_amounts_nonnegative_check" CHECK (
        "total_amount_cents" >= 0
        AND "platform_fee_cents" >= 0
        AND "merchant_net_cents" >= 0
        AND "platform_fee_cents" + "merchant_net_cents" = "total_amount_cents"
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'payment_holds_release_requires_provider_confirmation_check'
      AND conrelid = 'payment_holds'::regclass
  ) THEN
    ALTER TABLE "payment_holds"
      ADD CONSTRAINT "payment_holds_release_requires_provider_confirmation_check" CHECK (
        "status" <> 'released'
        OR (
          "payout_provider_transfer_id" IS NOT NULL
          AND "payout_confirmed_at" IS NOT NULL
          AND "released_at" IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "payment_holds_merchant_id_status_idx"
  ON "payment_holds"("merchant_id", "status");
CREATE INDEX IF NOT EXISTS "payment_holds_status_hold_until_idx"
  ON "payment_holds"("status", "hold_until");
CREATE INDEX IF NOT EXISTS "payment_holds_provider_provider_payment_id_idx"
  ON "payment_holds"("provider", "provider_payment_id");
