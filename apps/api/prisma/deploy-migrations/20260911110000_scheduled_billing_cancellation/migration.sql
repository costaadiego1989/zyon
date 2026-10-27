-- Persists provider-side scheduling so scheduled subscription cancellation can
-- be resumed safely after an API restart without repeatedly suspending it.
ALTER TABLE "merchant_billing_subscriptions"
  ADD COLUMN IF NOT EXISTS "provider_cancellation_scheduled_at" TIMESTAMP(3);
