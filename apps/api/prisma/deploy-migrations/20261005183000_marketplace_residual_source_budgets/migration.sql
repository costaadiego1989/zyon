-- Preserve V1-V3 checks exactly; new money has its own immutable source.
CREATE OR REPLACE FUNCTION marketplace_residual_legacy_allocation_valid(a JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k TEXT; b JSONB; total NUMERIC := 0; transferred NUMERIC := 0; v2 BOOLEAN;
BEGIN
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR a->'version' NOT IN ('1'::jsonb,'2'::jsonb,'3'::jsonb)
   OR a->'version' IS NULL OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 v2 := a->'version' IN ('2'::jsonb,'3'::jsonb);
 FOREACH k IN ARRAY ARRAY['capturedNetCents','refundedCents','platformRetainedCents','payoutTotalCents'] LOOP
   IF jsonb_typeof(a->k) IS DISTINCT FROM 'number' OR (a->>k)::numeric<0 OR (a->>k)::numeric>2147483647 OR trunc((a->>k)::numeric)<>(a->>k)::numeric THEN RETURN false; END IF;
 END LOOP;
 IF v2 AND (jsonb_typeof(a->'alreadyTransferredCents') IS DISTINCT FROM 'number' OR
   (a->>'alreadyTransferredCents')::numeric<0 OR (a->>'alreadyTransferredCents')::numeric>2147483647 OR
   trunc((a->>'alreadyTransferredCents')::numeric)<>(a->>'alreadyTransferredCents')::numeric) THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(a->'beneficiaries') LOOP
   IF jsonb_typeof(b->'merchantId') IS DISTINCT FROM 'string' OR jsonb_typeof(b->'destination') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['amountCents','providerFeeCents'] LOOP
     IF jsonb_typeof(b->k) IS DISTINCT FROM 'number' OR (b->>k)::numeric<0 OR (b->>k)::numeric>2147483647 OR trunc((b->>k)::numeric)<>(b->>k)::numeric THEN RETURN false; END IF;
   END LOOP;
   total := total+(b->>'amountCents')::numeric;
   IF v2 THEN
     IF jsonb_typeof(b->'alreadyTransferredCents') IS DISTINCT FROM 'number' OR
       (b->>'alreadyTransferredCents')::numeric<0 OR (b->>'alreadyTransferredCents')::numeric>2147483647 OR
       trunc((b->>'alreadyTransferredCents')::numeric)<>(b->>'alreadyTransferredCents')::numeric THEN RETURN false; END IF;
     transferred := transferred+(b->>'alreadyTransferredCents')::numeric;
   END IF;
 END LOOP;
 IF (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(a->'beneficiaries'))<>jsonb_array_length(a->'beneficiaries') THEN RETURN false; END IF;
 RETURN (a->>'refundedCents')::numeric>0 AND total=(a->>'payoutTotalCents')::numeric
   AND (NOT v2 OR transferred=(a->>'alreadyTransferredCents')::numeric)
   AND (a->>'capturedNetCents')::numeric=(a->>'refundedCents')::numeric+(a->>'platformRetainedCents')::numeric+total+transferred;
END $$;

ALTER TABLE marketplace_residual_operations ADD COLUMN source_id TEXT NOT NULL DEFAULT 'original';
DROP INDEX marketplace_residual_operations_residual_plan_id_beneficiar_key;
CREATE UNIQUE INDEX marketplace_residual_operations_plan_beneficiary_source_key
 ON marketplace_residual_operations(residual_plan_id,beneficiary_merchant_id,source_id);

CREATE FUNCTION marketplace_residual_source_cents(v jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN COALESCE(jsonb_typeof(v)='number' AND (v#>>'{}')::numeric BETWEEN 0 AND 2147483647
   AND trunc((v#>>'{}')::numeric)=(v#>>'{}')::numeric,false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_residual_allocation_valid(a JSONB) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; b jsonb; s jsonb; x jsonb; total bigint:=0; refunds bigint:=0; retained bigint:=0;
 credits bigint:=0; fees bigint:=0; excess bigint:=0; source_total bigint:=0; merchant_total bigint;
BEGIN
 IF a->'version' IS DISTINCT FROM '4'::jsonb THEN RETURN marketplace_residual_legacy_allocation_valid(a); END IF;
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array'
   OR jsonb_typeof(a->'sources') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'sources') NOT BETWEEN 2 AND 2001
   OR a#>>'{sources,0,sourceId}' IS DISTINCT FROM 'original' THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['capturedNetCents','refundedCents','platformRetainedCents','payoutTotalCents',
   'contributedNetCents','contributionProcessingFeeCents','excessLiabilityCents'] LOOP
   IF NOT marketplace_residual_source_cents(a->k) THEN RETURN false; END IF;
 END LOOP;
 IF (a->>'refundedCents')::bigint<=0 OR (a->>'contributedNetCents')::bigint<=0 THEN RETURN false; END IF;
 IF (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(a->'beneficiaries'))<>jsonb_array_length(a->'beneficiaries')
   OR (SELECT count(DISTINCT value->>'sourceId') FROM jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources')
   OR (SELECT count(DISTINCT value->>'chargeId') FROM jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources')
   OR (SELECT count(DISTINCT value->>'providerPaymentId') FROM jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources')
   OR (SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(a->'sources'))<>jsonb_array_length(a->'sources') THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(a->'beneficiaries') LOOP
   IF jsonb_typeof(b->'merchantId') IS DISTINCT FROM 'string' OR b->>'merchantId'=''
     OR jsonb_typeof(b->'destination') IS DISTINCT FROM 'string'
     OR b->>'destination' !~ '^acct_[A-Za-z0-9_]+$' OR NOT marketplace_residual_source_cents(b->'amountCents')
     OR NOT marketplace_residual_source_cents(b->'providerFeeCents') THEN RETURN false; END IF;
   total:=total+(b->>'amountCents')::bigint;
   SELECT COALESCE(sum((recipient_row.value->>'amountCents')::bigint),0) INTO merchant_total
    FROM jsonb_array_elements(a->'sources') source_row, jsonb_array_elements(source_row.value->'beneficiaries') recipient_row
    WHERE recipient_row.value->>'merchantId'=b->>'merchantId' AND recipient_row.value->>'destination'=b->>'destination';
   IF merchant_total<>(b->>'amountCents')::bigint THEN RETURN false; END IF;
 END LOOP;
 FOR s IN SELECT value FROM jsonb_array_elements(a->'sources') LOOP
   IF jsonb_typeof(s->'sourceId') IS DISTINCT FROM 'string'
     OR NOT (s->>'sourceId'='original' OR s->>'sourceId' ~ '^contribution:[a-f0-9]{64}$')
     OR jsonb_typeof(s->'providerPaymentId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(s->'chargeId') IS DISTINCT FROM 'string'
     OR jsonb_typeof(s->'balanceTransactionId') IS DISTINCT FROM 'string'
     OR s->>'providerPaymentId' !~ '^pi_[A-Za-z0-9_]+$' OR s->>'chargeId' !~ '^ch_[A-Za-z0-9_]+$'
     OR s->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$' OR jsonb_typeof(s->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
   FOREACH k IN ARRAY ARRAY['capturedGrossCents','processingFeeCents','creditedNetCents','refundDebitCents',
     'platformRetainedCents','excessLiabilityCents','payoutTotalCents'] LOOP
     IF NOT marketplace_residual_source_cents(s->k) THEN RETURN false; END IF;
   END LOOP;
   IF (s->>'capturedGrossCents')::bigint<>(s->>'processingFeeCents')::bigint+(s->>'creditedNetCents')::bigint+(s->>'excessLiabilityCents')::bigint
     OR (s->>'creditedNetCents')::bigint<>(s->>'refundDebitCents')::bigint+(s->>'platformRetainedCents')::bigint+(s->>'payoutTotalCents')::bigint THEN RETURN false; END IF;
   IF s->>'sourceId'='original' THEN
     IF s->'creditedNetCents' IS DISTINCT FROM a->'capturedNetCents' OR s->'excessLiabilityCents' IS DISTINCT FROM '0'::jsonb THEN RETURN false; END IF;
   ELSE
     IF s->'platformRetainedCents' IS DISTINCT FROM '0'::jsonb THEN RETURN false; END IF;
     credits:=credits+(s->>'creditedNetCents')::bigint;fees:=fees+(s->>'processingFeeCents')::bigint;
     excess:=excess+(s->>'excessLiabilityCents')::bigint;
   END IF;
   IF (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(s->'beneficiaries'))<>jsonb_array_length(s->'beneficiaries') THEN RETURN false; END IF;
   source_total:=0;
   FOR x IN SELECT value FROM jsonb_array_elements(s->'beneficiaries') LOOP
     IF NOT marketplace_residual_source_cents(x->'amountCents') OR (x->>'amountCents')::bigint<=0
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'beneficiaries') aggregate_recipient WHERE aggregate_recipient.value->>'merchantId'=x->>'merchantId'
       AND aggregate_recipient.value->>'destination'=x->>'destination') THEN RETURN false; END IF;
     source_total:=source_total+(x->>'amountCents')::bigint;
   END LOOP;
   IF source_total<>(s->>'payoutTotalCents')::bigint THEN RETURN false; END IF;
   refunds:=refunds+(s->>'refundDebitCents')::bigint;retained:=retained+(s->>'platformRetainedCents')::bigint;
 END LOOP;
 RETURN total=(a->>'payoutTotalCents')::bigint AND refunds=(a->>'refundedCents')::bigint
   AND retained=(a->>'platformRetainedCents')::bigint AND credits=(a->>'contributedNetCents')::bigint
   AND fees=(a->>'contributionProcessingFeeCents')::bigint AND excess=(a->>'excessLiabilityCents')::bigint
   AND (a->>'capturedNetCents')::bigint+credits=refunds+retained+total;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

ALTER TABLE marketplace_residual_plans DROP CONSTRAINT marketplace_residual_plan_valid;
ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK(COALESCE(
 status IN ('prepared','completed','held') AND generation>0 AND basis_hash ~ '^[a-f0-9]{64}$' AND allocation_hash ~ '^[a-f0-9]{64}$'
 AND jsonb_typeof(basis)='object' AND basis->'version'=allocation->'version'
 AND (generation=1 AND (basis->'version'='1'::jsonb OR basis->'version'='2'::jsonb
   AND jsonb_typeof(basis->'originalTransfers')='array' AND jsonb_array_length(basis->'originalTransfers')>0
   OR basis->'version'='4'::jsonb AND jsonb_typeof(basis#>'{fundingContributions,certificates}')='array'
   AND NOT basis ? 'originalTransfers' AND NOT basis ? 'previousGenerations')
  OR generation>1 AND basis->'version'='3'::jsonb AND jsonb_typeof(basis->'originalTransfers')='array'
   AND jsonb_typeof(basis->'previousGenerations')='array' AND jsonb_array_length(basis->'previousGenerations')=generation-1)
 AND marketplace_residual_allocation_valid(allocation),false));

ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_source_id_valid CHECK(COALESCE(
 source_id='original' AND (NOT request ? 'version' OR request->'version' IN ('2'::jsonb,'3'::jsonb))
 OR request->'version'='4'::jsonb AND request->>'sourceId'=source_id
 AND (source_id='original' OR source_id ~ '^contribution:[a-f0-9]{64}$'),false));

-- Validate persisted source receipts and complete operation inventory at commit.
-- A source is never a current account balance or another order's certificate.
CREATE FUNCTION marketplace_residual_source_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; credit_row record; s jsonb; b jsonb; o record;
 certificates jsonb; projected jsonb; receipt jsonb; prefix jsonb; seq integer:=1; refund_total bigint;
 refund_remaining bigint; debit bigint; expected_ops integer:=0; fee_total bigint:=0; excess_total bigint:=0; credit_total bigint:=0;
 source_transfers jsonb; expected_transfers jsonb; expected_request jsonb; expected_reference text;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN
   SELECT * INTO p FROM marketplace_residual_plans WHERE id=NEW.id;
 ELSE
   SELECT * INTO p FROM marketplace_residual_plans WHERE id=NEW.residual_plan_id;
 END IF;
 IF p.basis->'version' IS DISTINCT FROM '4'::jsonb THEN RETURN NEW; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 IF f.provider IS DISTINCT FROM 'stripe' OR f.host_merchant_id IS DISTINCT FROM p.host_merchant_id OR p.generation<>1
   OR p.basis_hash IS DISTINCT FROM marketplace_contribution_hash(p.basis)
   OR p.allocation_hash IS DISTINCT FROM marketplace_contribution_hash(p.allocation)
   OR p.basis->>'fundingPlanId' IS DISTINCT FROM f.payment_intent_id OR p.basis->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
   OR p.basis->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id AND id<>p.id)
   THEN RAISE EXCEPTION 'marketplace_residual_sources_funding_unproven'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id
   AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL))
   THEN RAISE EXCEPTION 'marketplace_residual_source_prior_transfer_unproven'; END IF;
 SELECT jsonb_agg(c.certificate ORDER BY c.credit_sequence) INTO certificates FROM marketplace_refund_contribution_credits c
   JOIN marketplace_refund_contribution_journals j ON j.id=c.id AND j.status='credited' AND j.certificate_hash=c.certificate_hash
   WHERE c.funding_plan_id=f.payment_intent_id AND c.host_merchant_id=p.host_merchant_id AND c.account_fingerprint=f.account_fingerprint;
 SELECT projected_plan INTO projected FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id ORDER BY credit_sequence DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',r.id,'returnId',r.return_id,'allocationHash',r.allocation_hash,
   'requestHash',refund_operation.request_hash,'providerOperationId',refund_operation.provider_operation_id,'amountCents',r.amount_cents)
   ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id),sum(r.amount_cents) INTO prefix,refund_total
   FROM marketplace_refund_plans r JOIN marketplace_refund_operations refund_operation ON refund_operation.refund_plan_id=r.id
   WHERE r.funding_plan_id=f.payment_intent_id AND r.host_merchant_id=p.host_merchant_id AND r.status='confirmed'
   AND refund_operation.status='confirmed' AND refund_operation.claimed_at IS NOT NULL AND refund_operation.reconciled_at IS NOT NULL AND refund_operation.provider_operation_id IS NOT NULL;
 IF certificates IS NULL OR p.basis#>'{fundingContributions,certificates}' IS DISTINCT FROM certificates
   OR jsonb_array_length(certificates)+1<>jsonb_array_length(p.allocation->'sources')
   OR projected->'fullyFunded' IS DISTINCT FROM 'true'::jsonb OR projected->>'planHash' IS DISTINCT FROM p.basis#>>'{fundingContributions,planHash}'
   OR projected->'contributedNetCents' IS DISTINCT FROM p.basis#>'{fundingContributions,contributedNetCents}'
   OR p.basis->'refunds' IS DISTINCT FROM prefix OR refund_total IS DISTINCT FROM (p.allocation->>'refundedCents')::bigint
   OR projected->'cumulativeRefundCents' IS DISTINCT FROM p.allocation->'refundedCents'
   OR projected->'platformRemainingCents' IS DISTINCT FROM p.allocation->'platformRetainedCents'
   OR EXISTS(SELECT 1 FROM marketplace_refund_plans r WHERE r.funding_plan_id=f.payment_intent_id AND r.status<>'confirmed')
   THEN RAISE EXCEPTION 'marketplace_residual_sources_certificates_unproven'; END IF;
 IF jsonb_array_length(projected->'remainingBeneficiaries')<>jsonb_array_length(p.allocation->'beneficiaries') THEN RAISE EXCEPTION 'marketplace_residual_sources_beneficiaries_unproven'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projected->'remainingBeneficiaries') x
     WHERE x.value->>'merchantId'=b->>'merchantId' AND x.value->'amountCents'=b->'amountCents' AND x.value->'providerFeeCents'=b->'providerFeeCents')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') x
     WHERE x.value->>'merchantId'=b->>'merchantId' AND x.value->>'destination'=b->>'destination') THEN RAISE EXCEPTION 'marketplace_residual_sources_beneficiaries_unproven'; END IF;
 END LOOP;
 s:=p.allocation#>'{sources,0}';
 debit:=LEAST(refund_total,f.net_amount_cents);refund_remaining:=refund_total-debit;
 IF s->>'sourceId' IS DISTINCT FROM 'original' OR s->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id
   OR s->>'chargeId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}' OR s->>'balanceTransactionId' IS DISTINCT FROM f.budget#>>'{capture,balanceTransactionId}'
   OR s->'capturedGrossCents' IS DISTINCT FROM to_jsonb(f.amount_cents) OR s->'processingFeeCents' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR s->'creditedNetCents' IS DISTINCT FROM to_jsonb(f.net_amount_cents) OR s->'refundDebitCents' IS DISTINCT FROM to_jsonb(debit)
   OR s->'platformRetainedCents' IS DISTINCT FROM p.allocation->'platformRetainedCents' THEN RAISE EXCEPTION 'marketplace_residual_original_source_unproven'; END IF;
 FOR credit_row IN SELECT * FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id ORDER BY credit_sequence LOOP
   s:=p.allocation->'sources'->seq;receipt:=credit_row.certificate;debit:=LEAST(refund_remaining,credit_row.credit_cents);refund_remaining:=refund_remaining-debit;
   IF s->>'sourceId' IS DISTINCT FROM 'contribution:'||credit_row.certificate_hash OR s->>'providerPaymentId' IS DISTINCT FROM credit_row.provider_payment_intent_id
     OR s->>'chargeId' IS DISTINCT FROM credit_row.provider_charge_id OR s->>'balanceTransactionId' IS DISTINCT FROM credit_row.provider_balance_transaction_id
     OR s->'capturedGrossCents' IS DISTINCT FROM receipt#>'{proof,balance,amountCents}' OR s->'processingFeeCents' IS DISTINCT FROM to_jsonb(credit_row.processing_fee_cents)
     OR s->'creditedNetCents' IS DISTINCT FROM to_jsonb(credit_row.credit_cents) OR s->'refundDebitCents' IS DISTINCT FROM to_jsonb(debit)
     OR (s->>'excessLiabilityCents')::bigint IS DISTINCT FROM COALESCE((receipt->>'excessLiabilityCents')::bigint,0)
     THEN RAISE EXCEPTION 'marketplace_residual_contribution_source_unproven'; END IF;
   credit_total:=credit_total+credit_row.credit_cents;fee_total:=fee_total+credit_row.processing_fee_cents;
   excess_total:=excess_total+COALESCE((receipt->>'excessLiabilityCents')::bigint,0);seq:=seq+1;
 END LOOP;
 IF refund_remaining<>0 OR p.allocation->'contributedNetCents' IS DISTINCT FROM to_jsonb(credit_total)
   OR p.allocation->'contributionProcessingFeeCents' IS DISTINCT FROM to_jsonb(fee_total)
   OR p.allocation->'excessLiabilityCents' IS DISTINCT FROM to_jsonb(excess_total) THEN RAISE EXCEPTION 'marketplace_residual_sources_budget_unproven'; END IF;
 SELECT jsonb_agg(jsonb_build_object('sourceId',src.value->'sourceId','transfers',
   (SELECT COALESCE(jsonb_agg(jsonb_build_object('reference','mresidual_'||marketplace_contribution_hash(jsonb_build_array(
     f.host_merchant_id,f.payment_intent_id,p.basis_hash,src.value->>'sourceId',ben.value->>'merchantId')),
     'destination',ben.value->'destination','amountCents',ben.value->'amountCents') ORDER BY ben.ord),'[]'::jsonb)
    FROM jsonb_array_elements(src.value->'beneficiaries') WITH ORDINALITY ben(value,ord))) ORDER BY src.ord) INTO source_transfers
   FROM jsonb_array_elements(p.allocation->'sources') WITH ORDINALITY src(value,ord);
 FOR s IN SELECT value FROM jsonb_array_elements(p.allocation->'sources') LOOP
   SELECT value->'transfers' INTO expected_transfers FROM jsonb_array_elements(source_transfers) WHERE value->>'sourceId'=s->>'sourceId';
   FOR b IN SELECT value FROM jsonb_array_elements(s->'beneficiaries') LOOP
     expected_ops:=expected_ops+1;
     SELECT * INTO o FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND source_id=s->>'sourceId' AND beneficiary_merchant_id=b->>'merchantId';
     expected_reference:='mresidual_'||marketplace_contribution_hash(jsonb_build_array(f.host_merchant_id,f.payment_intent_id,p.basis_hash,s->>'sourceId',b->>'merchantId'));
     expected_request:=jsonb_build_object('version',4,'provider','stripe','accountFingerprint',f.account_fingerprint,
       'providerPaymentId',f.provider_payment_id,'destination',b->'destination','amountCents',b->'amountCents','currency','BRL',
       'reference',expected_reference,'capture',f.budget->'capture','sourceId',s->'sourceId','sourceAllocation',p.allocation,
       'fundingContributions',p.basis->'fundingContributions','sourceTransfers',source_transfers,'remainingTotalCents',s->'payoutTotalCents',
       'transfers',expected_transfers,'refunds',(SELECT jsonb_agg(jsonb_build_object('providerOperationId',value->'providerOperationId',
         'amountCents',value->'amountCents') ORDER BY ord) FROM jsonb_array_elements(p.basis->'refunds') WITH ORDINALITY refunds(value,ord)));
     IF NOT FOUND OR o.provider IS DISTINCT FROM f.provider OR o.account_fingerprint IS DISTINCT FROM f.account_fingerprint
       OR o.amount_cents IS DISTINCT FROM (b->>'amountCents')::integer OR o.request->'version' IS DISTINCT FROM '4'::jsonb
       OR o.request->>'sourceId' IS DISTINCT FROM o.source_id OR o.request->'sourceAllocation' IS DISTINCT FROM p.allocation
       OR o.request->'fundingContributions' IS DISTINCT FROM p.basis->'fundingContributions'
       OR o.request->'capture' IS DISTINCT FROM f.budget->'capture' OR o.request->>'destination' IS DISTINCT FROM b->>'destination'
       OR o.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id
       OR o.request->'remainingTotalCents' IS DISTINCT FROM s->'payoutTotalCents'
       OR o.reference IS DISTINCT FROM expected_reference
       OR o.request IS DISTINCT FROM expected_request||jsonb_build_object('requestHash',marketplace_contribution_hash(expected_request))
       OR o.request_hash IS DISTINCT FROM marketplace_contribution_hash(o.request-'requestHash')
       THEN RAISE EXCEPTION 'marketplace_residual_source_operation_unproven'; END IF;
   END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=p.id)<>expected_ops THEN RAISE EXCEPTION 'marketplace_residual_source_operation_inventory_invalid'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_residual_source_plan_guard AFTER INSERT OR UPDATE ON marketplace_residual_plans
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_residual_source_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_residual_source_operation_guard AFTER INSERT OR UPDATE ON marketplace_residual_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_residual_source_commit_guard();

-- V4 journals are durable evidence, including a full refund with zero payouts.
-- Schema disposal does not execute these row triggers; history cannot be erased.
CREATE FUNCTION marketplace_residual_source_deny_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN
   IF OLD.basis->'version'='4'::jsonb THEN RAISE EXCEPTION 'marketplace_residual_source_journal_immutable'; END IF;
 ELSE
   IF OLD.request->'version'='4'::jsonb THEN RAISE EXCEPTION 'marketplace_residual_source_journal_immutable'; END IF;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER marketplace_residual_source_plan_delete_guard BEFORE DELETE ON marketplace_residual_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_residual_source_deny_delete();
CREATE TRIGGER marketplace_residual_source_operation_delete_guard BEFORE DELETE ON marketplace_residual_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_residual_source_deny_delete();
