ALTER TABLE "payment_holds"
  ADD COLUMN "provider_fee_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "capture_evidence" JSONB,
  ADD COLUMN "hold_days" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN "hold_anchor" TEXT NOT NULL DEFAULT 'payment',
  ADD COLUMN "fulfilled_at" TIMESTAMP(3),
  ALTER COLUMN "hold_until" DROP NOT NULL;

ALTER TABLE "payment_holds" ADD CONSTRAINT "payment_hold_fulfillment_window"
  CHECK ("hold_anchor" <> 'fulfillment' OR (
    "hold_days" = 7 AND "capture_evidence" IS NOT NULL
    AND "total_amount_cents" = "platform_fee_cents" + "provider_fee_cents" + "merchant_net_cents"
    AND (("fulfilled_at" IS NULL AND "hold_until" IS NULL)
      OR ("fulfilled_at" IS NOT NULL AND "hold_until" = "fulfilled_at" + INTERVAL '7 days'))
  ));
