-- Preserve all existing operation receipts.
-- Asaas V2 is removal of an unpaid Pix/boleto, never terminal cancellation.
ALTER TABLE marketplace_cancellation_operations DROP CONSTRAINT IF EXISTS marketplace_cancellation_operation_valid;
ALTER TABLE marketplace_cancellation_operations ADD CONSTRAINT marketplace_cancellation_operation_valid CHECK (COALESCE((
 status IN ('planned','unknown','confirmed','blocked') AND version>=0 AND provider IN ('stripe','mercadopago','asaas')
 AND jsonb_typeof(request)='object' AND request_hash ~ '^[a-f0-9]{64}$'
 AND request->>'requestHash'=request_hash AND request->>'reference'=reference AND request->>'provider'=provider
 AND request->>'hostMerchantId'=host_merchant_id AND request->>'paymentIntentId'=funding_plan_id
 AND request->>'accountFingerprint'=account_fingerprint AND request->>'currency'='BRL'
 AND request->>'environment' IN ('test','live')
 AND request->>'cancellationReason' IN ('requested_by_customer','abandoned','duplicate','fraudulent')
 AND jsonb_typeof(request->'amountCents')='number' AND (request->>'amountCents')::numeric>0
 AND (request->>'amountCents')::numeric<=2147483647 AND trunc((request->>'amountCents')::numeric)=(request->>'amountCents')::numeric
 AND ((provider IN ('stripe','mercadopago') AND request->'version'='1'::jsonb)
   OR (provider='asaas' AND request->'version'='2'::jsonb AND status<>'confirmed' AND confirmed_at IS NULL
      AND request->>'providerPaymentId' ~ '^pay_[A-Za-z0-9_-]+$'
      AND request->>'asaasCustomerId' ~ '^cus_[A-Za-z0-9_-]+$'
      AND request->>'asaasBillingType' IN ('PIX','BOLETO') AND length(request->>'checkoutSessionId')>0))
 AND (provider<>'mercadopago' OR (request->>'providerPaymentId' ~ '^[1-9][0-9]*$' AND length(request->>'checkoutSessionId')>0))
 AND (status NOT IN ('unknown','confirmed') OR claimed_at IS NOT NULL)
 AND (status<>'confirmed' OR confirmed_at IS NOT NULL) AND (status<>'blocked' OR block_reason IS NOT NULL)),false));
-- Existing immutable operation trigger, claim marker and terminal transition
-- guard remain unchanged. No funding/payment/stock/return/debt mutation.
