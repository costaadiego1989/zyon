ALTER TABLE marketplace_transfer_recovery_credits ALTER COLUMN reversal_id DROP NOT NULL;
ALTER TABLE marketplace_transfer_recovery_credits DROP CONSTRAINT IF EXISTS marketplace_native_credit_version;
ALTER TABLE marketplace_transfer_recovery_credits ADD CONSTRAINT marketplace_native_credit_version CHECK (
 (evidence->'version'='1'::jsonb AND reversal_id IS NOT NULL) OR
 (evidence->'version'='2'::jsonb AND reversal_id IS NULL AND payout_id IS NOT NULL AND residual_operation_id IS NULL));
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_native_recovery_balance_receipt_key
 ON marketplace_transfer_recovery_credits(provider,account_fingerprint,(evidence#>>'{receipt,balanceTransactionId}')) WHERE reversal_id IS NULL;

-- V2 consumes only native GET evidence, never local status or a buyer refund.
CREATE OR REPLACE FUNCTION marketplace_native_recovery_valid(
 funding_id TEXT, target_id TEXT, host_id TEXT, beneficiary_id TEXT, account_id TEXT, transfer_id TEXT,
 amount INTEGER, evidence JSONB, evidence_hash TEXT, is_credit BOOLEAN, receipt_id TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; receipt_json JSONB; proof_json JSONB; req JSONB; expected_target JSONB; expected_request JSONB;
 expected_known JSONB; expected_credits JSONB; selected_receipt JSONB; total BIGINT; n INTEGER; orders TEXT[];
 marker RECORD; reversal_row RECORD; marker_target JSONB; marker_evidence JSONB;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=funding_id;
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_native_recovery_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT x.*,l.chargeback_at,l.purchased_at,p.merchant_id AS payment_merchant,p.provider_payment_id AS payment_provider,
 p.status AS payment_status,p.currency AS payment_currency,p.amount_cents AS payment_amount,p.approved_amount_cents,p.commerce_order_id,p.session_id
 INTO f FROM marketplace_funding_plans x JOIN payment_intents p ON p.id=x.payment_intent_id
 JOIN marketplace_order_ledgers l ON l.host_merchant_id=x.host_merchant_id AND l.order_id=x.provider_payment_id WHERE x.payment_intent_id=funding_id;
 IF NOT FOUND OR f.status<>'held' OR f.provider<>'stripe' OR f.budget IS NULL OR f.chargeback_at IS NULL OR f.purchased_at IS NULL
 OR f.host_merchant_id<>host_id OR f.payment_merchant<>host_id OR f.payment_provider IS DISTINCT FROM f.provider_payment_id
 OR f.account_fingerprint<>account_id OR f.payment_currency<>'BRL' OR f.payment_amount<>f.amount_cents OR f.approved_amount_cents IS DISTINCT FROM f.amount_cents
 OR NOT(f.payment_status='approved' OR f.payment_status LIKE 'chargeback_%')
 OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=funding_id) THEN RAISE EXCEPTION 'marketplace_native_recovery_funding_unproven'; END IF;
 SELECT * INTO t FROM marketplace_payouts WHERE id=target_id;
 IF NOT FOUND OR t.funding_plan_id IS DISTINCT FROM funding_id OR t.provider<>'stripe'
 OR t.account_fingerprint<>account_id OR t.provider_payment_id<>f.provider_payment_id OR t.provider_transfer_id IS DISTINCT FROM transfer_id
 OR t.beneficiary_merchant_id IS DISTINCT FROM beneficiary_id OR t.currency<>'BRL' OR t.status<>'confirmed' OR t.claimed_at IS NULL OR t.reconciled_at IS NULL
 OR amount<=0 OR amount>t.amount_cents OR (NOT is_credit AND amount<>t.amount_cents) THEN RAISE EXCEPTION 'marketplace_native_recovery_transfer_unproven'; END IF;
 SELECT array_agg(v) INTO orders FROM (
 SELECT f.provider_payment_id AS v UNION SELECT f.commerce_order_id WHERE f.commerce_order_id IS NOT NULL
 UNION SELECT id FROM completed_orders WHERE merchant_id=host_id AND (external_order_id IN (f.provider_payment_id,f.commerce_order_id) OR session_id=f.session_id)
 UNION SELECT external_order_id FROM completed_orders WHERE merchant_id=host_id AND external_order_id IS NOT NULL
  AND (external_order_id IN (f.provider_payment_id,f.commerce_order_id) OR session_id=f.session_id)) ids;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans r LEFT JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id WHERE r.funding_plan_id=funding_id
 AND (r.status NOT IN ('blocked','prepared') OR o.status IS NOT NULL AND o.status<>'planned' OR o.claimed_at IS NOT NULL OR o.provider_operation_id IS NOT NULL))
 OR EXISTS(SELECT 1 FROM returns WHERE merchant_id=host_id AND order_id=ANY(orders) AND status::text IN ('REFUND_PROCESSING','REFUND_COMPLETED'))
 THEN RAISE EXCEPTION 'marketplace_native_recovery_refund_unproven'; END IF;
 -- The application writes this fence before reversing transfers. It is not a
 -- buyer submission only when its complete immutable V1 recovery is proven.
 FOR marker IN SELECT rr.*,rt.status AS return_status,rt.merchant_id AS return_host,rt.order_id,
   rp.id AS plan_id,rp.funding_plan_id,rp.host_merchant_id,rp.amount_cents,rp.status AS plan_status,rp.block_reason,rp.allocation,rp.allocation_hash,
   ro.status AS buyer_status,ro.claimed_at AS buyer_claimed,ro.provider_operation_id AS buyer_receipt
  FROM return_refunds rr LEFT JOIN returns rt ON rt.id=rr.return_id
  LEFT JOIN marketplace_refund_plans rp ON rp.return_id=rr.return_id LEFT JOIN marketplace_refund_operations ro ON ro.refund_plan_id=rp.id
  WHERE rr.payment_intent_id=funding_id OR rt.merchant_id=host_id AND rt.order_id=ANY(orders)
 LOOP
  IF marker.plan_id IS NULL OR marker.funding_plan_id IS DISTINCT FROM funding_id OR marker.host_merchant_id IS DISTINCT FROM host_id
   OR marker.id IS DISTINCT FROM 'mrefund_return_'||encode(sha256(convert_to(marketplace_recovery_canonical(to_jsonb(marker.plan_id)),'UTF8')),'hex')
   OR marker.payment_intent_id IS DISTINCT FROM funding_id OR marker.amount_in_cents IS DISTINCT FROM marker.amount_cents
   OR marker.status::text IS DISTINCT FROM 'PENDING' OR marker.provider_refund_id IS NOT NULL OR marker.processed_at IS NOT NULL
   OR marker.return_status::text IS DISTINCT FROM 'INSPECTED_PASS' OR marker.return_host IS DISTINCT FROM host_id OR NOT(marker.order_id=ANY(orders))
   OR marker.plan_status NOT IN ('blocked','prepared') OR marker.block_reason IS DISTINCT FROM 'marketplace_refund_transfer_reversal_required'
   OR marker.buyer_status IS NOT NULL AND marker.buyer_status<>'planned' OR marker.buyer_claimed IS NOT NULL OR marker.buyer_receipt IS NOT NULL
   OR marker.allocation->'version' IS DISTINCT FROM '1'::jsonb OR marker.allocation->'amountCents' IS DISTINCT FROM to_jsonb(marker.amount_cents)
   OR marker.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb(marker.amount_cents)
   OR marker.allocation->'requiredContributions' IS DISTINCT FROM '[]'::jsonb
   OR marker.allocation_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(marker.allocation),'UTF8')),'hex')
   OR (SELECT count(*) FROM marketplace_refund_plans WHERE funding_plan_id=funding_id)<>1
   OR NOT EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE refund_plan_id=marker.plan_id)
   THEN RAISE EXCEPTION 'marketplace_native_recovery_refund_unproven'; END IF;
  -- No earlier buyer refund exists. Per-beneficiary debits must be covered by
  -- unsubmitted cash plus all confirmed, credited reversals of this marker.
  IF jsonb_typeof(marker.allocation->'merchantDebits') IS DISTINCT FROM 'array'
   OR jsonb_array_length(marker.allocation->'merchantDebits')<>jsonb_array_length(f.budget->'beneficiaries')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE
    (SELECT count(*) FROM jsonb_array_elements(marker.allocation->'merchantDebits') d WHERE d->>'merchantId'=b->>'merchantId')<>1)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(marker.allocation->'merchantDebits') d WHERE
    (SELECT COALESCE(sum(v.amount_cents),0) FROM marketplace_transfer_reversals v JOIN marketplace_payouts p ON p.id=v.payout_id
      WHERE v.refund_plan_id=marker.plan_id AND p.beneficiary_merchant_id=d->>'merchantId') IS DISTINCT FROM
    greatest(0,(d->>'amountCents')::bigint-(SELECT COALESCE(sum(p.amount_cents),0) FROM marketplace_payouts p
      WHERE p.funding_plan_id=funding_id AND p.beneficiary_merchant_id=d->>'merchantId'
       AND p.status IN ('planned','cancelled') AND p.claimed_at IS NULL AND p.provider_transfer_id IS NULL)))
   THEN RAISE EXCEPTION 'marketplace_native_recovery_refund_unproven'; END IF;
  FOR reversal_row IN SELECT v.*,p.funding_plan_id AS payout_funding,p.beneficiary_merchant_id,p.provider_transfer_id,p.provider_payment_id,
    p.destination,p.reference AS payout_reference,p.amount_cents AS payout_amount,p.status AS payout_status,p.claimed_at AS payout_claimed,p.reconciled_at AS payout_reconciled,
    c.id AS credit_id,c.reversal_id,c.payout_id AS credit_payout,c.residual_operation_id AS credit_residual,c.funding_plan_id AS credit_funding,
    c.host_merchant_id AS credit_host,c.beneficiary_merchant_id AS credit_beneficiary,c.provider AS credit_provider,c.account_fingerprint AS credit_account,
    c.provider_transfer_id AS credit_transfer,c.provider_operation_id AS credit_receipt,c.amount_cents AS credit_amount,c.evidence AS credit_evidence,c.evidence_hash AS credit_hash
   FROM marketplace_transfer_reversals v LEFT JOIN marketplace_payouts p ON p.id=v.payout_id
   LEFT JOIN marketplace_transfer_recovery_credits c ON c.reversal_id=v.id WHERE v.refund_plan_id=marker.plan_id
  LOOP
   marker_target:=jsonb_build_object('kind','original','id',reversal_row.payout_id,'beneficiaryMerchantId',reversal_row.beneficiary_merchant_id,
    'provider','stripe','accountFingerprint',account_id,'providerPaymentId',f.provider_payment_id,'providerTransferId',reversal_row.provider_transfer_id,
    'reference',reversal_row.payout_reference,'destination',reversal_row.destination,'amountCents',reversal_row.payout_amount);
   marker_evidence:=jsonb_build_object('version',1,'reason','chargeback_transfer_principal_credit','fundingPlanId',funding_id,'hostMerchantId',host_id,
    'instructionsHash',f.instructions_hash,'budgetHash',encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex'),
    'chargebackAt',reversal_row.credit_evidence->>'chargebackAt','target',marker_target,'reversals',jsonb_build_array(jsonb_build_object('reversalId',reversal_row.id,
    'refundPlanId',marker.plan_id,'requestHash',reversal_row.request_hash,'providerOperationId',reversal_row.provider_operation_id,'amountCents',reversal_row.amount_cents)));
   expected_request:=jsonb_build_object('kind','transfer_reversal','provider','stripe','environment',f.environment,'accountFingerprint',account_id,
    'providerPaymentId',f.provider_payment_id,'sourceId',f.budget#>>'{capture,sourceId}','paymentAmountCents',f.amount_cents,'amountCents',reversal_row.amount_cents,
    'currency','BRL','previousRefunds','[]'::jsonb,'reference','mreverse_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,marker.plan_id,reversal_row.payout_id)),'UTF8')),'hex'),
    'transfer',jsonb_build_object('providerTransferId',reversal_row.provider_transfer_id,'destination',reversal_row.destination,'amountCents',reversal_row.payout_amount,'reference',reversal_row.payout_reference));
   expected_request:=expected_request||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(expected_request),'UTF8')),'hex'));
   IF reversal_row.credit_id IS NULL OR reversal_row.payout_id IS NULL OR reversal_row.residual_operation_id IS NOT NULL
    OR reversal_row.payout_funding IS DISTINCT FROM funding_id OR reversal_row.provider_payment_id IS DISTINCT FROM f.provider_payment_id
    OR reversal_row.payout_status IS DISTINCT FROM 'confirmed' OR reversal_row.payout_claimed IS NULL OR reversal_row.payout_reconciled IS NULL
    OR reversal_row.status IS DISTINCT FROM 'confirmed' OR reversal_row.claimed_at IS NULL OR reversal_row.reconciled_at IS NULL
    OR reversal_row.provider_operation_id IS NULL OR reversal_row.amount_cents<=0 OR reversal_row.host_merchant_id IS DISTINCT FROM host_id
    OR reversal_row.provider IS DISTINCT FROM 'stripe' OR reversal_row.account_fingerprint IS DISTINCT FROM account_id
    OR reversal_row.request IS DISTINCT FROM expected_request OR reversal_row.request_hash IS DISTINCT FROM expected_request->>'requestHash'
    OR reversal_row.reference IS DISTINCT FROM expected_request->>'reference'
    OR reversal_row.credit_payout IS DISTINCT FROM reversal_row.payout_id OR reversal_row.credit_residual IS NOT NULL
    OR reversal_row.credit_funding IS DISTINCT FROM funding_id OR reversal_row.credit_host IS DISTINCT FROM host_id
    OR reversal_row.credit_beneficiary IS DISTINCT FROM reversal_row.beneficiary_merchant_id OR reversal_row.credit_provider IS DISTINCT FROM 'stripe'
    OR reversal_row.credit_account IS DISTINCT FROM account_id OR reversal_row.credit_transfer IS DISTINCT FROM reversal_row.provider_transfer_id
    OR reversal_row.credit_receipt IS DISTINCT FROM reversal_row.provider_operation_id OR reversal_row.credit_amount IS DISTINCT FROM reversal_row.amount_cents
    OR ((reversal_row.credit_evidence->>'chargebackAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at
    OR reversal_row.credit_evidence IS DISTINCT FROM marker_evidence
    OR reversal_row.credit_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(marker_evidence),'UTF8')),'hex')
    THEN RAISE EXCEPTION 'marketplace_native_recovery_refund_unproven'; END IF;
  END LOOP;
 END LOOP;
 expected_target:=jsonb_build_object('kind','original','id',t.id,'beneficiaryMerchantId',t.beneficiary_merchant_id,'provider','stripe',
 'accountFingerprint',t.account_fingerprint,'providerPaymentId',t.provider_payment_id,'providerTransferId',t.provider_transfer_id,
 'reference',t.reference,'destination',t.destination,'amountCents',t.amount_cents);
 IF evidence->'version' IS DISTINCT FROM '2'::jsonb OR evidence->>'reason' IS DISTINCT FROM (CASE WHEN is_credit THEN 'chargeback_transfer_principal_credit' ELSE 'chargeback_transfer_principal_recovered' END)
 OR evidence->>'fundingPlanId' IS DISTINCT FROM funding_id OR evidence->>'hostMerchantId' IS DISTINCT FROM host_id OR evidence->'target' IS DISTINCT FROM expected_target
 OR evidence->>'instructionsHash' IS DISTINCT FROM f.instructions_hash OR ((evidence->>'chargebackAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at
 OR evidence->>'budgetHash' IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex')
 OR evidence_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(evidence),'UTF8')),'hex') THEN RAISE EXCEPTION 'marketplace_native_recovery_evidence_invalid'; END IF;
 IF is_credit THEN
  proof_json:=evidence->'proof'; req:=proof_json->'request';
  IF jsonb_typeof(proof_json) IS DISTINCT FROM 'object' OR jsonb_typeof(proof_json->'receipts') IS DISTINCT FROM 'array' OR jsonb_array_length(proof_json->'receipts') NOT BETWEEN 1 AND 2000
  OR proof_json->'refundedAmountCents' IS DISTINCT FROM '0'::jsonb OR proof_json->'buyerRefundIds' IS DISTINCT FROM '[]'::jsonb OR proof_json->>'observedAt' IS NULL THEN RAISE EXCEPTION 'marketplace_native_recovery_history_invalid'; END IF;
  PERFORM (proof_json->>'observedAt')::timestamptz;
  IF EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE payout_id=target_id AND (status<>'confirmed' OR claimed_at IS NULL OR reconciled_at IS NULL OR provider_operation_id IS NULL))
  THEN RAISE EXCEPTION 'marketplace_native_recovery_history_invalid'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',provider_operation_id,'amountCents',amount_cents,'reference',reference,'requestHash',request_hash) ORDER BY id COLLATE "C"),'[]')
  INTO expected_known FROM marketplace_transfer_reversals WHERE payout_id=target_id;
  expected_request:=jsonb_build_object('version',1,'fundingPlanId',funding_id,'hostMerchantId',host_id,'instructionsHash',f.instructions_hash,
   'budgetHash',evidence->>'budgetHash','chargebackAt',evidence->>'chargebackAt','environment',f.environment,'sourceId',f.budget#>>'{capture,sourceId}',
   'paymentAmountCents',f.amount_cents,'target',expected_target,'knownReversals',expected_known);
  expected_request:=expected_request||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(expected_request),'UTF8')),'hex'));
  IF req IS DISTINCT FROM expected_request THEN RAISE EXCEPTION 'marketplace_native_recovery_request_invalid'; END IF;
  total:=0; n:=0;
  FOR receipt_json IN SELECT value FROM jsonb_array_elements(proof_json->'receipts') LOOP
   IF receipt_json->>'providerOperationId' IS NULL OR receipt_json->>'providerOperationId' !~ '^trr_[A-Za-z0-9_]+$' OR receipt_json->>'providerTransferId' IS DISTINCT FROM transfer_id
   OR receipt_json->>'balanceTransactionId' IS NULL OR receipt_json->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$' OR receipt_json->>'balanceSourceId' IS DISTINCT FROM receipt_json->>'providerOperationId'
   OR receipt_json->>'balanceType' IS DISTINCT FROM 'transfer_refund' OR receipt_json->>'balanceStatus' IS DISTINCT FROM 'available' OR receipt_json->>'currency' IS DISTINCT FROM 'BRL'
   OR receipt_json->'sourceRefund' IS DISTINCT FROM 'null'::jsonb OR receipt_json->'balanceFeeCents' IS DISTINCT FROM '0'::jsonb OR receipt_json->'balanceAmountCents' IS DISTINCT FROM receipt_json->'amountCents'
   OR receipt_json->'balanceNetCents' IS DISTINCT FROM receipt_json->'amountCents' OR jsonb_typeof(receipt_json->'amountCents') IS DISTINCT FROM 'number'
   OR (receipt_json->>'amountCents')::numeric<=0 OR (receipt_json->>'amountCents')::numeric<>trunc((receipt_json->>'amountCents')::numeric) THEN RAISE EXCEPTION 'marketplace_native_recovery_receipt_invalid'; END IF;
   total:=total+(receipt_json->>'amountCents')::bigint; n:=n+1;
   IF receipt_json->>'providerOperationId'=receipt_id THEN selected_receipt:=receipt_json; END IF;
  END LOOP;
  IF n<>(SELECT count(DISTINCT value->>'providerOperationId') FROM jsonb_array_elements(proof_json->'receipts'))
  OR n<>(SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(proof_json->'receipts'))
  OR total>t.amount_cents OR to_jsonb(total) IS DISTINCT FROM proof_json->'providerReversedAmountCents' OR selected_receipt IS NULL
  OR selected_receipt IS DISTINCT FROM evidence->'receipt' OR selected_receipt->'amountCents' IS DISTINCT FROM to_jsonb(amount)
  OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE provider='stripe' AND account_fingerprint=account_id AND provider_operation_id=receipt_id)
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(expected_known) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof_json->'receipts') observed(value)
   WHERE observed.value->>'providerOperationId'=k->>'providerOperationId' AND observed.value->'amountCents'=k->'amountCents'))
  OR amount+(SELECT COALESCE(sum(amount_cents),0) FROM marketplace_transfer_recovery_credits WHERE payout_id=target_id)>t.amount_cents
  THEN RAISE EXCEPTION 'marketplace_native_recovery_conservation_invalid'; END IF;
 ELSE
  SELECT jsonb_agg(jsonb_build_object('creditId',id,'evidenceHash',c.evidence_hash,'providerOperationId',provider_operation_id,'amountCents',amount_cents) ORDER BY id COLLATE "C"),sum(amount_cents),count(*)
  INTO expected_credits,total,n FROM marketplace_transfer_recovery_credits c WHERE payout_id=target_id;
  IF n=0 OR total<>t.amount_cents OR evidence->'credits' IS DISTINCT FROM expected_credits
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits credit_row WHERE payout_id=target_id AND (funding_plan_id<>funding_id OR host_merchant_id<>host_id
    OR beneficiary_merchant_id<>beneficiary_id OR account_fingerprint<>account_id OR provider_transfer_id<>transfer_id OR provider<>'stripe'
    OR credit_row.evidence->'target' IS DISTINCT FROM expected_target)) THEN RAISE EXCEPTION 'marketplace_native_recovery_conservation_invalid'; END IF;
 END IF;
END $$;

CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; v RECORD; expected_target JSONB; expected_reversals JSONB; total BIGINT := 0; n INTEGER := 0;
BEGIN

 IF NEW.evidence->'version'='2'::jsonb THEN
  IF NEW.provider<>'stripe' OR NEW.payout_id IS NULL OR NEW.residual_operation_id IS NOT NULL THEN RAISE EXCEPTION 'marketplace_native_recovery_target_invalid'; END IF;
  PERFORM marketplace_native_recovery_valid(NEW.funding_plan_id,NEW.payout_id,NEW.host_merchant_id,NEW.beneficiary_merchant_id,NEW.account_fingerprint,NEW.provider_transfer_id,NEW.amount_cents,NEW.evidence,NEW.evidence_hash,false);
  RETURN NEW;
 END IF;
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

CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_credit_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; v RECORD; expected_target JSONB; expected_reversals JSONB; total BIGINT := 0; n INTEGER := 0;
BEGIN

 IF NEW.evidence->'version'='2'::jsonb THEN
  IF NEW.provider<>'stripe' OR NEW.payout_id IS NULL OR NEW.residual_operation_id IS NOT NULL OR NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'marketplace_native_recovery_target_invalid'; END IF;
  PERFORM marketplace_native_recovery_valid(NEW.funding_plan_id,NEW.payout_id,NEW.host_merchant_id,NEW.beneficiary_merchant_id,NEW.account_fingerprint,NEW.provider_transfer_id,NEW.amount_cents,NEW.evidence,NEW.evidence_hash,true,NEW.provider_operation_id);
  RETURN NEW;
 END IF;
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

-- A legacy refund marker is also financial intent. Serialize it against native
-- evidence so a writer cannot consume receipts after the zero-refund snapshot.
CREATE OR REPLACE FUNCTION marketplace_native_refund_consumption_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE funding_row RECORD; return_row RECORD; payment_id TEXT;
BEGIN
 IF TG_TABLE_NAME='return_refunds' THEN
  SELECT * INTO return_row FROM returns WHERE id=NEW.return_id;
  payment_id:=NEW.payment_intent_id;
 ELSE
  IF NEW.status::text NOT IN ('REFUND_PROCESSING','REFUND_COMPLETED') THEN RETURN NEW; END IF;
  return_row:=NEW; payment_id:=NULL;
 END IF;
 FOR funding_row IN SELECT f.* FROM marketplace_funding_plans f JOIN payment_intents p ON p.id=f.payment_intent_id
  WHERE f.payment_intent_id=payment_id OR f.host_merchant_id=return_row.merchant_id AND (
   return_row.order_id=f.provider_payment_id OR return_row.order_id=p.commerce_order_id OR EXISTS(
    SELECT 1 FROM completed_orders o WHERE o.merchant_id=f.host_merchant_id
     AND (o.external_order_id IN (f.provider_payment_id,p.commerce_order_id) OR o.session_id=p.session_id)
     AND return_row.order_id IN (o.id,o.external_order_id)))
  ORDER BY f.payment_intent_id COLLATE "C"
 LOOP
  IF funding_row.provider_payment_id IS NOT NULL THEN
   PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',funding_row.host_merchant_id,funding_row.provider_payment_id)),0));
  END IF;
  IF EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=funding_row.payment_intent_id AND reversal_id IS NULL)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=funding_row.payment_intent_id AND evidence->'version'='2'::jsonb)
  THEN RAISE EXCEPTION 'marketplace_refund_money_reserved_for_dispute'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_native_refund_consumption_guard_trigger ON return_refunds;
CREATE TRIGGER marketplace_native_refund_consumption_guard_trigger BEFORE INSERT OR UPDATE ON return_refunds FOR EACH ROW EXECUTE FUNCTION marketplace_native_refund_consumption_guard();
DROP TRIGGER IF EXISTS marketplace_native_return_consumption_guard_trigger ON returns;
CREATE TRIGGER marketplace_native_return_consumption_guard_trigger BEFORE INSERT OR UPDATE ON returns FOR EACH ROW EXECUTE FUNCTION marketplace_native_refund_consumption_guard();
