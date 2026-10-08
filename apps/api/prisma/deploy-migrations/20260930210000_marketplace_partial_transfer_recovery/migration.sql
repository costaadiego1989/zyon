CREATE TABLE IF NOT EXISTS marketplace_transfer_recovery_credits (
 id TEXT PRIMARY KEY,
 funding_plan_id TEXT NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 reversal_id TEXT NOT NULL REFERENCES marketplace_transfer_reversals(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 host_merchant_id TEXT NOT NULL, beneficiary_merchant_id TEXT NOT NULL,
 payout_id TEXT REFERENCES marketplace_payouts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 residual_operation_id TEXT REFERENCES marketplace_residual_operations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 provider TEXT NOT NULL, account_fingerprint TEXT NOT NULL, provider_transfer_id TEXT NOT NULL, provider_operation_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, evidence JSONB NOT NULL, evidence_hash TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT marketplace_transfer_recovery_credits_valid CHECK (
  (payout_id IS NULL) <> (residual_operation_id IS NULL) AND provider='stripe' AND amount_cents>0
  AND provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$' AND provider_operation_id ~ '^trr_[A-Za-z0-9_]+$'
  AND evidence_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(evidence)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_reversal_id_key ON marketplace_transfer_recovery_credits(reversal_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_receipt_key ON marketplace_transfer_recovery_credits(provider,account_fingerprint,provider_operation_id);
CREATE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_funding_plan_id_idx ON marketplace_transfer_recovery_credits(funding_plan_id);
CREATE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_payout_id_idx ON marketplace_transfer_recovery_credits(payout_id);
CREATE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_residual_operation_id_idx ON marketplace_transfer_recovery_credits(residual_operation_id);
CREATE INDEX IF NOT EXISTS marketplace_transfer_recovery_credits_beneficiary_merchant_id_idx ON marketplace_transfer_recovery_credits(beneficiary_merchant_id);

CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_credit_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; v RECORD; expected_target JSONB; expected_reversals JSONB; total BIGINT := 0; n INTEGER := 0;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_recovery_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT x.*,l.chargeback_at,p.merchant_id AS payment_merchant_id,p.provider_payment_id AS payment_provider_id INTO f
 FROM marketplace_funding_plans x JOIN payment_intents p ON p.id=x.payment_intent_id
 JOIN marketplace_order_ledgers l ON l.host_merchant_id=x.host_merchant_id AND l.order_id=x.provider_payment_id
 WHERE x.payment_intent_id=NEW.funding_plan_id;
 IF NOT FOUND OR f.status<>'held' OR f.provider<>'stripe' OR f.budget IS NULL OR f.chargeback_at IS NULL
  OR f.host_merchant_id<>NEW.host_merchant_id OR f.payment_merchant_id<>NEW.host_merchant_id
  OR f.payment_provider_id IS DISTINCT FROM f.provider_payment_id OR f.account_fingerprint<>NEW.account_fingerprint THEN
  RAISE EXCEPTION 'marketplace_recovery_funding_unproven';
 END IF;
 IF NEW.payout_id IS NOT NULL THEN
  SELECT p.id,p.funding_plan_id,p.provider,p.account_fingerprint,p.provider_payment_id,p.provider_transfer_id,p.beneficiary_merchant_id,
   p.reference,p.destination,p.amount_cents,p.status,p.claimed_at,p.reconciled_at,NULL::text AS request_hash INTO t
  FROM marketplace_payouts p WHERE p.id=NEW.payout_id;
 ELSE
  SELECT o.id,r.funding_plan_id,o.provider,o.account_fingerprint,f.provider_payment_id AS provider_payment_id,o.provider_transfer_id,o.beneficiary_merchant_id,
   o.reference,o.request->>'destination' AS destination,o.amount_cents,o.status,o.claimed_at,o.reconciled_at,o.request_hash INTO t
  FROM marketplace_residual_operations o JOIN marketplace_residual_plans r ON r.id=o.residual_plan_id
  WHERE o.id=NEW.residual_operation_id AND r.status='held' AND r.held_reason='marketplace_residual_dispute_requires_reconciliation';
 END IF;
 IF NOT FOUND OR t.funding_plan_id IS DISTINCT FROM NEW.funding_plan_id OR t.provider IS DISTINCT FROM NEW.provider OR t.account_fingerprint IS DISTINCT FROM NEW.account_fingerprint
  OR t.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR t.provider_transfer_id IS DISTINCT FROM NEW.provider_transfer_id
  OR t.beneficiary_merchant_id IS DISTINCT FROM NEW.beneficiary_merchant_id OR (NEW.amount_cents <= 0 OR NEW.amount_cents > t.amount_cents) OR t.status IS DISTINCT FROM 'confirmed'
  OR t.claimed_at IS NULL OR t.reconciled_at IS NULL THEN RAISE EXCEPTION 'marketplace_recovery_transfer_unproven'; END IF;
 expected_target := jsonb_build_object('kind',CASE WHEN NEW.payout_id IS NULL THEN 'residual' ELSE 'original' END,
  'id',t.id,'beneficiaryMerchantId',t.beneficiary_merchant_id,'provider',t.provider,'accountFingerprint',t.account_fingerprint,
  'providerPaymentId',t.provider_payment_id,'providerTransferId',t.provider_transfer_id,'reference',t.reference,
  'destination',t.destination,'amountCents',t.amount_cents);
 IF t.request_hash IS NOT NULL THEN expected_target:=expected_target||jsonb_build_object('requestHash',t.request_hash); END IF;
 FOR v IN SELECT x.*,r.funding_plan_id,r.host_merchant_id AS refund_host,r.status AS refund_status,
   u.status AS buyer_status,u.claimed_at AS buyer_claimed,u.provider_operation_id AS buyer_receipt
  FROM marketplace_transfer_reversals x JOIN marketplace_refund_plans r ON r.id=x.refund_plan_id
  LEFT JOIN marketplace_refund_operations u ON u.refund_plan_id=r.id
  WHERE x.id=NEW.reversal_id AND ((NEW.payout_id IS NOT NULL AND x.payout_id=NEW.payout_id) OR (NEW.residual_operation_id IS NOT NULL AND x.residual_operation_id=NEW.residual_operation_id))
 LOOP
  IF v.funding_plan_id<>NEW.funding_plan_id OR v.refund_host<>NEW.host_merchant_id OR v.host_merchant_id<>NEW.host_merchant_id
   OR v.refund_status NOT IN ('blocked','prepared') OR (v.buyer_status IS NOT NULL AND v.buyer_status<>'planned')
   OR v.buyer_claimed IS NOT NULL OR v.buyer_receipt IS NOT NULL OR v.status<>'confirmed' OR v.claimed_at IS NULL OR v.reconciled_at IS NULL
   OR v.provider_operation_id IS DISTINCT FROM NEW.provider_operation_id OR v.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$'
   OR v.provider<>NEW.provider OR v.account_fingerprint<>NEW.account_fingerprint OR v.request->>'kind' IS DISTINCT FROM 'transfer_reversal'
   OR v.request->>'requestHash' IS DISTINCT FROM v.request_hash OR v.request->'amountCents' IS DISTINCT FROM to_jsonb(v.amount_cents)
   OR v.request->>'provider' IS DISTINCT FROM v.provider OR v.request->>'accountFingerprint' IS DISTINCT FROM v.account_fingerprint
   OR v.request->>'reference' IS DISTINCT FROM v.reference OR v.request->'paymentAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR v.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id OR v.request->>'sourceId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}'
   OR v.request->>'environment' IS DISTINCT FROM f.environment OR v.request->>'currency' IS DISTINCT FROM 'BRL'
   OR v.request#>>'{transfer,providerTransferId}' IS DISTINCT FROM t.provider_transfer_id
   OR v.request#>>'{transfer,destination}' IS DISTINCT FROM t.destination OR v.request#>>'{transfer,reference}' IS DISTINCT FROM t.reference
   OR v.request#>'{transfer,amountCents}' IS DISTINCT FROM to_jsonb(t.amount_cents)
   OR (NEW.residual_operation_id IS NOT NULL AND (v.request#>>'{transfer,kind}' IS DISTINCT FROM 'residual' OR v.request#>>'{transfer,requestHash}' IS DISTINCT FROM t.request_hash))
   OR (NEW.payout_id IS NOT NULL AND (v.request->'transfer' ? 'kind' OR v.request->'transfer' ? 'requestHash'))
   OR encode(sha256(convert_to(marketplace_recovery_canonical(v.request-'requestHash'),'UTF8')),'hex')<>v.request_hash THEN
   RAISE EXCEPTION 'marketplace_recovery_reversal_unproven';
  END IF;
  total:=total+v.amount_cents; n:=n+1;
 END LOOP;
 IF n<>1 OR total<>NEW.amount_cents THEN RAISE EXCEPTION 'marketplace_recovery_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans r LEFT JOIN marketplace_refund_operations u ON u.refund_plan_id=r.id
  WHERE r.funding_plan_id=NEW.funding_plan_id AND (r.status NOT IN ('blocked','prepared','confirmed')
   OR u.status IN ('unknown','pending','failed') OR r.status IN ('blocked','prepared') AND (u.claimed_at IS NOT NULL OR u.provider_operation_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'marketplace_recovery_refund_consumption_uncertain';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('reversalId',proof_row.id,'refundPlanId',proof_row.refund_plan_id,'requestHash',proof_row.request_hash,
   'providerOperationId',proof_row.provider_operation_id,'amountCents',proof_row.amount_cents) ORDER BY proof_row.id COLLATE "C") INTO expected_reversals
 FROM marketplace_transfer_reversals proof_row WHERE proof_row.id=NEW.reversal_id;
 IF NEW.evidence->'version' IS DISTINCT FROM '1'::jsonb OR NEW.evidence->>'reason' IS DISTINCT FROM 'chargeback_transfer_principal_credit'
  OR NEW.evidence->>'fundingPlanId' IS DISTINCT FROM NEW.funding_plan_id OR NEW.evidence->>'hostMerchantId' IS DISTINCT FROM NEW.host_merchant_id
  OR NEW.evidence->>'instructionsHash' IS DISTINCT FROM f.instructions_hash OR NEW.evidence->'target' IS DISTINCT FROM expected_target
  OR NEW.evidence->'reversals' IS DISTINCT FROM expected_reversals OR ((NEW.evidence->>'chargebackAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at
  OR NEW.evidence->>'budgetHash' IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex')
  OR NEW.evidence_hash<>encode(sha256(convert_to(marketplace_recovery_canonical(NEW.evidence),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'marketplace_recovery_evidence_invalid';
 END IF;
 -- Preserve conservation across consumed history and credits, without crediting a buyer refund.
 IF (SELECT COALESCE(sum(x.amount_cents),0) FROM marketplace_transfer_reversals x
  WHERE x.status='confirmed' AND ((NEW.payout_id IS NOT NULL AND x.payout_id=NEW.payout_id)
   OR (NEW.residual_operation_id IS NOT NULL AND x.residual_operation_id=NEW.residual_operation_id))) > t.amount_cents
 OR NEW.amount_cents + (SELECT COALESCE(sum(c.amount_cents),0) FROM marketplace_transfer_recovery_credits c
  WHERE (NEW.payout_id IS NOT NULL AND c.payout_id=NEW.payout_id)
   OR (NEW.residual_operation_id IS NOT NULL AND c.residual_operation_id=NEW.residual_operation_id)) > t.amount_cents THEN
  RAISE EXCEPTION 'marketplace_recovery_credit_exceeds_principal';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_transfer_recovery_credit_insert_valid_trigger ON marketplace_transfer_recovery_credits;
CREATE TRIGGER marketplace_transfer_recovery_credit_insert_valid_trigger BEFORE INSERT ON marketplace_transfer_recovery_credits FOR EACH ROW EXECUTE FUNCTION marketplace_transfer_recovery_credit_insert_valid();
DROP TRIGGER IF EXISTS marketplace_transfer_recovery_credit_immutable_trigger ON marketplace_transfer_recovery_credits;
CREATE TRIGGER marketplace_transfer_recovery_credit_immutable_trigger BEFORE UPDATE OR DELETE ON marketplace_transfer_recovery_credits FOR EACH ROW EXECUTE FUNCTION marketplace_transfer_recovery_immutable();

CREATE OR REPLACE FUNCTION marketplace_refund_recovered_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD;
BEGIN
 SELECT x.host_merchant_id,x.provider_payment_id INTO f FROM marketplace_funding_plans x
 JOIN marketplace_refund_plans r ON r.funding_plan_id=x.payment_intent_id WHERE r.id=NEW.refund_plan_id;
 IF FOUND AND f.provider_payment_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 END IF;
 IF (NEW.status<>'planned' OR NEW.claimed_at IS NOT NULL OR NEW.provider_operation_id IS NOT NULL)
 AND (EXISTS(SELECT 1 FROM marketplace_refund_plans r JOIN marketplace_transfer_recoveries c ON c.funding_plan_id=r.funding_plan_id WHERE r.id=NEW.refund_plan_id)
  OR EXISTS(SELECT 1 FROM marketplace_refund_plans r JOIN marketplace_transfer_recovery_credits c ON c.funding_plan_id=r.funding_plan_id WHERE r.id=NEW.refund_plan_id)) THEN
  RAISE EXCEPTION 'marketplace_refund_money_reserved_for_dispute';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_refund_recovered_money_guard_trigger ON marketplace_refund_operations;
CREATE TRIGGER marketplace_refund_recovered_money_guard_trigger BEFORE INSERT OR UPDATE ON marketplace_refund_operations FOR EACH ROW EXECUTE FUNCTION marketplace_refund_recovered_money_guard();
