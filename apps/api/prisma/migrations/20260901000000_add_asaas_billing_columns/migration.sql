-- Asaas billing columns on merchant_billing_subscriptions (additive, idempotent)
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "provider" TEXT DEFAULT 'asaas';
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "plan_key" TEXT;
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "asaas_customer_id" TEXT;
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "asaas_subscription_id" TEXT;
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_key" TEXT;
ALTER TABLE "merchant_billing_subscriptions" ADD COLUMN IF NOT EXISTS "pending_plan_effective_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "merchant_billing_subscriptions_asaas_subscription_id_idx" ON "merchant_billing_subscriptions"("asaas_subscription_id");
