-- Allows only remediation of preexisting/imported, uncaptured Mercado Pago
-- snapshots. Public creation, capture, funding and payouts remain unsupported.
ALTER TABLE marketplace_funding_plans DROP CONSTRAINT IF EXISTS marketplace_funding_plans_provider_check;
ALTER TABLE marketplace_funding_plans ADD CONSTRAINT marketplace_funding_plans_provider_check
 CHECK (provider IN ('stripe','asaas','mercadopago'));
ALTER TABLE marketplace_funding_plans DROP CONSTRAINT IF EXISTS marketplace_funding_mercadopago_uncaptured;
ALTER TABLE marketplace_funding_plans ADD CONSTRAINT marketplace_funding_mercadopago_uncaptured CHECK (
 provider <> 'mercadopago' OR (status IN ('awaiting_capture','held') AND budget IS NULL AND funded_at IS NULL
 AND provider_fee_cents IS NULL AND net_amount_cents IS NULL AND platform_retained_cents IS NULL AND payout_total_cents IS NULL));

ALTER TABLE marketplace_cancellation_operations DROP CONSTRAINT IF EXISTS marketplace_cancellation_operation_valid;
ALTER TABLE marketplace_cancellation_operations ADD CONSTRAINT marketplace_cancellation_operation_valid CHECK (COALESCE((
 status IN ('planned','unknown','confirmed','blocked') AND version>=0 AND provider IN ('stripe','mercadopago')
 AND jsonb_typeof(request)='object' AND request_hash ~ '^[a-f0-9]{64}$'
 AND request->>'requestHash'=request_hash AND request->>'reference'=reference AND request->>'provider'=provider
 AND request->>'hostMerchantId'=host_merchant_id AND request->>'paymentIntentId'=funding_plan_id
 AND request->>'accountFingerprint'=account_fingerprint AND request->>'currency'='BRL'
 AND request->'version'='1'::jsonb AND request->>'environment' IN ('test','live')
 AND request->>'cancellationReason' IN ('requested_by_customer','abandoned','duplicate','fraudulent')
 AND jsonb_typeof(request->'amountCents')='number' AND (request->>'amountCents')::numeric>0
 AND (request->>'amountCents')::numeric<=2147483647 AND trunc((request->>'amountCents')::numeric)=(request->>'amountCents')::numeric
 AND (provider<>'mercadopago' OR (request->>'providerPaymentId' ~ '^[1-9][0-9]*$' AND length(request->>'checkoutSessionId')>0))
 AND (status NOT IN ('unknown','confirmed') OR claimed_at IS NOT NULL)
 AND (status<>'confirmed' OR confirmed_at IS NOT NULL) AND (status<>'blocked' OR block_reason IS NOT NULL)),false));
