CREATE TABLE IF NOT EXISTS marketplace_transfer_recoveries (
 id TEXT PRIMARY KEY,
 funding_plan_id TEXT NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT ON UPDATE CASCADE,
 host_merchant_id TEXT NOT NULL, beneficiary_merchant_id TEXT NOT NULL,
 payout_id TEXT REFERENCES marketplace_payouts(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 residual_operation_id TEXT REFERENCES marketplace_residual_operations(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 provider TEXT NOT NULL, account_fingerprint TEXT NOT NULL, provider_transfer_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL, evidence JSONB NOT NULL, evidence_hash TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT marketplace_transfer_recoveries_valid CHECK (
  (payout_id IS NULL) <> (residual_operation_id IS NULL) AND provider='stripe' AND amount_cents>0
  AND provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$' AND evidence_hash ~ '^[a-f0-9]{64}$'
  AND jsonb_typeof(evidence)='object')
);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_recoveries_payout_id_key ON marketplace_transfer_recoveries(payout_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_recoveries_residual_operation_id_key ON marketplace_transfer_recoveries(residual_operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_recoveries_receipt_key ON marketplace_transfer_recoveries(provider,account_fingerprint,provider_transfer_id);
CREATE INDEX IF NOT EXISTS marketplace_transfer_recoveries_beneficiary_merchant_id_idx ON marketplace_transfer_recoveries(beneficiary_merchant_id);
ALTER TABLE marketplace_seller_debts ADD COLUMN IF NOT EXISTS recovery_id TEXT;
ALTER TABLE marketplace_host_debts ADD COLUMN IF NOT EXISTS recovery_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_seller_debts_recovery_id_key ON marketplace_seller_debts(recovery_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_host_debts_recovery_id_key ON marketplace_host_debts(recovery_id);
ALTER TABLE marketplace_seller_debts DROP CONSTRAINT IF EXISTS marketplace_seller_debts_recovery_id_fkey;
ALTER TABLE marketplace_seller_debts ADD CONSTRAINT marketplace_seller_debts_recovery_id_fkey FOREIGN KEY(recovery_id) REFERENCES marketplace_transfer_recoveries(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE marketplace_host_debts DROP CONSTRAINT IF EXISTS marketplace_host_debts_recovery_id_fkey;
ALTER TABLE marketplace_host_debts ADD CONSTRAINT marketplace_host_debts_recovery_id_fkey FOREIGN KEY(recovery_id) REFERENCES marketplace_transfer_recoveries(id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Evidence consists of integral cents and stable identifiers. This matches the
-- recursively sorted, compact JSON used by fundingHash in the application.
CREATE OR REPLACE FUNCTION marketplace_recovery_canonical(v JSONB) RETURNS TEXT LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE result TEXT;
BEGIN
 CASE jsonb_typeof(v)
 WHEN 'object' THEN SELECT '{'||COALESCE(string_agg(to_jsonb(key)::text||':'||marketplace_recovery_canonical(value),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(v);
 WHEN 'array' THEN SELECT '['||COALESCE(string_agg(marketplace_recovery_canonical(value),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(v) WITH ORDINALITY a(value,ord);
 ELSE result := v::text;
 END CASE;
 RETURN result;
END $$;

CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
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
  OR t.beneficiary_merchant_id IS DISTINCT FROM NEW.beneficiary_merchant_id OR t.amount_cents IS DISTINCT FROM NEW.amount_cents OR t.status IS DISTINCT FROM 'confirmed'
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
  WHERE (NEW.payout_id IS NOT NULL AND x.payout_id=NEW.payout_id) OR (NEW.residual_operation_id IS NOT NULL AND x.residual_operation_id=NEW.residual_operation_id)
 LOOP
  IF v.funding_plan_id<>NEW.funding_plan_id OR v.refund_host<>NEW.host_merchant_id OR v.host_merchant_id<>NEW.host_merchant_id
   OR v.refund_status NOT IN ('blocked','prepared') OR (v.buyer_status IS NOT NULL AND v.buyer_status<>'planned')
   OR v.buyer_claimed IS NOT NULL OR v.buyer_receipt IS NOT NULL OR v.status<>'confirmed' OR v.claimed_at IS NULL OR v.reconciled_at IS NULL
   OR v.provider_operation_id IS NULL OR v.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$'
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
 IF n=0 OR total<>NEW.amount_cents THEN RAISE EXCEPTION 'marketplace_recovery_incomplete'; END IF;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans r LEFT JOIN marketplace_refund_operations u ON u.refund_plan_id=r.id
  WHERE r.funding_plan_id=NEW.funding_plan_id AND (r.status NOT IN ('blocked','prepared','confirmed')
   OR u.status IN ('unknown','pending','failed') OR r.status IN ('blocked','prepared') AND (u.claimed_at IS NOT NULL OR u.provider_operation_id IS NOT NULL))) THEN
  RAISE EXCEPTION 'marketplace_recovery_refund_consumption_uncertain';
 END IF;
 SELECT jsonb_agg(jsonb_build_object('reversalId',proof_row.id,'refundPlanId',proof_row.refund_plan_id,'requestHash',proof_row.request_hash,
   'providerOperationId',proof_row.provider_operation_id,'amountCents',proof_row.amount_cents) ORDER BY proof_row.id COLLATE "C") INTO expected_reversals
 FROM marketplace_transfer_reversals proof_row WHERE (NEW.payout_id IS NOT NULL AND proof_row.payout_id=NEW.payout_id)
   OR (NEW.residual_operation_id IS NOT NULL AND proof_row.residual_operation_id=NEW.residual_operation_id);
 IF NEW.evidence->'version' IS DISTINCT FROM '1'::jsonb OR NEW.evidence->>'reason' IS DISTINCT FROM 'chargeback_transfer_principal_recovered'
  OR NEW.evidence->>'fundingPlanId' IS DISTINCT FROM NEW.funding_plan_id OR NEW.evidence->>'hostMerchantId' IS DISTINCT FROM NEW.host_merchant_id
  OR NEW.evidence->>'instructionsHash' IS DISTINCT FROM f.instructions_hash OR NEW.evidence->'target' IS DISTINCT FROM expected_target
  OR NEW.evidence->'reversals' IS DISTINCT FROM expected_reversals OR ((NEW.evidence->>'chargebackAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at
  OR NEW.evidence->>'budgetHash' IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex')
  OR NEW.evidence_hash<>encode(sha256(convert_to(marketplace_recovery_canonical(NEW.evidence),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'marketplace_recovery_evidence_invalid';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_transfer_recovery_insert_valid_trigger ON marketplace_transfer_recoveries;
CREATE TRIGGER marketplace_transfer_recovery_insert_valid_trigger BEFORE INSERT ON marketplace_transfer_recoveries FOR EACH ROW EXECUTE FUNCTION marketplace_transfer_recovery_insert_valid();
CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'marketplace_transfer_recovery_immutable'; END $$;
DROP TRIGGER IF EXISTS marketplace_transfer_recovery_immutable_trigger ON marketplace_transfer_recoveries;
CREATE TRIGGER marketplace_transfer_recovery_immutable_trigger BEFORE UPDATE OR DELETE ON marketplace_transfer_recoveries FOR EACH ROW EXECUTE FUNCTION marketplace_transfer_recovery_immutable();

CREATE OR REPLACE FUNCTION marketplace_debt_recovery_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; target_payout TEXT; beneficiary TEXT; old_json JSONB; new_json JSONB;
BEGIN
 IF NEW.status NOT IN ('outstanding','resolved','deducted') OR NEW.amount_cents<=0 THEN RAISE EXCEPTION 'marketplace_debt_evidence_required'; END IF;
 IF TG_OP='UPDATE' THEN
  old_json:=to_jsonb(OLD); new_json:=to_jsonb(NEW);
  IF (old_json-ARRAY['status','resolved_at','recovery_id']) IS DISTINCT FROM (new_json-ARRAY['status','resolved_at','recovery_id']) THEN RAISE EXCEPTION 'marketplace_debt_binding_immutable'; END IF;
  IF OLD.status IN ('resolved','deducted') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_debt_resolution_terminal'; END IF;
 ELSE
  IF NEW.status<>'outstanding' OR NEW.recovery_id IS NOT NULL OR NEW.resolved_at IS NOT NULL THEN RAISE EXCEPTION 'marketplace_debt_evidence_required'; END IF;
 END IF;
 IF NEW.status='deducted' AND (TG_OP='INSERT' OR OLD.status<>'deducted') THEN RAISE EXCEPTION 'marketplace_debt_netting_evidence_required'; END IF;
 IF NEW.status='resolved' AND (TG_OP='INSERT' OR OLD.status<>'resolved') THEN
  SELECT * INTO c FROM marketplace_transfer_recoveries WHERE id=NEW.recovery_id;
  IF NOT FOUND OR NEW.resolved_at IS NULL OR c.payout_id IS NULL OR c.amount_cents<>NEW.amount_cents THEN RAISE EXCEPTION 'marketplace_debt_evidence_required'; END IF;
  IF TG_TABLE_NAME='marketplace_seller_debts' THEN
   SELECT id INTO target_payout FROM marketplace_payouts WHERE settlement_id=NEW.settlement_id AND kind='seller_settlement' AND beneficiary_merchant_id=NEW.seller_merchant_id;
   beneficiary:=NEW.seller_merchant_id;
  ELSE
   SELECT id INTO target_payout FROM marketplace_payouts WHERE id=NEW.payout_id AND kind='host_receivable' AND beneficiary_merchant_id=NEW.host_merchant_id;
   beneficiary:=NEW.host_merchant_id;
  END IF;
  IF target_payout IS DISTINCT FROM c.payout_id OR beneficiary<>c.beneficiary_merchant_id THEN RAISE EXCEPTION 'marketplace_debt_recovery_binding_invalid'; END IF;
 ELSIF NEW.status='outstanding' AND (NEW.recovery_id IS NOT NULL OR NEW.resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_debt_evidence_required';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_seller_debt_recovery_valid_trigger ON marketplace_seller_debts;
CREATE TRIGGER marketplace_seller_debt_recovery_valid_trigger BEFORE INSERT OR UPDATE ON marketplace_seller_debts FOR EACH ROW EXECUTE FUNCTION marketplace_debt_recovery_valid();
DROP TRIGGER IF EXISTS marketplace_host_debt_recovery_valid_trigger ON marketplace_host_debts;
CREATE TRIGGER marketplace_host_debt_recovery_valid_trigger BEFORE INSERT OR UPDATE ON marketplace_host_debts FOR EACH ROW EXECUTE FUNCTION marketplace_debt_recovery_valid();

-- Recovery money is reserved to the dispute. Even a later local status reset
-- cannot admit a refund POST spending the same provider receipts a second time.
CREATE OR REPLACE FUNCTION marketplace_refund_recovered_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD;
BEGIN
 SELECT x.host_merchant_id,x.provider_payment_id INTO f FROM marketplace_funding_plans x
 JOIN marketplace_refund_plans r ON r.funding_plan_id=x.payment_intent_id WHERE r.id=NEW.refund_plan_id;
 IF FOUND AND f.provider_payment_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 END IF;
 IF (NEW.status<>'planned' OR NEW.claimed_at IS NOT NULL OR NEW.provider_operation_id IS NOT NULL)
 AND EXISTS(SELECT 1 FROM marketplace_refund_plans r JOIN marketplace_transfer_recoveries c ON c.funding_plan_id=r.funding_plan_id WHERE r.id=NEW.refund_plan_id) THEN
  RAISE EXCEPTION 'marketplace_refund_money_reserved_for_dispute';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_refund_recovered_money_guard_trigger ON marketplace_refund_operations;
CREATE TRIGGER marketplace_refund_recovered_money_guard_trigger BEFORE INSERT OR UPDATE ON marketplace_refund_operations FOR EACH ROW EXECUTE FUNCTION marketplace_refund_recovered_money_guard();

