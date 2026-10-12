-- Native residual receipts extend the append-only recovery journals. No funded
-- balance, original payout, debt or historical JSON snapshot is rewritten.
DO $$
DECLARE object_name TEXT; object_oid OID;
BEGIN
 FOREACH object_name IN ARRAY ARRAY['marketplace_funding_plans','payment_intents','marketplace_order_ledgers',
  'marketplace_payouts','marketplace_refund_plans','marketplace_refund_operations','marketplace_residual_plans',
  'marketplace_residual_operations','marketplace_transfer_reversals','marketplace_transfer_recovery_credits',
  'marketplace_transfer_recoveries','returns','return_items','return_refunds','completed_orders'] LOOP
  IF to_regclass(format('%I.%I',current_schema(),object_name)) IS NULL THEN
   RAISE EXCEPTION 'marketplace_native_residual_prerequisites_missing: %',object_name;
  END IF;
 END LOOP;
 FOREACH object_name IN ARRAY ARRAY['marketplace_recovery_canonical(jsonb)','marketplace_residual_allocation_valid(jsonb)',
  'marketplace_native_recovery_valid(text,text,text,text,text,text,integer,jsonb,text,boolean,text)',
  'marketplace_transfer_recovery_insert_valid()','marketplace_transfer_recovery_credit_insert_valid()',
  'marketplace_transfer_recovery_immutable()','marketplace_debt_recovery_valid()',
  'marketplace_refund_recovered_money_guard()','marketplace_native_refund_consumption_guard()'] LOOP
  IF to_regprocedure(format('%I.',current_schema())||object_name) IS NULL THEN
   RAISE EXCEPTION 'marketplace_native_residual_prerequisites_missing: %',object_name;
  END IF;
 END LOOP;
 FOREACH object_name IN ARRAY ARRAY['marketplace_transfer_recovery_credits_receipt_key',
  'marketplace_native_recovery_balance_receipt_key','marketplace_transfer_recovery_credits_reversal_id_key',
  'marketplace_transfer_recoveries_receipt_key','marketplace_transfer_recoveries_residual_operation_id_key'] LOOP
  object_oid:=to_regclass(format('%I.%I',current_schema(),object_name));
  IF object_oid IS NULL OR NOT EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=object_oid AND indisunique AND indisvalid) THEN
   RAISE EXCEPTION 'marketplace_native_residual_prerequisites_missing: %',object_name;
  END IF;
 END LOOP;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=to_regclass(format('%I.marketplace_transfer_recovery_credits',current_schema()))
   AND conname='marketplace_native_credit_version' AND contype='c' AND convalidated) THEN
  RAISE EXCEPTION 'marketplace_native_residual_prerequisites_missing: credit_version';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(format('%I.marketplace_transfer_recovery_credits',current_schema()))
  AND tgname='marketplace_transfer_recovery_credit_immutable_trigger' AND NOT tgisinternal AND tgenabled='O')
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass(format('%I.marketplace_transfer_recoveries',current_schema()))
  AND tgname='marketplace_transfer_recovery_immutable_trigger' AND NOT tgisinternal AND tgenabled='O') THEN
  RAISE EXCEPTION 'marketplace_native_residual_prerequisites_missing: immutable_guard';
 END IF;
END $$;

ALTER TABLE marketplace_transfer_recovery_credits DROP CONSTRAINT marketplace_native_credit_version;
ALTER TABLE marketplace_transfer_recovery_credits ADD CONSTRAINT marketplace_native_credit_version CHECK (COALESCE(
 (evidence->'version'='1'::jsonb AND reversal_id IS NOT NULL) OR
 (evidence->'version'='2'::jsonb AND reversal_id IS NULL AND payout_id IS NOT NULL AND residual_operation_id IS NULL) OR
 (evidence->'version'='3'::jsonb AND reversal_id IS NULL AND payout_id IS NULL AND residual_operation_id IS NOT NULL),false));

-- Rebuild the current request under the refund/recovery order lock. The funding
-- row is then locked too: no proof can adopt a different refund/generation prefix.
CREATE OR REPLACE FUNCTION marketplace_native_residual_request(
 funding_id TEXT,target_id TEXT,host_id TEXT,beneficiary_id TEXT,account_id TEXT,transfer_id TEXT,chargeback_text TEXT
) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; r RECORD; g RECORD; o RECORD; v RECORD; c RECORD; b JSONB; x JSONB; tr JSONB; rev JSONB;
 raw JSONB; expected JSONB; expected_basis JSONB; expected_allocation JSONB; expected_request JSONB; target JSONB;
 refunds JSONB:='[]'; refund_basis JSONB:='[]'; buyer_receipts JSONB:='[]'; generations JSONB:='[]'; known JSONB:='[]';
 prefix JSONB; prefix_receipts JSONB; prior_generations JSONB; beneficiaries JSONB; transfers JSONB; expected_transfers JSONB;
 refund_total BIGINT:=0; platform_debit BIGINT:=0; remaining BIGINT; retained BIGINT; transferred BIGINT; total_transferred BIGINT;
 payout_total BIGINT; frontier INTEGER; previous_frontier INTEGER:=0; count_expected INTEGER; count_actual INTEGER;
 orders TEXT[]; previous_reversals JSONB; marker_target JSONB; marker_evidence JSONB; required JSONB; needed BIGINT; debit BIGINT;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=funding_id;
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_native_residual_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT x.*,l.chargeback_at,l.purchased_at,p.merchant_id AS payment_merchant,p.provider_payment_id AS payment_provider,
  p.status AS payment_status,p.currency AS payment_currency,p.amount_cents AS payment_amount,p.approved_amount_cents,p.commerce_order_id,p.session_id,p.creation
 INTO f FROM marketplace_funding_plans x JOIN payment_intents p ON p.id=x.payment_intent_id
 JOIN marketplace_order_ledgers l ON l.host_merchant_id=x.host_merchant_id AND l.order_id=x.provider_payment_id
 WHERE x.payment_intent_id=funding_id FOR UPDATE OF x;
 IF NOT FOUND OR f.status IS DISTINCT FROM 'held' OR f.provider IS DISTINCT FROM 'stripe' OR f.budget IS NULL
  OR f.chargeback_at IS NULL OR f.purchased_at IS NULL OR f.host_merchant_id IS DISTINCT FROM host_id OR f.payment_merchant IS DISTINCT FROM host_id
  OR f.payment_provider IS DISTINCT FROM f.provider_payment_id OR f.account_fingerprint IS DISTINCT FROM account_id
  OR f.payment_currency IS DISTINCT FROM 'BRL' OR f.payment_amount IS DISTINCT FROM f.amount_cents OR f.approved_amount_cents IS DISTINCT FROM f.amount_cents
  OR (f.payment_status='approved' OR left(f.payment_status,11)='chargeback_') IS NOT TRUE
  OR ((chargeback_text)::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at
  OR f.instructions_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(f.instructions),'UTF8')),'hex')
  OR f.creation#>'{input,marketplaceFunding}' IS DISTINCT FROM f.instructions
  OR f.instructions->>'hostMerchantId' IS DISTINCT FROM host_id OR f.instructions->>'provider' IS DISTINCT FROM 'stripe'
  OR f.instructions->>'environment' IS DISTINCT FROM f.environment OR f.instructions->>'accountFingerprint' IS DISTINCT FROM account_id
  OR f.budget#>>'{capture,providerPaymentId}' IS DISTINCT FROM f.provider_payment_id OR f.budget#>'{capture,amountCents}' IS DISTINCT FROM to_jsonb(f.amount_cents)
  OR f.budget#>'{capture,providerFeeCents}' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
  OR f.budget#>'{capture,netAmountCents}' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
  OR f.budget->'payoutTotalCents' IS DISTINCT FROM to_jsonb(f.payout_total_cents)
  OR f.budget->'platformRetainedCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents)
  OR jsonb_typeof(f.budget->'beneficiaries') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'marketplace_native_residual_funding_unproven'; END IF;
 SELECT a.*,p.funding_plan_id,p.host_merchant_id,p.generation,p.basis_hash,p.allocation_hash,p.status AS plan_status,p.held_reason
 INTO t FROM marketplace_residual_operations a JOIN marketplace_residual_plans p ON p.id=a.residual_plan_id WHERE a.id=target_id;
 IF NOT FOUND OR t.funding_plan_id IS DISTINCT FROM funding_id OR t.host_merchant_id IS DISTINCT FROM host_id
  OR t.plan_status IS DISTINCT FROM 'held' OR t.held_reason IS DISTINCT FROM 'marketplace_residual_dispute_requires_reconciliation'
  OR t.status IS DISTINCT FROM 'confirmed' OR t.claimed_at IS NULL OR t.reconciled_at IS NULL OR t.provider IS DISTINCT FROM 'stripe'
  OR t.account_fingerprint IS DISTINCT FROM account_id OR t.provider_transfer_id IS DISTINCT FROM transfer_id
  OR t.beneficiary_merchant_id IS DISTINCT FROM beneficiary_id OR t.amount_cents<=0
  OR t.request_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(t.request-'requestHash'),'UTF8')),'hex')
  OR t.request->>'requestHash' IS DISTINCT FROM t.request_hash THEN RAISE EXCEPTION 'marketplace_native_residual_target_unproven'; END IF;
 target:=jsonb_build_object('kind','residual','id',t.id,'beneficiaryMerchantId',t.beneficiary_merchant_id,'provider','stripe',
  'accountFingerprint',t.account_fingerprint,'providerPaymentId',f.provider_payment_id,'providerTransferId',t.provider_transfer_id,
  'reference',t.reference,'destination',t.request->>'destination','amountCents',t.amount_cents,'requestHash',t.request_hash);
 SELECT array_agg(id) INTO orders FROM (SELECT f.provider_payment_id AS id UNION SELECT f.commerce_order_id WHERE f.commerce_order_id IS NOT NULL
  UNION SELECT id FROM completed_orders WHERE merchant_id=host_id AND (external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR session_id=f.session_id)
  UNION SELECT external_order_id FROM completed_orders WHERE merchant_id=host_id AND external_order_id IS NOT NULL
   AND (external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR session_id=f.session_id)) order_ids;
 IF EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=funding_id AND
  ((status IN ('planned','cancelled') AND claimed_at IS NULL AND provider_transfer_id IS NULL) OR
    (status='confirmed' AND claimed_at IS NOT NULL AND reconciled_at IS NOT NULL AND provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$')) IS NOT TRUE)
  OR EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=funding_id AND (provider IS DISTINCT FROM 'stripe'
    OR account_fingerprint IS DISTINCT FROM account_id OR provider_payment_id IS DISTINCT FROM f.provider_payment_id OR currency IS DISTINCT FROM 'BRL'))
  OR (SELECT COALESCE(sum(amount_cents),0) FROM marketplace_payouts WHERE funding_plan_id=funding_id) IS DISTINCT FROM f.payout_total_cents::bigint THEN
  RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
 IF EXISTS(SELECT 1 FROM marketplace_transfer_reversals a LEFT JOIN marketplace_refund_plans p ON p.id=a.refund_plan_id
  LEFT JOIN marketplace_payouts q ON q.id=a.payout_id LEFT JOIN marketplace_residual_operations residual_op ON residual_op.id=a.residual_operation_id
  LEFT JOIN marketplace_residual_plans residual_plan ON residual_plan.id=residual_op.residual_plan_id
  WHERE (p.funding_plan_id=funding_id OR q.funding_plan_id=funding_id OR residual_plan.funding_plan_id=funding_id)
   AND (p.funding_plan_id IS DISTINCT FROM funding_id OR p.host_merchant_id IS DISTINCT FROM host_id OR a.host_merchant_id IS DISTINCT FROM host_id
    OR a.provider IS DISTINCT FROM 'stripe' OR a.account_fingerprint IS DISTINCT FROM account_id OR a.status IS DISTINCT FROM 'confirmed'
    OR a.claimed_at IS NULL OR a.reconciled_at IS NULL OR a.provider_operation_id IS NULL OR a.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$'
    OR a.payout_id IS NOT NULL AND q.funding_plan_id IS DISTINCT FROM funding_id
    OR a.residual_operation_id IS NOT NULL AND residual_plan.funding_plan_id IS DISTINCT FROM funding_id)) THEN
  RAISE EXCEPTION 'marketplace_native_residual_consumption_unproven'; END IF;
 -- Buyer refunds are proof of consumption, never recovery credits. Each receipt
 -- must be the complete confirmed canonical journal and its original prefix.
 FOR r IN SELECT p.*,a.status AS operation_status,a.provider,a.account_fingerprint,a.request,a.request_hash,a.reference,a.provider_operation_id,a.claimed_at,a.reconciled_at,
  u.status AS return_status,u.merchant_id AS return_host,u.order_id,refund_marker.id AS marker_id,refund_marker.payment_intent_id,refund_marker.status AS marker_status,
  refund_marker.provider_refund_id,refund_marker.amount_in_cents,refund_marker.processed_at
  FROM marketplace_refund_plans p LEFT JOIN marketplace_refund_operations a ON a.refund_plan_id=p.id
  LEFT JOIN returns u ON u.id=p.return_id LEFT JOIN return_refunds refund_marker ON refund_marker.return_id=p.return_id
  WHERE p.funding_plan_id=funding_id AND p.status='confirmed' ORDER BY (p.allocation->>'cumulativeRefundCents')::bigint,p.id COLLATE "C"
 LOOP
  raw:=jsonb_build_object('kind','refund','provider','stripe','environment',f.environment,'accountFingerprint',account_id,
   'providerPaymentId',f.provider_payment_id,'sourceId',f.budget#>>'{capture,sourceId}','paymentAmountCents',f.amount_cents,
   'amountCents',r.amount_cents,'currency','BRL','previousRefunds',buyer_receipts,
   'reference','mrefund_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,r.return_id)),'UTF8')),'hex'));
  expected_request:=raw||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(raw),'UTF8')),'hex'));
  refund_total:=refund_total+r.amount_cents; platform_debit:=platform_debit+(r.allocation->>'platformDebitCents')::bigint;
  IF r.host_merchant_id IS DISTINCT FROM host_id OR r.operation_status IS DISTINCT FROM 'confirmed' OR r.claimed_at IS NULL OR r.reconciled_at IS NULL
   OR r.provider_operation_id IS NULL OR r.provider_operation_id !~ '^re_[A-Za-z0-9_]+$' OR r.provider IS DISTINCT FROM 'stripe'
   OR r.account_fingerprint IS DISTINCT FROM account_id OR r.request IS DISTINCT FROM expected_request
   OR r.request_hash IS DISTINCT FROM expected_request->>'requestHash' OR r.reference IS DISTINCT FROM expected_request->>'reference'
   OR r.allocation_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(r.allocation),'UTF8')),'hex')
   OR r.allocation->'version' IS DISTINCT FROM '1'::jsonb OR r.allocation->'amountCents' IS DISTINCT FROM to_jsonb(r.amount_cents)
   OR r.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb(refund_total) OR r.allocation->'requiredContributions' IS DISTINCT FROM '[]'::jsonb
   OR r.return_status::text IS DISTINCT FROM 'REFUND_COMPLETED' OR r.return_host IS DISTINCT FROM host_id OR NOT(r.order_id=ANY(orders))
   OR r.marker_id IS DISTINCT FROM 'mrefund_return_'||encode(sha256(convert_to(marketplace_recovery_canonical(to_jsonb(r.id)),'UTF8')),'hex')
   OR r.payment_intent_id IS DISTINCT FROM funding_id OR r.marker_status IS DISTINCT FROM 'COMPLETED'
   OR r.provider_refund_id IS DISTINCT FROM r.provider_operation_id OR r.amount_in_cents IS DISTINCT FROM r.amount_cents
   OR r.amount_cents<=0 OR refund_total>f.net_amount_cents OR platform_debit<0 OR platform_debit>f.platform_retained_cents
   OR r.allocation->'platformRemainingCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents-platform_debit)
   OR jsonb_typeof(r.allocation->'merchantDebits') IS DISTINCT FROM 'array'
   OR jsonb_typeof(r.allocation->'remainingBeneficiaries') IS DISTINCT FROM 'array'
   OR jsonb_array_length(r.allocation->'merchantDebits')<>jsonb_array_length(f.budget->'beneficiaries')
   OR jsonb_array_length(r.allocation->'remainingBeneficiaries')<>jsonb_array_length(f.budget->'beneficiaries')
   OR (SELECT jsonb_agg(jsonb_build_object('variantId',variant_id,'quantity',quantity) ORDER BY variant_id COLLATE "C") FROM return_items WHERE return_id=r.return_id)
    IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('variantId',value->>'variantId','quantity',value->'quantity') ORDER BY value->>'variantId' COLLATE "C") FROM jsonb_array_elements(r.allocation->'lines'))
   THEN RAISE EXCEPTION 'marketplace_native_residual_refund_unproven'; END IF;
  FOR b IN SELECT value FROM jsonb_array_elements(f.budget->'beneficiaries') LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(r.allocation->'merchantDebits') d WHERE d->>'merchantId'=b->>'merchantId')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') d WHERE d->>'merchantId'=b->>'merchantId')<>1 THEN
    RAISE EXCEPTION 'marketplace_native_residual_refund_unproven'; END IF;
   SELECT (b->>'amountCents')::bigint-COALESCE(sum((d->>'amountCents')::bigint),0) INTO remaining
    FROM marketplace_refund_plans p CROSS JOIN LATERAL jsonb_array_elements(p.allocation->'merchantDebits') d
    WHERE p.funding_plan_id=funding_id AND p.status='confirmed' AND (p.allocation->>'cumulativeRefundCents')::bigint<=refund_total AND d->>'merchantId'=b->>'merchantId';
   IF remaining<0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') d WHERE d->>'merchantId'=b->>'merchantId'
    AND d->'amountCents'=to_jsonb(remaining) AND d->'providerFeeCents'=b->'providerFeeCents') THEN RAISE EXCEPTION 'marketplace_native_residual_refund_unproven'; END IF;
  END LOOP;
  IF (SELECT sum((d->>'amountCents')::bigint) FROM jsonb_array_elements(r.allocation->'merchantDebits') d)+(r.allocation->>'platformDebitCents')::bigint<>r.amount_cents THEN
   RAISE EXCEPTION 'marketplace_native_residual_refund_unproven'; END IF;
  refunds:=refunds||jsonb_build_array(jsonb_build_object('refundPlanId',r.id,'returnId',r.return_id,'allocationHash',r.allocation_hash,
   'requestHash',r.request_hash,'reference',r.reference,'providerOperationId',r.provider_operation_id,'amountCents',r.amount_cents));
  refund_basis:=refund_basis||jsonb_build_array((refunds->-1)-'reference');
  buyer_receipts:=buyer_receipts||jsonb_build_array(jsonb_build_object('providerOperationId',r.provider_operation_id,'amountCents',r.amount_cents));
 END LOOP;
 IF jsonb_array_length(refunds) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'marketplace_native_residual_refund_unproven'; END IF;
 -- Generations keep their own historical refund frontier, while the outer
 -- request pins every current generation and confirmed buyer refund.
 FOR g IN SELECT * FROM marketplace_residual_plans WHERE funding_plan_id=funding_id ORDER BY generation LOOP
  frontier:=jsonb_array_length(g.basis->'refunds');
  IF g.generation<>jsonb_array_length(generations)+1 OR g.host_merchant_id IS DISTINCT FROM host_id
   OR (g.status='completed' AND g.held_reason IS NULL OR g.status='held' AND g.held_reason='marketplace_residual_dispute_requires_reconciliation') IS NOT TRUE
   OR frontier<=previous_frontier OR frontier>jsonb_array_length(refunds)
   OR g.basis_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(g.basis),'UTF8')),'hex')
   OR g.allocation_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(g.allocation),'UTF8')),'hex')
   OR marketplace_residual_allocation_valid(g.allocation) IS NOT TRUE THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  SELECT jsonb_agg(value ORDER BY ord) INTO prefix FROM jsonb_array_elements(refund_basis) WITH ORDINALITY items(value,ord) WHERE ord<=frontier;
  SELECT jsonb_agg(value ORDER BY ord) INTO prefix_receipts FROM jsonb_array_elements(buyer_receipts) WITH ORDINALITY items(value,ord) WHERE ord<=frontier;
  prior_generations:=generations;
  expected_basis:=jsonb_build_object('version',g.basis->'version','fundingPlanId',funding_id,'instructionsHash',f.instructions_hash,
   'budgetHash',encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex'),'refunds',prefix);
  expected_transfers:='[]';
  IF g.basis->'version'='1'::jsonb AND EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=funding_id AND status='confirmed') THEN
   RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  IF g.basis->'version' IN ('2'::jsonb,'3'::jsonb) THEN
   transfers:=g.basis->'originalTransfers';
   IF jsonb_typeof(transfers) IS DISTINCT FROM 'array' OR jsonb_array_length(transfers)=0
    OR (SELECT count(DISTINCT value->>'payoutId') FROM jsonb_array_elements(transfers))<>jsonb_array_length(transfers)
    OR (SELECT count(DISTINCT value->>'providerTransferId') FROM jsonb_array_elements(transfers))<>jsonb_array_length(transfers)
    THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
   SELECT count(*) INTO count_expected FROM marketplace_payouts WHERE funding_plan_id=funding_id AND status='confirmed';
   SELECT count(*)+count_expected INTO count_expected FROM marketplace_residual_operations a JOIN marketplace_residual_plans p ON p.id=a.residual_plan_id
    WHERE p.funding_plan_id=funding_id AND p.generation<g.generation;
   IF count_expected<>jsonb_array_length(transfers) THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
   FOR tr IN SELECT value FROM jsonb_array_elements(transfers) LOOP
    IF tr->>'kind'='residual' THEN
     SELECT a.id,a.amount_cents,a.reference,a.status,a.claimed_at,a.reconciled_at,a.provider_transfer_id,a.provider,a.account_fingerprint,a.beneficiary_merchant_id,
      a.request->>'destination' AS destination,a.request_hash,p.funding_plan_id,p.generation,p.id AS residual_plan_id INTO o
      FROM marketplace_residual_operations a JOIN marketplace_residual_plans p ON p.id=a.residual_plan_id WHERE a.id=tr->>'payoutId';
     IF NOT FOUND OR o.generation>=g.generation OR tr->>'residualPlanId' IS DISTINCT FROM o.residual_plan_id OR tr->>'requestHash' IS DISTINCT FROM o.request_hash THEN
      RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
     expected:=jsonb_build_object('kind','residual','residualPlanId',o.residual_plan_id,'requestHash',o.request_hash);
    ELSE
     SELECT id,amount_cents,reference,status,claimed_at,reconciled_at,provider_transfer_id,provider,account_fingerprint,beneficiary_merchant_id,destination,funding_plan_id,NULL::text AS request_hash
      INTO o FROM marketplace_payouts WHERE id=tr->>'payoutId';
     IF NOT FOUND OR tr ? 'kind' THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
     expected:='{}';
    END IF;
    IF o.funding_plan_id IS DISTINCT FROM funding_id OR o.status IS DISTINCT FROM 'confirmed' OR o.claimed_at IS NULL OR o.reconciled_at IS NULL
     OR o.provider IS DISTINCT FROM 'stripe' OR o.account_fingerprint IS DISTINCT FROM account_id OR o.provider_transfer_id IS NULL
     THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
    previous_reversals:='[]';
    FOR v IN SELECT a.*,p.amount_cents AS refund_amount FROM marketplace_transfer_reversals a JOIN marketplace_refund_plans p ON p.id=a.refund_plan_id
     WHERE (a.payout_id=o.id AND NOT(tr ? 'kind') OR a.residual_operation_id=o.id AND tr->>'kind'='residual')
      AND p.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(prefix))
     ORDER BY (p.allocation->>'cumulativeRefundCents')::bigint,a.id COLLATE "C"
    LOOP
     SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',a.provider_operation_id,'amountCents',p.amount_cents)
       ORDER BY (p.allocation->>'cumulativeRefundCents')::bigint,p.id COLLATE "C"),'[]') INTO x
      FROM marketplace_refund_plans p JOIN marketplace_refund_operations a ON a.refund_plan_id=p.id
      WHERE p.funding_plan_id=funding_id AND p.status='confirmed' AND (p.allocation->>'cumulativeRefundCents')::bigint<
       (SELECT (allocation->>'cumulativeRefundCents')::bigint FROM marketplace_refund_plans WHERE id=v.refund_plan_id);
     raw:=jsonb_build_object('kind','transfer_reversal','provider','stripe','environment',f.environment,'accountFingerprint',account_id,
      'providerPaymentId',f.provider_payment_id,'sourceId',f.budget#>>'{capture,sourceId}','paymentAmountCents',f.amount_cents,
      'amountCents',v.amount_cents,'currency','BRL','previousRefunds',x,
      'reference','mreverse_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,v.refund_plan_id,o.id)),'UTF8')),'hex'),
      'transfer',jsonb_build_object('providerTransferId',o.provider_transfer_id,'destination',o.destination,'amountCents',o.amount_cents,'reference',o.reference)||
       (CASE WHEN tr->>'kind'='residual' THEN jsonb_build_object('kind','residual','requestHash',o.request_hash) ELSE '{}'::jsonb END)||
       (CASE WHEN jsonb_array_length(previous_reversals)>0 THEN jsonb_build_object('previousReversals',previous_reversals) ELSE '{}'::jsonb END));
     expected_request:=raw||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(raw),'UTF8')),'hex'));
     IF v.host_merchant_id IS DISTINCT FROM host_id OR v.provider IS DISTINCT FROM 'stripe' OR v.account_fingerprint IS DISTINCT FROM account_id
      OR v.status IS DISTINCT FROM 'confirmed' OR v.claimed_at IS NULL OR v.reconciled_at IS NULL OR v.provider_operation_id IS NULL
      OR v.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$' OR v.request IS DISTINCT FROM expected_request OR v.request_hash IS DISTINCT FROM expected_request->>'requestHash'
      OR v.reference IS DISTINCT FROM expected_request->>'reference' THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
     previous_reversals:=previous_reversals||jsonb_build_array(jsonb_build_object('providerOperationId',v.provider_operation_id,'amountCents',v.amount_cents,'reference',v.reference,'requestHash',v.request_hash));
    END LOOP;
    expected:=expected||jsonb_build_object('payoutId',o.id,'merchantId',o.beneficiary_merchant_id,'providerTransferId',o.provider_transfer_id,
     'reference',o.reference,'destination',o.destination,'amountCents',o.amount_cents,'reversals',previous_reversals);
    IF tr IS DISTINCT FROM expected OR COALESCE((SELECT sum((value->>'amountCents')::bigint) FROM jsonb_array_elements(previous_reversals)),0)>o.amount_cents THEN
     RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
    expected_transfers:=expected_transfers||jsonb_build_array(expected);
   END LOOP;
   expected_basis:=expected_basis||jsonb_build_object('originalTransfers',expected_transfers);
  END IF;
  IF g.generation>1 THEN expected_basis:=expected_basis||jsonb_build_object('previousGenerations',prior_generations); END IF;
  IF g.basis IS DISTINCT FROM expected_basis OR g.generation=1 AND g.basis->'version' NOT IN ('1'::jsonb,'2'::jsonb)
   OR g.generation>1 AND g.basis->'version' IS DISTINCT FROM '3'::jsonb THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  SELECT sum(amount_cents),sum((allocation->>'platformDebitCents')::bigint) INTO refund_total,platform_debit FROM marketplace_refund_plans
   WHERE id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(prefix));
  beneficiaries:='[]'; total_transferred:=0; payout_total:=0;
  FOR b IN SELECT value FROM jsonb_array_elements(g.allocation->'beneficiaries') LOOP
   SELECT value INTO x FROM jsonb_array_elements(f.budget->'beneficiaries') WHERE value->>'merchantId'=b->>'merchantId';
   IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
   SELECT (x->>'amountCents')::bigint-COALESCE(sum((d->>'amountCents')::bigint),0) INTO remaining
    FROM marketplace_refund_plans p CROSS JOIN LATERAL jsonb_array_elements(p.allocation->'merchantDebits') d
    WHERE p.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(prefix)) AND d->>'merchantId'=b->>'merchantId';
   SELECT COALESCE(sum((value->>'amountCents')::bigint-COALESCE((SELECT sum((z->>'amountCents')::bigint) FROM jsonb_array_elements(value->'reversals') z),0)),0)
    INTO transferred FROM jsonb_array_elements(expected_transfers) WHERE value->>'merchantId'=b->>'merchantId';
   retained:=remaining-transferred;
   IF retained<0 OR transferred<0 THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
   beneficiaries:=beneficiaries||jsonb_build_array(jsonb_build_object('merchantId',x->>'merchantId','destination',x->>'destination',
    'amountCents',retained,'providerFeeCents',x->'providerFeeCents')||CASE WHEN g.basis->'version'<>'1'::jsonb THEN jsonb_build_object('alreadyTransferredCents',transferred) ELSE '{}'::jsonb END);
   payout_total:=payout_total+retained; total_transferred:=total_transferred+transferred;
  END LOOP;
  IF jsonb_array_length(beneficiaries)<>jsonb_array_length(f.budget->'beneficiaries') OR
   (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(beneficiaries))<>jsonb_array_length(beneficiaries) THEN
   RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  expected_allocation:=jsonb_build_object('version',g.basis->'version','capturedNetCents',f.net_amount_cents,'refundedCents',refund_total,
   'platformRetainedCents',f.platform_retained_cents-platform_debit,'payoutTotalCents',payout_total,'beneficiaries',beneficiaries)||
   CASE WHEN g.basis->'version'<>'1'::jsonb THEN jsonb_build_object('alreadyTransferredCents',total_transferred) ELSE '{}'::jsonb END;
  IF g.allocation IS DISTINCT FROM expected_allocation THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  count_expected:=0;
  FOR b IN SELECT value FROM jsonb_array_elements(beneficiaries) WHERE (value->>'amountCents')::bigint>0 LOOP
   count_expected:=count_expected+1;
   SELECT * INTO o FROM marketplace_residual_operations WHERE residual_plan_id=g.id AND beneficiary_merchant_id=b->>'merchantId';
   raw:=jsonb_build_object('provider','stripe','accountFingerprint',account_id,'providerPaymentId',f.provider_payment_id,'destination',b->>'destination',
    'amountCents',b->'amountCents','currency','BRL','reference','mresidual_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,funding_id,g.basis_hash,b->>'merchantId')),'UTF8')),'hex'),
    'capture',f.budget->'capture','remainingTotalCents',payout_total,
    'transfers',(SELECT jsonb_agg(jsonb_build_object('reference','mresidual_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,funding_id,g.basis_hash,value->>'merchantId')),'UTF8')),'hex'),
      'destination',value->>'destination','amountCents',value->'amountCents') ORDER BY ord) FROM jsonb_array_elements(beneficiaries) WITH ORDINALITY items(value,ord) WHERE (value->>'amountCents')::bigint>0),
    'refunds',prefix_receipts)||CASE WHEN g.basis->'version'<>'1'::jsonb THEN jsonb_build_object('version',g.basis->'version','originalTransfers',expected_transfers) ELSE '{}'::jsonb END||
    CASE WHEN g.basis->'version'='3'::jsonb THEN jsonb_build_object('previousGenerations',prior_generations) ELSE '{}'::jsonb END;
   expected_request:=raw||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(raw),'UTF8')),'hex'));
   IF NOT FOUND OR o.status IS DISTINCT FROM 'confirmed' OR o.claimed_at IS NULL OR o.reconciled_at IS NULL OR o.provider_transfer_id IS NULL
    OR o.provider_transfer_id !~ '^tr_[A-Za-z0-9_]+$' OR o.provider IS DISTINCT FROM 'stripe' OR o.account_fingerprint IS DISTINCT FROM account_id
    OR o.amount_cents IS DISTINCT FROM (b->>'amountCents')::integer OR o.reference IS DISTINCT FROM expected_request->>'reference'
    OR o.request IS DISTINCT FROM expected_request OR o.request_hash IS DISTINCT FROM expected_request->>'requestHash' THEN
    RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  END LOOP;
  SELECT count(*) INTO count_actual FROM marketplace_residual_operations WHERE residual_plan_id=g.id;
  IF count_actual<>count_expected THEN RAISE EXCEPTION 'marketplace_native_residual_generation_unproven'; END IF;
  generations:=generations||jsonb_build_array(jsonb_build_object('residualPlanId',g.id,'generation',g.generation,'basisHash',g.basis_hash,'allocationHash',g.allocation_hash));
  previous_frontier:=frontier;
 END LOOP;
 IF jsonb_array_length(generations) NOT BETWEEN 1 AND 2000 OR t.generation>jsonb_array_length(generations)
  OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals reversal_row JOIN marketplace_refund_plans p ON p.id=reversal_row.refund_plan_id
   LEFT JOIN marketplace_refund_operations a ON a.refund_plan_id=p.id WHERE reversal_row.residual_operation_id=target_id
   AND (p.status='confirmed' OR a.status IS NOT NULL AND a.status<>'planned' OR a.claimed_at IS NOT NULL OR a.provider_operation_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'marketplace_native_residual_consumption_unproven'; END IF;
 SELECT sum((value->>'amountCents')::bigint) INTO refund_total FROM jsonb_array_elements(refunds);
 -- Only the exact app marker with already credited V1 reversals is unspent.
 -- A target reversal consumed by any buyer refund was vetoed above, never netted.

 FOR r IN SELECT p.*,u.status AS return_status,u.merchant_id AS return_host,u.order_id,
  z.id AS marker_id,z.status AS marker_status,z.payment_intent_id,z.amount_in_cents,z.provider_refund_id,z.processed_at,
  q.status AS buyer_status,q.claimed_at AS buyer_claimed,q.provider_operation_id AS buyer_receipt
  FROM marketplace_refund_plans p LEFT JOIN returns u ON u.id=p.return_id LEFT JOIN return_refunds z ON z.return_id=p.return_id
  LEFT JOIN marketplace_refund_operations q ON q.refund_plan_id=p.id WHERE p.funding_plan_id=funding_id AND p.status<>'confirmed'
  ORDER BY p.id COLLATE "C"
 LOOP
  IF r.host_merchant_id IS DISTINCT FROM host_id OR r.status NOT IN ('blocked','prepared')
   OR r.block_reason IS DISTINCT FROM 'marketplace_refund_transfer_reversal_required' OR r.return_status::text IS DISTINCT FROM 'INSPECTED_PASS'
   OR r.return_host IS DISTINCT FROM host_id OR NOT(r.order_id=ANY(orders)) OR r.marker_status IS DISTINCT FROM 'PENDING'
   OR r.marker_id IS DISTINCT FROM 'mrefund_return_'||encode(sha256(convert_to(marketplace_recovery_canonical(to_jsonb(r.id)),'UTF8')),'hex')
   OR r.payment_intent_id IS DISTINCT FROM funding_id OR r.amount_in_cents IS DISTINCT FROM r.amount_cents OR r.provider_refund_id IS NOT NULL OR r.processed_at IS NOT NULL
   OR r.buyer_status IS NOT NULL AND r.buyer_status<>'planned' OR r.buyer_claimed IS NOT NULL OR r.buyer_receipt IS NOT NULL
   OR r.allocation->'version' IS DISTINCT FROM '1'::jsonb OR r.allocation->'amountCents' IS DISTINCT FROM to_jsonb(r.amount_cents)
   OR r.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb(refund_total+r.amount_cents)
   OR r.allocation->'requiredContributions' IS DISTINCT FROM '[]'::jsonb
   OR r.allocation_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(r.allocation),'UTF8')),'hex')
   OR jsonb_typeof(r.allocation->'merchantDebits') IS DISTINCT FROM 'array'
   OR jsonb_typeof(r.allocation->'remainingBeneficiaries') IS DISTINCT FROM 'array'
   OR jsonb_array_length(r.allocation->'merchantDebits')<>jsonb_array_length(f.budget->'beneficiaries')
   OR jsonb_array_length(r.allocation->'remainingBeneficiaries')<>jsonb_array_length(f.budget->'beneficiaries')
   OR (SELECT count(*) FROM marketplace_refund_plans WHERE funding_plan_id=funding_id AND status<>'confirmed')<>1
   OR (SELECT jsonb_agg(jsonb_build_object('variantId',variant_id,'quantity',quantity) ORDER BY variant_id COLLATE "C") FROM return_items WHERE return_id=r.return_id)
    IS DISTINCT FROM (SELECT jsonb_agg(jsonb_build_object('variantId',value->>'variantId','quantity',value->'quantity') ORDER BY value->>'variantId' COLLATE "C") FROM jsonb_array_elements(r.allocation->'lines'))
   THEN RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
  -- Reconstruct the complete required set from current entitlement and all
  -- confirmed transfers, including other beneficiaries. A missing marker or
  -- missing V1 credit cannot disappear merely because it is not this target.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'kind','original','beneficiaryMerchantId',a.beneficiary_merchant_id,
    'amountCents',a.amount_cents,'reference',a.reference,'destination',a.destination,'providerTransferId',a.provider_transfer_id)
    ORDER BY a.id COLLATE "C"),'[]') INTO transfers FROM marketplace_payouts a WHERE a.funding_plan_id=funding_id AND a.status='confirmed';
  SELECT transfers||COALESCE(jsonb_agg(jsonb_build_object('id',a.id,'kind','residual','beneficiaryMerchantId',a.beneficiary_merchant_id,
    'amountCents',a.amount_cents,'reference',a.reference,'destination',a.request->>'destination','providerTransferId',a.provider_transfer_id,'requestHash',a.request_hash)
    ORDER BY a.id COLLATE "C"),'[]') INTO transfers FROM marketplace_residual_operations a JOIN marketplace_residual_plans p ON p.id=a.residual_plan_id
    WHERE p.funding_plan_id=funding_id;
  required:='[]';
  FOR b IN SELECT value FROM jsonb_array_elements(f.budget->'beneficiaries') LOOP
   IF (SELECT count(*) FROM jsonb_array_elements(r.allocation->'merchantDebits') d WHERE d->>'merchantId'=b->>'merchantId')<>1
    OR (SELECT count(*) FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') d WHERE d->>'merchantId'=b->>'merchantId')<>1 THEN
    RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
   SELECT (b->>'amountCents')::bigint-COALESCE(sum((d->>'amountCents')::bigint),0) INTO remaining
    FROM marketplace_refund_plans p CROSS JOIN LATERAL jsonb_array_elements(p.allocation->'merchantDebits') d
    WHERE p.funding_plan_id=funding_id AND p.status='confirmed' AND d->>'merchantId'=b->>'merchantId';
   SELECT (value->>'amountCents')::bigint INTO debit FROM jsonb_array_elements(r.allocation->'merchantDebits') WHERE value->>'merchantId'=b->>'merchantId';
   SELECT COALESCE(sum((transfer_entry.value->>'amountCents')::bigint-COALESCE((SELECT sum(a.amount_cents) FROM marketplace_transfer_reversals a
    JOIN marketplace_refund_plans p ON p.id=a.refund_plan_id WHERE p.status='confirmed' AND p.funding_plan_id=funding_id
    AND COALESCE(a.payout_id,a.residual_operation_id)=transfer_entry.value->>'id'),0)),0) INTO retained
    FROM jsonb_array_elements(transfers) AS transfer_entry(value) WHERE transfer_entry.value->>'beneficiaryMerchantId'=b->>'merchantId';
   IF remaining<retained OR remaining-debit<0 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') d
    WHERE d->>'merchantId'=b->>'merchantId' AND d->'amountCents'=to_jsonb(remaining-debit) AND d->'providerFeeCents'=b->'providerFeeCents') THEN
    RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
   needed:=greatest(0,debit-(remaining-retained));
   FOR tr IN SELECT value FROM jsonb_array_elements(transfers) WHERE value->>'beneficiaryMerchantId'=b->>'merchantId' ORDER BY value->>'id' COLLATE "C" LOOP
    SELECT (tr->>'amountCents')::bigint-COALESCE(sum(a.amount_cents),0) INTO retained FROM marketplace_transfer_reversals a JOIN marketplace_refund_plans p ON p.id=a.refund_plan_id
     WHERE p.status='confirmed' AND p.funding_plan_id=funding_id AND COALESCE(a.payout_id,a.residual_operation_id)=tr->>'id';
    IF retained<0 THEN RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
    IF least(needed,retained)>0 THEN required:=required||jsonb_build_array(jsonb_build_object('id',tr->>'id','amountCents',least(needed,retained))); END IF;
    needed:=needed-least(needed,retained);
   END LOOP;
   IF needed<>0 THEN RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
  END LOOP;
  SELECT COALESCE(sum((allocation->>'platformDebitCents')::bigint),0) INTO platform_debit FROM marketplace_refund_plans WHERE funding_plan_id=funding_id AND status='confirmed';
  IF jsonb_array_length(required)=0 OR (SELECT count(*) FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id)<>jsonb_array_length(required)
   OR (SELECT sum((d->>'amountCents')::bigint) FROM jsonb_array_elements(r.allocation->'merchantDebits') d)+(r.allocation->>'platformDebitCents')::bigint<>r.amount_cents
   OR r.allocation->'platformRemainingCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents-platform_debit-(r.allocation->>'platformDebitCents')::bigint) THEN
   RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
  FOR v IN SELECT * FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id ORDER BY id COLLATE "C" LOOP
   SELECT value INTO tr FROM jsonb_array_elements(transfers) WHERE value->>'id'=COALESCE(v.payout_id,v.residual_operation_id);
   IF NOT FOUND OR (v.payout_id IS NULL) IS DISTINCT FROM (tr->>'kind'='residual') OR
    NOT EXISTS(SELECT 1 FROM jsonb_array_elements(required) d WHERE d->>'id'=tr->>'id' AND d->'amountCents'=to_jsonb(v.amount_cents)) THEN
    RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
   marker_target:=jsonb_build_object('kind',tr->>'kind','id',tr->>'id','beneficiaryMerchantId',tr->>'beneficiaryMerchantId','provider','stripe',
    'accountFingerprint',account_id,'providerPaymentId',f.provider_payment_id,'providerTransferId',tr->>'providerTransferId',
    'reference',tr->>'reference','destination',tr->>'destination','amountCents',tr->'amountCents')||
    CASE WHEN tr->>'kind'='residual' THEN jsonb_build_object('requestHash',tr->>'requestHash') ELSE '{}'::jsonb END;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',a.provider_operation_id,'amountCents',a.amount_cents,'reference',a.reference,'requestHash',a.request_hash)
    ORDER BY (p.allocation->>'cumulativeRefundCents')::bigint,a.id COLLATE "C"),'[]') INTO previous_reversals
    FROM marketplace_transfer_reversals a JOIN marketplace_refund_plans p ON p.id=a.refund_plan_id
    WHERE p.funding_plan_id=funding_id AND p.status='confirmed' AND COALESCE(a.payout_id,a.residual_operation_id)=tr->>'id';
   raw:=jsonb_build_object('kind','transfer_reversal','provider','stripe','environment',f.environment,'accountFingerprint',account_id,
    'providerPaymentId',f.provider_payment_id,'sourceId',f.budget#>>'{capture,sourceId}','paymentAmountCents',f.amount_cents,
    'amountCents',v.amount_cents,'currency','BRL','previousRefunds',buyer_receipts,
    'reference','mreverse_'||encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_array(host_id,r.id,tr->>'id')),'UTF8')),'hex'),
    'transfer',jsonb_build_object('providerTransferId',tr->>'providerTransferId','destination',tr->>'destination','amountCents',tr->'amountCents','reference',tr->>'reference')||
     CASE WHEN tr->>'kind'='residual' THEN jsonb_build_object('kind','residual','requestHash',tr->>'requestHash') ELSE '{}'::jsonb END||
     CASE WHEN jsonb_array_length(previous_reversals)>0 THEN jsonb_build_object('previousReversals',previous_reversals) ELSE '{}'::jsonb END);
   expected_request:=raw||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(raw),'UTF8')),'hex'));
   SELECT * INTO c FROM marketplace_transfer_recovery_credits WHERE reversal_id=v.id;
   marker_evidence:=jsonb_build_object('version',1,'reason','chargeback_transfer_principal_credit','fundingPlanId',funding_id,'hostMerchantId',host_id,
    'instructionsHash',f.instructions_hash,'budgetHash',encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex'),
    'chargebackAt',c.evidence->>'chargebackAt','target',marker_target,'reversals',jsonb_build_array(jsonb_build_object('reversalId',v.id,'refundPlanId',r.id,
     'requestHash',v.request_hash,'providerOperationId',v.provider_operation_id,'amountCents',v.amount_cents)));
   IF c.id IS NULL OR v.host_merchant_id IS DISTINCT FROM host_id OR v.provider IS DISTINCT FROM 'stripe' OR v.account_fingerprint IS DISTINCT FROM account_id
    OR v.status IS DISTINCT FROM 'confirmed' OR v.claimed_at IS NULL OR v.reconciled_at IS NULL OR v.provider_operation_id IS NULL OR v.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$'
    OR v.request IS DISTINCT FROM expected_request OR v.request_hash IS DISTINCT FROM expected_request->>'requestHash' OR v.reference IS DISTINCT FROM expected_request->>'reference'
    OR c.funding_plan_id IS DISTINCT FROM funding_id OR c.host_merchant_id IS DISTINCT FROM host_id OR c.payout_id IS DISTINCT FROM v.payout_id
    OR c.residual_operation_id IS DISTINCT FROM v.residual_operation_id OR c.beneficiary_merchant_id IS DISTINCT FROM tr->>'beneficiaryMerchantId'
    OR c.provider IS DISTINCT FROM 'stripe' OR c.account_fingerprint IS DISTINCT FROM account_id OR c.provider_transfer_id IS DISTINCT FROM tr->>'providerTransferId'
    OR c.provider_operation_id IS DISTINCT FROM v.provider_operation_id OR c.amount_cents IS DISTINCT FROM v.amount_cents OR c.evidence IS DISTINCT FROM marker_evidence
    OR c.evidence_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(marker_evidence),'UTF8')),'hex')
    OR ((c.evidence->>'chargebackAt')::timestamptz AT TIME ZONE 'UTC') IS DISTINCT FROM f.chargeback_at THEN RAISE EXCEPTION 'marketplace_native_residual_marker_unproven'; END IF;
   IF v.residual_operation_id=target_id THEN known:=known||jsonb_build_array(jsonb_build_object('providerOperationId',v.provider_operation_id,'amountCents',v.amount_cents,'reference',v.reference,'requestHash',v.request_hash)); END IF;
  END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans p WHERE p.funding_plan_id=funding_id AND p.status NOT IN ('confirmed','blocked','prepared'))
 OR EXISTS(SELECT 1 FROM return_refunds refund_marker LEFT JOIN returns u ON u.id=refund_marker.return_id WHERE
  (refund_marker.payment_intent_id=funding_id OR u.merchant_id=host_id AND u.order_id=ANY(orders))
  AND NOT EXISTS(SELECT 1 FROM marketplace_refund_plans p WHERE p.funding_plan_id=funding_id AND p.return_id=refund_marker.return_id))
 OR EXISTS(SELECT 1 FROM returns u WHERE u.merchant_id=host_id AND u.order_id=ANY(orders) AND u.status::text NOT IN ('REJECTED','CANCELLED')
  AND NOT EXISTS(SELECT 1 FROM marketplace_refund_plans p WHERE p.funding_plan_id=funding_id AND p.return_id=u.id AND p.status IN ('confirmed','blocked','prepared'))) THEN
  RAISE EXCEPTION 'marketplace_native_residual_consumption_unproven'; END IF;
 raw:=jsonb_build_object('version',2,'fundingPlanId',funding_id,'hostMerchantId',host_id,'instructionsHash',f.instructions_hash,
  'budgetHash',encode(sha256(convert_to(marketplace_recovery_canonical(f.budget),'UTF8')),'hex'),'chargebackAt',chargeback_text,
  'environment',f.environment,'sourceId',f.budget#>>'{capture,sourceId}','paymentAmountCents',f.amount_cents,'target',target,
  'residualPlan',jsonb_build_object('id',t.residual_plan_id,'generation',t.generation,'basisHash',t.basis_hash,'allocationHash',t.allocation_hash),
  'refunds',refunds,'generations',generations,'historyHash',encode(sha256(convert_to(marketplace_recovery_canonical(jsonb_build_object('refunds',refunds,'generations',generations)),'UTF8')),'hex'),
  'knownReversals',known);
 RETURN raw||jsonb_build_object('requestHash',encode(sha256(convert_to(marketplace_recovery_canonical(raw),'UTF8')),'hex'));
END $$;

CREATE OR REPLACE FUNCTION marketplace_native_residual_recovery_valid(
 funding_id TEXT,target_id TEXT,host_id TEXT,beneficiary_id TEXT,account_id TEXT,transfer_id TEXT,
 amount INTEGER,evidence JSONB,evidence_hash TEXT,is_credit BOOLEAN,receipt_id TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $$
DECLARE req JSONB; expected JSONB; proof JSONB; receipt JSONB; selected JSONB; credits JSONB; c RECORD;
 total BIGINT:=0; count_receipts INTEGER:=0; principal INTEGER; refunded BIGINT; ids JSONB;
BEGIN
 req:=marketplace_native_residual_request(funding_id,target_id,host_id,beneficiary_id,account_id,transfer_id,evidence->>'chargebackAt');
 principal:=(req#>>'{target,amountCents}')::integer;
 expected:=jsonb_build_object('version',3,'reason',CASE WHEN is_credit THEN 'chargeback_transfer_principal_credit' ELSE 'chargeback_transfer_principal_recovered' END,
  'fundingPlanId',funding_id,'hostMerchantId',host_id,'instructionsHash',req->>'instructionsHash','budgetHash',req->>'budgetHash',
  'chargebackAt',req->>'chargebackAt','target',req->'target');
 IF amount<=0 OR amount>principal OR NOT is_credit AND amount<>principal
  OR (evidence-ARRAY['receipt','proof','credits','request']) IS DISTINCT FROM expected
  OR evidence_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(evidence),'UTF8')),'hex') THEN
  RAISE EXCEPTION 'marketplace_native_residual_evidence_invalid'; END IF;
 IF is_credit THEN
  proof:=evidence->'proof';
  SELECT sum((value->>'amountCents')::bigint),jsonb_agg(value->'providerOperationId' ORDER BY ord) INTO refunded,ids
   FROM jsonb_array_elements(req->'refunds') WITH ORDINALITY items(value,ord);
  IF evidence ? 'credits' OR evidence ? 'request' OR proof->'request' IS DISTINCT FROM req
   OR proof->'refundedAmountCents' IS DISTINCT FROM to_jsonb(refunded) OR proof->'buyerRefundIds' IS DISTINCT FROM ids
   OR proof->>'observedAt' IS NULL OR jsonb_typeof(proof->'receipts') IS DISTINCT FROM 'array'
   OR jsonb_array_length(proof->'receipts') NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'marketplace_native_residual_history_invalid'; END IF;
  IF (proof->>'observedAt')::timestamptz < clock_timestamp()-interval '5 minutes'
   OR (proof->>'observedAt')::timestamptz > clock_timestamp()+interval '5 minutes' THEN
   RAISE EXCEPTION 'marketplace_native_residual_observation_stale'; END IF;
  FOR receipt IN SELECT value FROM jsonb_array_elements(proof->'receipts') LOOP
   IF receipt->>'providerOperationId' IS NULL OR receipt->>'providerOperationId' !~ '^trr_[A-Za-z0-9_]+$'
    OR receipt->>'providerTransferId' IS DISTINCT FROM transfer_id OR receipt->>'balanceTransactionId' IS NULL
    OR receipt->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$' OR receipt->>'balanceSourceId' IS DISTINCT FROM receipt->>'providerOperationId'
    OR receipt->>'balanceType' IS DISTINCT FROM 'transfer_refund' OR receipt->>'balanceStatus' IS DISTINCT FROM 'available'
    OR receipt->>'currency' IS DISTINCT FROM 'BRL' OR receipt->'sourceRefund' IS DISTINCT FROM 'null'::jsonb
    OR receipt->'balanceFeeCents' IS DISTINCT FROM '0'::jsonb OR receipt->'balanceAmountCents' IS DISTINCT FROM receipt->'amountCents'
    OR receipt->'balanceNetCents' IS DISTINCT FROM receipt->'amountCents' OR jsonb_typeof(receipt->'amountCents') IS DISTINCT FROM 'number'
    OR (receipt->>'amountCents')::numeric<=0 OR (receipt->>'amountCents')::numeric>2147483647
    OR (receipt->>'amountCents')::numeric<>trunc((receipt->>'amountCents')::numeric) THEN RAISE EXCEPTION 'marketplace_native_residual_receipt_invalid'; END IF;
   total:=total+(receipt->>'amountCents')::bigint; count_receipts:=count_receipts+1;
   IF receipt->>'providerOperationId'=receipt_id THEN selected:=receipt; END IF;
  END LOOP;
  IF count_receipts<>(SELECT count(DISTINCT value->>'providerOperationId') FROM jsonb_array_elements(proof->'receipts'))
   OR count_receipts<>(SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(proof->'receipts'))
   OR proof->'receipts' IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value->>'providerOperationId' COLLATE "C") FROM jsonb_array_elements(proof->'receipts'))
   OR total>principal OR proof->'providerReversedAmountCents' IS DISTINCT FROM to_jsonb(total)
   OR selected IS NULL OR selected IS DISTINCT FROM evidence->'receipt' OR selected->'amountCents' IS DISTINCT FROM to_jsonb(amount)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE provider='stripe' AND account_fingerprint=account_id AND provider_operation_id=receipt_id)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(req->'knownReversals') k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(proof->'receipts') p
     WHERE p->>'providerOperationId'=k->>'providerOperationId' AND p->'amountCents'=k->'amountCents'))
   OR amount+(SELECT COALESCE(sum(amount_cents),0) FROM marketplace_transfer_recovery_credits WHERE residual_operation_id=target_id)>principal
   THEN RAISE EXCEPTION 'marketplace_native_residual_conservation_invalid'; END IF;
 ELSE
  IF evidence ? 'receipt' OR evidence ? 'proof' OR evidence->'request' IS DISTINCT FROM req THEN RAISE EXCEPTION 'marketplace_native_residual_request_invalid'; END IF;
  SELECT jsonb_agg(jsonb_build_object('creditId',id,'evidenceHash',credit_row.evidence_hash,'providerOperationId',provider_operation_id,'amountCents',amount_cents) ORDER BY id COLLATE "C"),sum(amount_cents)
   INTO credits,total FROM marketplace_transfer_recovery_credits credit_row WHERE residual_operation_id=target_id;
  IF total IS DISTINCT FROM principal::bigint OR evidence->'credits' IS DISTINCT FROM credits THEN RAISE EXCEPTION 'marketplace_native_residual_conservation_invalid'; END IF;
  FOR c IN SELECT * FROM marketplace_transfer_recovery_credits WHERE residual_operation_id=target_id LOOP
   IF c.funding_plan_id IS DISTINCT FROM funding_id OR c.host_merchant_id IS DISTINCT FROM host_id OR c.payout_id IS NOT NULL
    OR c.beneficiary_merchant_id IS DISTINCT FROM beneficiary_id OR c.provider IS DISTINCT FROM 'stripe' OR c.account_fingerprint IS DISTINCT FROM account_id
    OR c.provider_transfer_id IS DISTINCT FROM transfer_id OR c.evidence->'target' IS DISTINCT FROM req->'target'
    OR c.evidence_hash IS DISTINCT FROM encode(sha256(convert_to(marketplace_recovery_canonical(c.evidence),'UTF8')),'hex')
    OR (c.reversal_id IS NOT NULL AND (c.evidence->'version' IS DISTINCT FROM '1'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(req->'knownReversals') k
      WHERE k->>'providerOperationId'=c.provider_operation_id AND k->'amountCents'=to_jsonb(c.amount_cents))))
    OR (c.reversal_id IS NULL AND (c.evidence->'version' IS DISTINCT FROM '3'::jsonb OR c.evidence#>'{proof,request}' IS DISTINCT FROM req)) THEN
    RAISE EXCEPTION 'marketplace_native_residual_conservation_invalid'; END IF;
  END LOOP;
 END IF;
END $$;


-- V1/V2 bodies are preserved verbatim below the new V3 dispatch.
CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; v RECORD; expected_target JSONB; expected_reversals JSONB; total BIGINT := 0; n INTEGER := 0;
BEGIN

 IF NEW.evidence->'version'='3'::jsonb THEN
  IF NEW.provider<>'stripe' OR NEW.payout_id IS NOT NULL OR NEW.residual_operation_id IS NULL THEN RAISE EXCEPTION 'marketplace_native_residual_target_invalid'; END IF;
  PERFORM marketplace_native_residual_recovery_valid(NEW.funding_plan_id,NEW.residual_operation_id,NEW.host_merchant_id,NEW.beneficiary_merchant_id,NEW.account_fingerprint,NEW.provider_transfer_id,NEW.amount_cents,NEW.evidence,NEW.evidence_hash,false);
  RETURN NEW;
 END IF;

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



-- V1/V2 bodies are preserved verbatim below the new V3 dispatch.
CREATE OR REPLACE FUNCTION marketplace_transfer_recovery_credit_insert_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; t RECORD; v RECORD; expected_target JSONB; expected_reversals JSONB; total BIGINT := 0; n INTEGER := 0;
BEGIN

 IF NEW.evidence->'version'='3'::jsonb THEN
  IF NEW.provider<>'stripe' OR NEW.payout_id IS NOT NULL OR NEW.residual_operation_id IS NULL OR NEW.reversal_id IS NOT NULL THEN RAISE EXCEPTION 'marketplace_native_residual_target_invalid'; END IF;
  PERFORM marketplace_native_residual_recovery_valid(NEW.funding_plan_id,NEW.residual_operation_id,NEW.host_merchant_id,NEW.beneficiary_merchant_id,NEW.account_fingerprint,NEW.provider_transfer_id,NEW.amount_cents,NEW.evidence,NEW.evidence_hash,true,NEW.provider_operation_id);
  RETURN NEW;
 END IF;

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
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=funding_row.payment_intent_id AND evidence->'version' IN ('2'::jsonb,'3'::jsonb))
  THEN RAISE EXCEPTION 'marketplace_refund_money_reserved_for_dispute'; END IF;
 END LOOP;
 RETURN NEW;
END $$;

