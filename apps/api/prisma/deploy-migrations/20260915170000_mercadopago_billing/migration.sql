-- Link a Zyon SaaS subscription to its Mercado Pago preapproval. This is
-- additive and does not backfill historic Mercado Pago merchant payments.
ALTER TABLE "merchant_billing_subscriptions"
  ADD COLUMN "mercadopago_preapproval_id" TEXT;

CREATE UNIQUE INDEX "merchant_billing_subscriptions_mercadopago_preapproval_id_key"
  ON "merchant_billing_subscriptions"("mercadopago_preapproval_id");
