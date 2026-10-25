-- Add nullable metadata column to checkout_events for device/payment_method tracking
ALTER TABLE "checkout_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB;
