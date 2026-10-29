-- Preserve historical rows while requiring every new hold to conserve PSP fees.
ALTER TABLE "payment_holds"
  DROP CONSTRAINT IF EXISTS "payment_holds_amounts_nonnegative_check";

ALTER TABLE "payment_holds"
  ADD CONSTRAINT "payment_holds_amounts_nonnegative_check" CHECK (
    "total_amount_cents" >= 0
    AND "platform_fee_cents" >= 0
    AND "provider_fee_cents" >= 0
    AND "merchant_net_cents" >= 0
    AND "platform_fee_cents" + "provider_fee_cents" + "merchant_net_cents" = "total_amount_cents"
  ) NOT VALID;
