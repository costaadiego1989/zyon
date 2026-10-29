ALTER TABLE "merchant_billing_subscriptions"
  ADD COLUMN "billing_cycle" TEXT NOT NULL DEFAULT 'monthly',
  ADD COLUMN "billing_discount_percent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pending_billing_cycle" TEXT,
  ADD COLUMN "pending_billing_amount_cents" INTEGER,
  ADD COLUMN "pending_billing_discount_percent" INTEGER;
