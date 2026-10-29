ALTER TABLE "checkout_sessions"
  ADD COLUMN IF NOT EXISTS "shipping_options" JSONB;

ALTER TABLE "completed_orders"
  ADD COLUMN IF NOT EXISTS "tracking_code" TEXT;

ALTER TABLE "payment_intents"
  ADD COLUMN IF NOT EXISTS "status_history" JSONB NOT NULL DEFAULT '[]'::jsonb;
