-- Stripe V6 generation2: only initially certified sources, after a receipted V4
-- refund. Previously paid balances never become another payout. No fresh fee
-- funding, debt release, dispute composition or arbitrary platform balance.
CREATE TABLE marketplace_stripe_residual_generation_proofs (
 operation_id text PRIMARY KEY,
 residual_plan_id text NOT NULL UNIQUE REFERENCES marketplace_residual_plans(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 request jsonb NOT NULL,request_hash text NOT NULL UNIQUE,reference text NOT NULL UNIQUE,
 status text NOT NULL DEFAULT 'planned',version integer NOT NULL DEFAULT 0,
 claimed_at timestamptz,reconciled_at timestamptz,proof jsonb,proof_hash text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT marketplace_stripe_successive_generation_shape CHECK(COALESCE(
  status IN ('planned','unknown','confirmed') AND version>=0 AND request_hash ~ '^[a-f0-9]{64}$'
  AND request->>'requestHash'=request_hash AND marketplace_contribution_hash(request-'requestHash')=request_hash
  AND request->>'reference'=reference AND request->>'kind'='stripe_v4_successive_residual_certification'
  AND request->'version'='1'::jsonb AND request->'generation'='2'::jsonb
  AND request->>'hostMerchantId'=host_merchant_id AND request->>'fundingPlanId'=funding_plan_id
  AND request->>'residualPlanId'=residual_plan_id AND request->>'provider'='stripe'
  AND (status='planned' AND claimed_at IS NULL AND reconciled_at IS NULL AND proof IS NULL AND proof_hash IS NULL AND version=0
    OR status='unknown' AND claimed_at IS NOT NULL AND proof IS NULL AND proof_hash IS NULL AND version>=1
    OR status='confirmed' AND claimed_at IS NOT NULL AND reconciled_at IS NOT NULL AND proof IS NOT NULL
      AND proof_hash=marketplace_contribution_hash(proof-'proofHash') AND proof->>'proofHash'=proof_hash AND version>=2),false))
);
CREATE INDEX marketplace_stripe_successive_unresolved ON marketplace_stripe_residual_generation_proofs(status,created_at);

CREATE FUNCTION marketplace_stripe_successive_net_transferred(b jsonb, source_id text DEFAULT NULL, merchant_id text DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE operation jsonb; history jsonb; reversal jsonb; amount bigint; total bigint:=0;
BEGIN
 FOR operation IN SELECT value FROM jsonb_array_elements(b#>'{sourceRefundFunding,context,residual,operations}') LOOP
  IF (source_id IS NULL OR operation->>'sourceId'=source_id) AND (merchant_id IS NULL OR operation->>'merchantId'=merchant_id) THEN
   amount:=(operation#>>'{request,amountCents}')::bigint;
   FOR history IN SELECT value FROM jsonb_array_elements(b#>'{sourceRefundFunding,context,history}') LOOP
    FOR reversal IN SELECT value FROM jsonb_array_elements(history->'reversals') LOOP
     IF reversal->>'payoutId'=operation->>'operationId' THEN amount:=amount-(reversal->>'amountCents')::bigint; END IF;
    END LOOP;
   END LOOP;
   FOR reversal IN SELECT value FROM jsonb_array_elements(b#>'{completedRefund,reversals}') LOOP
    IF reversal->>'payoutId'=operation->>'operationId' THEN amount:=amount-(reversal->>'amountCents')::bigint; END IF;
   END LOOP;
   IF amount<0 THEN RETURN NULL; END IF;
   total:=total+amount;
  END IF;
 END LOOP;
 RETURN total;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_stripe_successive_residual_expected_allocation(b jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=b#>'{sourceRefundFunding,context}'; plan jsonb:=b#>'{sourceRefundFunding,plan}'; initial jsonb:=c#>'{residual,allocation}';
 source jsonb; state jsonb; budget_beneficiary jsonb; sources jsonb:='[]'; beneficiaries jsonb:='[]'; cash jsonb; sent bigint;
 gross bigint; amount bigint; source_total bigint:=0; already_total bigint:=0; merchant_total bigint; seq integer:=0;
BEGIN
 IF b->'version' IS DISTINCT FROM '6'::jsonb OR b->>'kind' IS DISTINCT FROM 'stripe_v4_successive_residual'
  OR NOT marketplace_stripe_source_refund_replay_valid(b->'sourceRefundFunding') THEN RETURN NULL; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(initial->'sources') LOOP
  state:=plan->'sources'->seq;seq:=seq+1;
  IF state->>'sourceId' IS DISTINCT FROM source->>'sourceId' OR state->>'chargeId' IS DISTINCT FROM source->>'chargeId' THEN RETURN NULL; END IF;
  sent:=marketplace_stripe_successive_net_transferred(b,source->>'sourceId');
  SELECT COALESCE(sum((value#>>'{request,amountCents}')::bigint),0) INTO gross
   FROM jsonb_array_elements(c#>'{residual,operations}') WHERE value->>'sourceId'=source->>'sourceId';
  SELECT COALESCE(jsonb_agg(jsonb_build_object('merchantId',balance.value->'merchantId','destination',destination.value->'destination',
    'amountCents',balance.value->'availableAfterCents') ORDER BY balance.value->>'merchantId' COLLATE "C"),'[]'::jsonb),
    COALESCE(sum((balance.value->>'availableAfterCents')::bigint),0) INTO cash,amount
   FROM jsonb_array_elements(state->'beneficiaryBalances') balance JOIN jsonb_array_elements(c#>'{basis,budget,beneficiaries}') destination
    ON destination.value->>'merchantId'=balance.value->>'merchantId' WHERE (balance.value->>'availableAfterCents')::bigint>0;
  IF sent IS NULL OR sent<>(state->>'netTransferredBeforeCents')::bigint-(state->>'reversalCents')::bigint
   OR amount<>(state->>'availableAfterCents')::bigint OR gross+amount>(source->>'capturedGrossCents')::bigint
   OR (source->>'creditedNetCents')::bigint<>(state->>'refundedAfterCents')::bigint+(state->>'platformAfterCents')::bigint+sent+amount THEN RETURN NULL; END IF;
  sources:=sources||jsonb_build_array(jsonb_build_object('sourceId',source->'sourceId','chargeId',source->'chargeId',
   'balanceTransactionId',source->'balanceTransactionId','capturedGrossCents',source->'capturedGrossCents','processingFeeCents',source->'processingFeeCents',
   'creditedNetCents',source->'creditedNetCents','refundedCents',state->'refundedAfterCents','platformRetainedCents',state->'platformAfterCents',
   'grossTransferredCents',gross,'alreadyTransferredCents',sent,'availableCents',amount,'payoutTotalCents',amount,'beneficiaries',cash));
  source_total:=source_total+amount;already_total:=already_total+sent;
 END LOOP;
 FOR budget_beneficiary IN SELECT value FROM jsonb_array_elements(c#>'{basis,budget,beneficiaries}') ORDER BY value->>'merchantId' COLLATE "C" LOOP
  SELECT COALESCE(sum((recipient.value->>'amountCents')::bigint),0) INTO merchant_total
   FROM jsonb_array_elements(sources) source_row CROSS JOIN LATERAL jsonb_array_elements(source_row.value->'beneficiaries') recipient
   WHERE recipient.value->>'merchantId'=budget_beneficiary->>'merchantId';
  sent:=marketplace_stripe_successive_net_transferred(b,NULL,budget_beneficiary->>'merchantId');
  beneficiaries:=beneficiaries||jsonb_build_array(jsonb_build_object('merchantId',budget_beneficiary->'merchantId','destination',budget_beneficiary->'destination',
   'amountCents',merchant_total,'providerFeeCents',budget_beneficiary->'providerFeeCents','alreadyTransferredCents',sent,
   'remainingEntitlementCents',sent+merchant_total));
 END LOOP;
 RETURN jsonb_build_object('version',6,'kind','stripe_v4_successive_residual','capturedNetCents',c#>'{basis,budget,capture,netAmountCents}',
  'contributedNetCents',initial->'contributedNetCents','contributionProcessingFeeCents',initial->'contributionProcessingFeeCents',
  'excessLiabilityCents',initial->'excessLiabilityCents','refundedCents',plan->'cumulativeRefundCents',
  'platformRetainedCents',(SELECT COALESCE(sum((value->>'platformRetainedCents')::bigint),0) FROM jsonb_array_elements(sources)),
  'alreadyTransferredCents',already_total,'payoutTotalCents',source_total,'beneficiaries',beneficiaries,'sources',sources);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_stripe_successive_residual_allocation_valid(a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE k text; source jsonb; beneficiary jsonb; paid bigint:=0; cash bigint:=0; refunds bigint:=0; retained bigint:=0;
BEGIN
 IF a->'version' IS DISTINCT FROM '6'::jsonb OR a->>'kind' IS DISTINCT FROM 'stripe_v4_successive_residual'
  OR jsonb_typeof(a->'sources') IS DISTINCT FROM 'array' OR jsonb_typeof(a->'beneficiaries') IS DISTINCT FROM 'array'
  OR jsonb_array_length(a->'sources') NOT BETWEEN 2 AND 2001 THEN RETURN false; END IF;
 FOREACH k IN ARRAY ARRAY['capturedNetCents','contributedNetCents','contributionProcessingFeeCents','excessLiabilityCents',
  'refundedCents','platformRetainedCents','alreadyTransferredCents','payoutTotalCents'] LOOP
  IF NOT marketplace_residual_source_cents(a->k) THEN RETURN false; END IF;
 END LOOP;
 FOR source IN SELECT value FROM jsonb_array_elements(a->'sources') LOOP
  IF jsonb_typeof(source->'sourceId') IS DISTINCT FROM 'string' OR NOT(source->>'sourceId'='original' OR source->>'sourceId' ~ '^contribution:[a-f0-9]{64}$')
   OR jsonb_typeof(source->'chargeId') IS DISTINCT FROM 'string' OR source->>'chargeId' !~ '^ch_[A-Za-z0-9_]+$'
   OR jsonb_typeof(source->'balanceTransactionId') IS DISTINCT FROM 'string' OR source->>'balanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$'
   OR jsonb_typeof(source->'beneficiaries') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOREACH k IN ARRAY ARRAY['capturedGrossCents','processingFeeCents','creditedNetCents','refundedCents','platformRetainedCents',
   'grossTransferredCents','alreadyTransferredCents','availableCents','payoutTotalCents'] LOOP
   IF NOT marketplace_residual_source_cents(source->k) THEN RETURN false; END IF;
  END LOOP;
  IF (source->>'creditedNetCents')::bigint<>(source->>'refundedCents')::bigint+(source->>'platformRetainedCents')::bigint+
    (source->>'alreadyTransferredCents')::bigint+(source->>'payoutTotalCents')::bigint
   OR source->'availableCents' IS DISTINCT FROM source->'payoutTotalCents'
   OR (source->>'grossTransferredCents')::bigint+(source->>'payoutTotalCents')::bigint>(source->>'capturedGrossCents')::bigint THEN RETURN false; END IF;
  paid:=paid+(source->>'alreadyTransferredCents')::bigint;cash:=cash+(source->>'payoutTotalCents')::bigint;
  refunds:=refunds+(source->>'refundedCents')::bigint;retained:=retained+(source->>'platformRetainedCents')::bigint;
 END LOOP;
 FOR beneficiary IN SELECT value FROM jsonb_array_elements(a->'beneficiaries') LOOP
  FOREACH k IN ARRAY ARRAY['amountCents','providerFeeCents','alreadyTransferredCents','remainingEntitlementCents'] LOOP
   IF NOT marketplace_residual_source_cents(beneficiary->k) THEN RETURN false; END IF;
  END LOOP;
  IF (beneficiary->>'remainingEntitlementCents')::bigint<>(beneficiary->>'amountCents')::bigint+(beneficiary->>'alreadyTransferredCents')::bigint THEN RETURN false; END IF;
 END LOOP;
 RETURN paid=(a->>'alreadyTransferredCents')::bigint AND cash=(a->>'payoutTotalCents')::bigint AND refunds=(a->>'refundedCents')::bigint
  AND retained=(a->>'platformRetainedCents')::bigint AND paid+cash+refunds+retained=(a->>'capturedNetCents')::bigint+(a->>'contributedNetCents')::bigint;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_stripe_successive_residual_basis_valid(b jsonb, admission boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=b#>'{sourceRefundFunding,context}'; funding jsonb:=b->'sourceRefundFunding'; f marketplace_funding_plans;
 current_refund marketplace_refund_plans; current_operation marketplace_refund_operations; initial marketplace_residual_plans;
 expected_receipt jsonb; actual_refunds jsonb; actual_reversals jsonb; required jsonb; reversal marketplace_transfer_reversals; expected jsonb;
 ev outbox_messages; allocation jsonb;
BEGIN
 IF b->'version' IS DISTINCT FROM '6'::jsonb OR b->>'kind' IS DISTINCT FROM 'stripe_v4_successive_residual'
  OR NOT marketplace_stripe_source_refund_evidence_valid(funding,false) THEN RETURN false; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=b->>'fundingPlanId';
 SELECT * INTO current_refund FROM marketplace_refund_plans WHERE id=c->>'refundPlanId';
 SELECT * INTO current_operation FROM marketplace_refund_operations WHERE refund_plan_id=current_refund.id;
 SELECT * INTO initial FROM marketplace_residual_plans WHERE id=c#>>'{residual,residualPlanId}';
 IF f.payment_intent_id IS NULL OR initial.id IS NULL OR current_refund.status IS DISTINCT FROM 'confirmed'
  OR current_operation.status IS DISTINCT FROM 'confirmed' OR current_operation.claimed_at IS NULL OR current_operation.reconciled_at IS NULL
  OR current_operation.provider_operation_id IS NULL OR current_operation.provider_operation_id !~ '^re_[A-Za-z0-9_]+$'
  OR current_operation.request IS DISTINCT FROM marketplace_stripe_source_refund_expected_request(funding)
  OR b->>'instructionsHash' IS DISTINCT FROM f.instructions_hash OR b->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
  OR current_refund.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR current_refund.host_merchant_id IS DISTINCT FROM f.host_merchant_id
  OR b->'previousGenerations' IS DISTINCT FROM jsonb_build_array(jsonb_build_object('residualPlanId',initial.id,'generation',1,
    'basisHash',initial.basis_hash,'allocationHash',initial.allocation_hash))
  OR EXISTS(SELECT 1 FROM marketplace_residual_plans p WHERE p.funding_plan_id=f.payment_intent_id AND p.id<>initial.id AND
    (p.generation<>2 OR p.basis->'version' IS DISTINCT FROM '6'::jsonb OR p.basis IS DISTINCT FROM b))
  OR EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE funding_plan_id=f.payment_intent_id AND status<>'confirmed') THEN RETURN false; END IF;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',r.id,'returnId',r.return_id,'allocationHash',r.allocation_hash,'requestHash',o.request_hash,
  'providerOperationId',o.provider_operation_id,'amountCents',r.amount_cents) ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id COLLATE "C")
  INTO actual_refunds FROM marketplace_refund_plans r JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id
  WHERE r.funding_plan_id=f.payment_intent_id AND r.status='confirmed' AND o.status='confirmed';
 IF actual_refunds IS DISTINCT FROM b->'refunds' OR b#>>'{refunds,-1,refundPlanId}' IS DISTINCT FROM current_refund.id THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('payoutId',r.residual_operation_id,'providerOperationId',r.provider_operation_id,'amountCents',r.amount_cents,
  'reference',r.reference,'requestHash',r.request_hash) ORDER BY r.residual_operation_id COLLATE "C"),'[]'::jsonb) INTO actual_reversals
  FROM marketplace_transfer_reversals r WHERE r.refund_plan_id=current_refund.id;
 expected_receipt:=jsonb_build_object('refundPlanId',current_refund.id,'returnId',current_refund.return_id,
  'providerOperationId',current_operation.provider_operation_id,'planHash',funding#>'{plan,planHash}',
  'requestHash',current_operation.request_hash,'amountCents',current_refund.amount_cents,'reversals',actual_reversals);
 IF expected_receipt IS DISTINCT FROM b->'completedRefund' OR jsonb_array_length(actual_reversals)<>jsonb_array_length(funding#>'{plan,requiredReversals}')
  OR NOT EXISTS(SELECT 1 FROM return_refunds WHERE return_id=current_refund.return_id AND status='COMPLETED'
    AND id='mrefund_return_'||marketplace_contribution_hash(to_jsonb(current_refund.id)) AND provider_refund_id=current_operation.provider_operation_id
    AND payment_intent_id=f.payment_intent_id AND amount_in_cents=current_refund.amount_cents) THEN RETURN false; END IF;
 FOR required IN SELECT value FROM jsonb_array_elements(funding#>'{plan,requiredReversals}') LOOP
  SELECT * INTO reversal FROM marketplace_transfer_reversals WHERE refund_plan_id=current_refund.id AND residual_operation_id=required->>'payoutId';
  expected:=marketplace_stripe_source_refund_expected_request(funding,required->>'payoutId');
  IF reversal.id IS NULL OR reversal.status<>'confirmed' OR reversal.claimed_at IS NULL OR reversal.reconciled_at IS NULL
   OR reversal.provider_operation_id IS NULL OR reversal.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$' OR reversal.payout_id IS NOT NULL
   OR reversal.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR reversal.provider IS DISTINCT FROM 'stripe'
   OR reversal.account_fingerprint IS DISTINCT FROM f.account_fingerprint OR reversal.amount_cents IS DISTINCT FROM (required->>'amountCents')::integer
   OR reversal.request IS DISTINCT FROM expected OR reversal.request_hash IS DISTINCT FROM expected->>'requestHash' OR reversal.reference IS DISTINCT FROM expected->>'reference'
   THEN RETURN false; END IF;
  SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_reversal_'||reversal.id;
  expected:=jsonb_build_object('reversal_operation_id',reversal.id,'refund_plan_id',current_refund.id,'payout_id',NULL,
    'residual_operation_id',reversal.residual_operation_id,'amount_cents',reversal.amount_cents,
    'provider_reversal_id',reversal.provider_operation_id,'request_hash',reversal.request_hash);
  IF ev.event_type IS DISTINCT FROM 'marketplace.transfer_reversal.confirmed' OR ev.merchant_id IS DISTINCT FROM f.host_merchant_id
   OR ev.correlation_id IS DISTINCT FROM current_refund.id OR ev.causation_id IS DISTINCT FROM reversal.residual_operation_id
   OR ev.producer IS DISTINCT FROM 'marketplace' OR ev.schema_version IS DISTINCT FROM 1 OR ev.payload IS DISTINCT FROM expected THEN RETURN false; END IF;
 END LOOP;
 SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_refund_'||current_refund.id;
 expected:=jsonb_build_object('refund_plan_id',current_refund.id,'return_id',current_refund.return_id,'payment_intent_id',f.payment_intent_id,
  'order_id',f.provider_payment_id,'amount_cents',current_refund.amount_cents,'cumulative_refund_cents',current_refund.allocation->'cumulativeRefundCents',
  'allocation_hash',current_refund.allocation_hash,'provider_refund_id',current_operation.provider_operation_id);
 IF ev.event_type IS DISTINCT FROM 'marketplace.refund.confirmed' OR ev.merchant_id IS DISTINCT FROM f.host_merchant_id OR ev.correlation_id IS DISTINCT FROM f.payment_intent_id
  OR ev.causation_id IS DISTINCT FROM current_refund.return_id OR ev.producer IS DISTINCT FROM 'marketplace' OR ev.schema_version IS DISTINCT FROM 1
  OR ev.payload IS DISTINCT FROM expected THEN RETURN false; END IF;
 allocation:=marketplace_stripe_successive_residual_expected_allocation(b);
 IF allocation IS NULL OR NOT marketplace_stripe_successive_residual_allocation_valid(allocation) THEN RETURN false; END IF;
 IF admission AND (initial.status<>'completed' OR initial.held_reason IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id AND purchased_at IS NOT NULL AND chargeback_at IS NULL)
  OR EXISTS(SELECT 1 FROM outbox_messages WHERE merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id AND event_type='marketplace.financial_reconciliation_required')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_seller_debts d ON d.seller_merchant_id=b.value->>'merchantId' AND d.status='outstanding')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_host_debts d ON d.host_merchant_id=b.value->>'merchantId' AND d.status='outstanding')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE marketplace_stripe_source_beneficiary_exposed(b.value->>'merchantId'))
  OR EXISTS(SELECT 1 FROM returns r WHERE r.merchant_id=f.host_merchant_id AND r.status::text NOT IN ('REJECTED','CANCELLED')
    AND (r.order_id=f.provider_payment_id OR EXISTS(SELECT 1 FROM payment_intents pi WHERE pi.id=f.payment_intent_id AND r.order_id=pi.commerce_order_id)
      OR EXISTS(SELECT 1 FROM completed_orders completed JOIN payment_intents pi ON pi.id=f.payment_intent_id WHERE completed.merchant_id=f.host_merchant_id
       AND r.order_id=completed.id AND (completed.external_order_id=f.provider_payment_id OR completed.session_id=pi.session_id)))
    AND NOT EXISTS(SELECT 1 FROM marketplace_refund_plans refunded WHERE refunded.funding_plan_id=f.payment_intent_id AND refunded.return_id=r.id))) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Keep installed V1-V5 dispatch, extending the named readonly validator only.
CREATE OR REPLACE FUNCTION marketplace_residual_allocation_valid(a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN a->'version'='6'::jsonb THEN marketplace_stripe_successive_residual_allocation_valid(a)
  WHEN a->'version'='5'::jsonb THEN marketplace_asaas_residual_allocation_valid(a)
  ELSE marketplace_residual_v1_v4_allocation_valid(a) END
$$;

CREATE FUNCTION marketplace_stripe_successive_residual_expected_request(b jsonb, source_id text, merchant_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE allocation jsonb:=marketplace_stripe_successive_residual_expected_allocation(b); source jsonb; beneficiary jsonb;
 c jsonb:=b#>'{sourceRefundFunding,context}'; raw jsonb; reference text; basis_hash text:=marketplace_contribution_hash(b); transfers jsonb;
BEGIN
 SELECT value INTO source FROM jsonb_array_elements(allocation->'sources') WHERE value->>'sourceId'=source_id;
 SELECT value INTO beneficiary FROM jsonb_array_elements(source->'beneficiaries') WHERE value->>'merchantId'=merchant_id;
 IF beneficiary IS NULL THEN RETURN NULL; END IF;
 reference:='mresidual_'||marketplace_contribution_hash(jsonb_build_array(c#>>'{basis,hostMerchantId}',b->>'fundingPlanId',basis_hash,source_id,merchant_id));
 SELECT jsonb_agg(jsonb_build_object('reference','mresidual_'||marketplace_contribution_hash(jsonb_build_array(c#>>'{basis,hostMerchantId}',
  b->>'fundingPlanId',basis_hash,source_id,value->>'merchantId')),'destination',value->'destination','amountCents',value->'amountCents') ORDER BY ord)
  INTO transfers FROM jsonb_array_elements(source->'beneficiaries') WITH ORDINALITY beneficiary_rows(value,ord);
 raw:=jsonb_build_object('version',6,'provider','stripe','accountFingerprint',c#>'{basis,budget,capture,accountFingerprint}',
  'providerPaymentId',c#>'{basis,budget,capture,providerPaymentId}','destination',beneficiary->'destination','amountCents',beneficiary->'amountCents',
  'currency','BRL','reference',reference,'capture',c#>'{basis,budget,capture}','sourceId',source_id,'beneficiaryMerchantId',merchant_id,
  'basisHash',basis_hash,'allocationHash',marketplace_contribution_hash(allocation),'stripeSuccessiveFunding',jsonb_build_object('basis',b,'allocation',allocation),
  'remainingTotalCents',source->'payoutTotalCents','transfers',transfers,'refunds',(SELECT jsonb_agg(jsonb_build_object('providerOperationId',value->'providerOperationId',
    'amountCents',value->'amountCents') ORDER BY ord) FROM jsonb_array_elements(b->'refunds') WITH ORDINALITY refunds(value,ord)));
 RETURN raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw));
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_stripe_successive_generation_expected_request(b jsonb, plan_id text)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE allocation jsonb:=marketplace_stripe_successive_residual_expected_allocation(b); c jsonb:=b#>'{sourceRefundFunding,context}'; raw jsonb;
 basis_hash text:=marketplace_contribution_hash(b); allocation_hash text:=marketplace_contribution_hash(allocation);
BEGIN
 IF allocation IS NULL OR plan_id=c#>>'{residual,residualPlanId}' THEN RETURN NULL; END IF;
 raw:=jsonb_build_object('version',1,'kind','stripe_v4_successive_residual_certification','provider','stripe',
  'environment',c#>'{basis,budget,capture,environment}','accountFingerprint',c#>'{basis,budget,capture,accountFingerprint}',
  'hostMerchantId',c#>'{basis,hostMerchantId}','fundingPlanId',b->'fundingPlanId','residualPlanId',plan_id,'generation',2,
  'basis',b,'basisHash',basis_hash,'allocation',allocation,'allocationHash',allocation_hash,
  'reference','mresidual_generation_'||marketplace_contribution_hash(jsonb_build_array(c#>>'{basis,hostMerchantId}',b->>'fundingPlanId',basis_hash,allocation_hash)));
 RETURN raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw));
END $$;

CREATE FUNCTION marketplace_stripe_successive_generation_proof_valid(generation_request jsonb, proof jsonb, recorded_at timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE row marketplace_residual_operations; receipt jsonb; source jsonb; expected jsonb; observed timestamptz;
BEGIN
 IF generation_request IS DISTINCT FROM marketplace_stripe_successive_generation_expected_request(generation_request->'basis',generation_request->>'residualPlanId')
  OR proof->'version' IS DISTINCT FROM '1'::jsonb OR proof->>'kind' IS DISTINCT FROM 'stripe_v4_successive_residual_certified'
  OR proof->>'requestHash' IS DISTINCT FROM generation_request->>'requestHash' OR proof->>'basisHash' IS DISTINCT FROM generation_request->>'basisHash'
  OR proof->>'allocationHash' IS DISTINCT FROM generation_request->>'allocationHash' OR proof->>'accountFingerprint' IS DISTINCT FROM generation_request->>'accountFingerprint'
  OR proof->>'providerRefundId' IS DISTINCT FROM generation_request#>>'{basis,completedRefund,providerOperationId}' OR proof->'sourceInventoryComplete' IS DISTINCT FROM 'true'::jsonb
  OR proof->>'proofHash' IS DISTINCT FROM marketplace_contribution_hash(proof-'proofHash')
  OR jsonb_typeof(proof->'observedAt') IS DISTINCT FROM 'string' OR proof->>'observedAt' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  OR jsonb_typeof(proof->'transferReceipts') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 observed:=(proof->>'observedAt')::timestamptz;
 IF recorded_at IS NULL OR observed<recorded_at-interval '5 minutes' OR observed>recorded_at+interval '1 minute'
  OR jsonb_array_length(proof->'transferReceipts')<>(SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=generation_request->>'residualPlanId')
  OR (SELECT count(DISTINCT value->>'providerTransferId') FROM jsonb_array_elements(proof->'transferReceipts'))<>jsonb_array_length(proof->'transferReceipts')
  OR (SELECT count(DISTINCT value#>>'{balance,id}') FROM jsonb_array_elements(proof->'transferReceipts'))<>jsonb_array_length(proof->'transferReceipts') THEN RETURN false; END IF;
 FOR row IN SELECT * FROM marketplace_residual_operations WHERE residual_plan_id=generation_request->>'residualPlanId' LOOP
  SELECT value INTO receipt FROM jsonb_array_elements(proof->'transferReceipts') WHERE value->>'requestHash'=row.request_hash;
  SELECT value INTO source FROM jsonb_array_elements(generation_request#>'{allocation,sources}') WHERE value->>'sourceId'=row.source_id;
  expected:=jsonb_build_object('sourceId',row.source_id,'merchantId',row.beneficiary_merchant_id,'reference',row.reference,
   'requestHash',row.request_hash,'providerTransferId',row.provider_transfer_id,'chargeId',source->'chargeId','destination',row.request->'destination',
   'amountCents',row.amount_cents,'balance',jsonb_build_object('id',receipt#>'{balance,id}','sourceId',row.provider_transfer_id,'type','transfer',
    'currency','BRL','status','available','amountCents',-row.amount_cents::bigint,'feeCents',0,'netCents',-row.amount_cents::bigint));
  IF row.status<>'confirmed' OR row.claimed_at IS NULL OR row.reconciled_at IS NULL OR row.provider_transfer_id IS NULL
   OR row.provider_transfer_id !~ '^tr_[A-Za-z0-9_]+$' OR receipt IS DISTINCT FROM expected
   OR jsonb_typeof(receipt#>'{balance,id}') IS DISTINCT FROM 'string' OR receipt#>>'{balance,id}' !~ '^txn_[A-Za-z0-9_]+$'
   OR EXISTS(SELECT 1 FROM marketplace_residual_operations other WHERE other.id<>row.id AND other.account_fingerprint=row.account_fingerprint
      AND other.provider='stripe' AND other.provider_transfer_id=row.provider_transfer_id)
   OR EXISTS(SELECT 1 FROM marketplace_payouts other WHERE other.provider='stripe' AND other.account_fingerprint=row.account_fingerprint
      AND other.provider_transfer_id=row.provider_transfer_id) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_stripe_successive_residual_evidence_valid(plan_id text, admission boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; j marketplace_stripe_residual_generation_proofs; allocation jsonb;
 source jsonb; beneficiary jsonb; operation marketplace_residual_operations; expected jsonb; ev outbox_messages; count_expected integer:=0;
BEGIN
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 IF p.id IS NULL OR p.generation<>2 OR p.basis->'version' IS DISTINCT FROM '6'::jsonb OR NOT marketplace_stripe_successive_residual_basis_valid(p.basis,admission) THEN RETURN false; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 SELECT * INTO j FROM marketplace_stripe_residual_generation_proofs WHERE residual_plan_id=p.id;
 allocation:=marketplace_stripe_successive_residual_expected_allocation(p.basis);
 expected:=marketplace_stripe_successive_generation_expected_request(p.basis,p.id);
 IF p.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR p.funding_plan_id IS DISTINCT FROM p.basis->>'fundingPlanId'
  OR p.basis_hash IS DISTINCT FROM marketplace_contribution_hash(p.basis) OR p.allocation IS DISTINCT FROM allocation
  OR p.allocation_hash IS DISTINCT FROM marketplace_contribution_hash(allocation) OR j.request IS DISTINCT FROM expected
  OR j.request_hash IS DISTINCT FROM expected->>'requestHash' OR j.reference IS DISTINCT FROM expected->>'reference'
  OR j.operation_id IS DISTINCT FROM 'mresidual_cert_'||marketplace_contribution_hash(jsonb_build_array(p.id,expected->>'requestHash'))
  OR j.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR j.host_merchant_id IS DISTINCT FROM f.host_merchant_id
  OR p.due_at IS DISTINCT FROM (SELECT max(due_at) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id)
  OR admission AND (p.status<>'prepared' OR p.held_reason IS NOT NULL) THEN RETURN false; END IF;
 SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_residual_prepared_'||p.id;
 expected:=jsonb_build_object('residual_plan_id',p.id,'payment_intent_id',f.payment_intent_id,'order_id',f.provider_payment_id,
  'refunded_cents',allocation->'refundedCents','payout_total_cents',allocation->'payoutTotalCents',
  'platform_retained_cents',allocation->'platformRetainedCents','basis_hash',p.basis_hash,'allocation_hash',p.allocation_hash);
 IF ev.event_type IS DISTINCT FROM 'marketplace.residual.prepared' OR ev.merchant_id IS DISTINCT FROM f.host_merchant_id
  OR ev.correlation_id IS DISTINCT FROM f.payment_intent_id OR ev.causation_id IS DISTINCT FROM p.basis#>>'{refunds,-1,refundPlanId}'
  OR ev.producer IS DISTINCT FROM 'marketplace' OR ev.schema_version IS DISTINCT FROM 1 OR ev.payload IS DISTINCT FROM expected THEN RETURN false; END IF;
 FOR source IN SELECT value FROM jsonb_array_elements(allocation->'sources') LOOP
  FOR beneficiary IN SELECT value FROM jsonb_array_elements(source->'beneficiaries') LOOP
   count_expected:=count_expected+1;
   SELECT * INTO operation FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND source_id=source->>'sourceId' AND beneficiary_merchant_id=beneficiary->>'merchantId';
   expected:=marketplace_stripe_successive_residual_expected_request(p.basis,source->>'sourceId',beneficiary->>'merchantId');
   IF operation.id IS NULL OR operation.request IS DISTINCT FROM expected OR operation.request_hash IS DISTINCT FROM expected->>'requestHash'
    OR operation.reference IS DISTINCT FROM expected->>'reference' OR operation.amount_cents IS DISTINCT FROM (beneficiary->>'amountCents')::integer
    OR operation.provider IS DISTINCT FROM 'stripe' OR operation.account_fingerprint IS DISTINCT FROM f.account_fingerprint THEN RETURN false; END IF;
   IF operation.status IN ('confirmed','failed') THEN
    SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_residual_'||operation.status||'_'||operation.id;
    expected:=jsonb_build_object('residual_plan_id',p.id,'operation_id',operation.id,'payment_intent_id',p.funding_plan_id,
     'beneficiary_merchant_id',operation.beneficiary_merchant_id,'amount_cents',operation.amount_cents,'source_id',operation.source_id,
     'provider_transfer_id',operation.provider_transfer_id,'reconciliation_required',ev.payload->'reconciliation_required');
    IF operation.claimed_at IS NULL OR operation.reconciled_at IS NULL OR operation.provider_transfer_id IS NULL
     OR operation.provider_transfer_id !~ '^tr_[A-Za-z0-9_]+$' OR ev.event_type IS DISTINCT FROM 'marketplace.residual.'||operation.status
     OR ev.merchant_id IS DISTINCT FROM f.host_merchant_id OR ev.correlation_id IS DISTINCT FROM f.payment_intent_id OR ev.causation_id IS DISTINCT FROM operation.id
     OR ev.producer IS DISTINCT FROM 'marketplace' OR ev.schema_version IS DISTINCT FROM 1 OR jsonb_typeof(ev.payload->'reconciliation_required') IS DISTINCT FROM 'boolean'
     OR ev.payload IS DISTINCT FROM expected OR ev.payload->'reconciliation_required'='true'::jsonb AND p.status<>'held' THEN RETURN false; END IF;
   ELSIF p.status='completed' THEN RETURN false; END IF;
  END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=p.id)<>count_expected THEN RETURN false; END IF;
 IF j.status='confirmed' THEN
  IF p.status NOT IN ('completed','held') OR NOT marketplace_stripe_successive_generation_proof_valid(j.request,j.proof,j.reconciled_at)
   OR j.proof_hash IS DISTINCT FROM marketplace_contribution_hash(j.proof-'proofHash') THEN RETURN false; END IF;
  SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_residual_generation_certified_'||p.id;
  expected:=jsonb_build_object('residual_plan_id',p.id,'generation',2,'payment_intent_id',p.funding_plan_id,'request_hash',j.request_hash,
   'basis_hash',p.basis_hash,'allocation_hash',p.allocation_hash,'proof_hash',j.proof_hash,'provider_refund_id',p.basis#>'{completedRefund,providerOperationId}');
  IF ev.event_type IS DISTINCT FROM 'marketplace.residual.generation_certified' OR ev.merchant_id IS DISTINCT FROM f.host_merchant_id
   OR ev.correlation_id IS DISTINCT FROM f.payment_intent_id OR ev.causation_id IS DISTINCT FROM j.operation_id OR ev.producer IS DISTINCT FROM 'marketplace'
   OR ev.schema_version IS DISTINCT FROM 1 OR ev.payload IS DISTINCT FROM expected THEN RETURN false; END IF;
 ELSIF p.status='completed' OR EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_residual_generation_certified_'||p.id) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Reuse every installed V1-V5 CHECK expression literally; add only V6.
DO $$ DECLARE definition text; inherited text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_plans'::regclass AND conname='marketplace_residual_plan_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_stripe_successive_legacy_constraint_missing'; END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_plans DROP CONSTRAINT marketplace_residual_plan_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK (('||inherited||') OR COALESCE(
  status IN (''prepared'',''completed'',''held'') AND generation=2 AND basis->''version''=''6''::jsonb AND allocation->''version''=''6''::jsonb
  AND basis->>''kind''=''stripe_v4_successive_residual'' AND basis_hash=marketplace_contribution_hash(basis)
  AND allocation_hash=marketplace_contribution_hash(allocation) AND marketplace_stripe_successive_residual_allocation_valid(allocation),false))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_operations'::regclass AND conname='marketplace_residual_source_id_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_stripe_successive_legacy_constraint_missing'; END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_operations DROP CONSTRAINT marketplace_residual_source_id_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_source_id_valid CHECK (('||inherited||') OR COALESCE(
  request->''version''=''6''::jsonb AND request->>''provider''=''stripe'' AND request->>''sourceId''=source_id
  AND (source_id=''original'' OR source_id ~ ''^contribution:[a-f0-9]{64}$''),false))';
END $$;

CREATE FUNCTION marketplace_stripe_successive_generation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; expected jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_stripe_successive_journal_immutable'; END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=NEW.residual_plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 expected:=marketplace_stripe_successive_generation_expected_request(p.basis,p.id);
 IF NEW.request IS DISTINCT FROM expected OR NEW.request_hash IS DISTINCT FROM expected->>'requestHash' OR p.generation<>2
  OR NEW.operation_id IS DISTINCT FROM 'mresidual_cert_'||marketplace_contribution_hash(jsonb_build_array(p.id,expected->>'requestHash')) THEN RAISE EXCEPTION 'marketplace_stripe_successive_request_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'planned' OR NEW.version<>0 OR NEW.claimed_at IS NOT NULL OR NEW.proof IS NOT NULL OR p.status<>'prepared'
   OR NOT marketplace_stripe_successive_residual_basis_valid(p.basis,true) THEN RAISE EXCEPTION 'marketplace_stripe_successive_initial_claim_invalid'; END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','claimed_at','reconciled_at','proof','proof_hash','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','version','claimed_at','reconciled_at','proof','proof_hash','updated_at']) OR OLD.status='confirmed'
   OR NEW.version<>OLD.version+1 OR OLD.claimed_at IS NOT NULL AND NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
   THEN RAISE EXCEPTION 'marketplace_stripe_successive_journal_immutable'; END IF;
  IF OLD.status='planned' THEN
   IF NEW.status<>'unknown' OR NEW.claimed_at IS NULL OR p.status<>'prepared' OR (p.due_at AT TIME ZONE 'UTC')>now()
    OR NOT marketplace_stripe_successive_residual_basis_valid(p.basis,true)
    OR EXISTS(SELECT 1 FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND status<>'confirmed')
    THEN RAISE EXCEPTION 'marketplace_stripe_successive_claim_unproven'; END IF;
  ELSIF NEW.status='confirmed' THEN
   IF p.status<>'prepared' OR NOT marketplace_stripe_successive_residual_basis_valid(p.basis,true)
    OR NOT marketplace_stripe_successive_generation_proof_valid(NEW.request,NEW.proof,NEW.reconciled_at)
    THEN RAISE EXCEPTION 'marketplace_stripe_successive_proof_unproven'; END IF;
  ELSIF NEW.status<>'unknown' THEN RAISE EXCEPTION 'marketplace_stripe_successive_submission_uncertain'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_stripe_successive_generation_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_stripe_residual_generation_proofs
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_generation_guard();

CREATE FUNCTION marketplace_stripe_successive_financial_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN
  IF TG_OP='DELETE' THEN
   IF OLD.basis->'version'='6'::jsonb THEN RAISE EXCEPTION 'marketplace_stripe_successive_journal_immutable'; END IF; RETURN OLD;
  END IF;
  IF NEW.basis->'version' IS DISTINCT FROM '6'::jsonb THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND (NEW.status<>'prepared' OR NEW.held_reason IS NOT NULL OR NOT marketplace_stripe_successive_residual_basis_valid(NEW.basis,true))
   THEN RAISE EXCEPTION 'marketplace_stripe_successive_initial_generation_invalid'; END IF;
  IF TG_OP='UPDATE' AND OLD.status<>'completed' AND NEW.status='completed' AND NOT EXISTS(SELECT 1 FROM marketplace_stripe_residual_generation_proofs
   WHERE residual_plan_id=NEW.id AND status='confirmed') THEN RAISE EXCEPTION 'marketplace_stripe_successive_completion_unproven'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN
  IF OLD.request->'version'='6'::jsonb THEN RAISE EXCEPTION 'marketplace_stripe_successive_journal_immutable'; END IF; RETURN OLD;
 END IF;
 IF NEW.request->'version' IS DISTINCT FROM '6'::jsonb THEN RETURN NEW; END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=NEW.residual_plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 expected:=marketplace_stripe_successive_residual_expected_request(p.basis,NEW.source_id,NEW.beneficiary_merchant_id);
 IF expected IS NULL OR NEW.request IS DISTINCT FROM expected OR NEW.request_hash IS DISTINCT FROM expected->>'requestHash'
  OR NEW.reference IS DISTINCT FROM expected->>'reference' OR NEW.amount_cents IS DISTINCT FROM (expected->>'amountCents')::integer
  OR NEW.provider IS DISTINCT FROM 'stripe' OR NEW.account_fingerprint IS DISTINCT FROM f.account_fingerprint THEN RAISE EXCEPTION 'marketplace_stripe_successive_operation_binding_invalid'; END IF;
 IF NEW.status IN ('unknown','pending','confirmed','failed') AND (NEW.claimed_at IS NULL OR NEW.version<1)
  THEN RAISE EXCEPTION 'marketplace_stripe_successive_claim_unproven'; END IF;
 IF NEW.provider_transfer_id IS NOT NULL AND (EXISTS(SELECT 1 FROM marketplace_payouts other WHERE other.provider='stripe'
    AND other.account_fingerprint=NEW.account_fingerprint AND other.provider_transfer_id=NEW.provider_transfer_id)
  OR EXISTS(SELECT 1 FROM marketplace_residual_operations other WHERE other.id<>NEW.id AND other.provider='stripe'
    AND other.account_fingerprint=NEW.account_fingerprint AND other.provider_transfer_id=NEW.provider_transfer_id))
  THEN RAISE EXCEPTION 'marketplace_stripe_successive_native_receipt_consumed'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'planned' OR NEW.version<>0 OR NEW.claimed_at IS NOT NULL OR NEW.provider_transfer_id IS NOT NULL THEN RAISE EXCEPTION 'marketplace_stripe_successive_initial_claim_invalid'; END IF;
 ELSE
  IF OLD.claimed_at IS NOT NULL AND (NEW.claimed_at IS DISTINCT FROM OLD.claimed_at OR NEW.status='planned') THEN RAISE EXCEPTION 'marketplace_stripe_successive_submission_uncertain'; END IF;
  IF OLD.claimed_at IS NULL AND NEW.claimed_at IS NOT NULL AND (OLD.status<>'planned' OR NEW.status<>'unknown' OR NEW.version<>OLD.version+1
   OR p.status<>'prepared' OR p.held_reason IS NOT NULL OR (p.due_at AT TIME ZONE 'UTC')>now() OR NOT marketplace_stripe_successive_residual_basis_valid(p.basis,true))
   THEN RAISE EXCEPTION 'marketplace_stripe_successive_claim_unproven'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_stripe_successive_plan_financial_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_residual_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_financial_guard();
CREATE TRIGGER marketplace_stripe_successive_operation_financial_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_residual_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_financial_guard();

CREATE FUNCTION marketplace_stripe_successive_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_id text; p marketplace_residual_plans;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN plan_id:=NEW.id;
 ELSIF TG_TABLE_NAME='outbox_messages' THEN
  IF NEW.event_type<>'marketplace.residual.generation_certified' THEN RETURN NEW; END IF;
  plan_id:=NEW.payload->>'residual_plan_id';
 ELSE plan_id:=NEW.residual_plan_id; END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 IF p.basis->'version' IS DISTINCT FROM '6'::jsonb THEN RETURN NEW; END IF;
 IF NOT marketplace_stripe_successive_residual_evidence_valid(plan_id,false) THEN RAISE EXCEPTION 'marketplace_stripe_successive_inventory_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_stripe_successive_plan_commit_guard AFTER INSERT OR UPDATE ON marketplace_residual_plans
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_stripe_successive_operation_commit_guard AFTER INSERT OR UPDATE ON marketplace_residual_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_stripe_successive_generation_commit_guard AFTER INSERT OR UPDATE ON marketplace_stripe_residual_generation_proofs
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_stripe_successive_outbox_commit_guard AFTER INSERT ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_commit_guard();

CREATE FUNCTION marketplace_stripe_successive_outbox_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p marketplace_residual_plans; event outbox_messages;
BEGIN
 event:=OLD;
 IF event.event_type='marketplace.residual.generation_certified' OR event.event_type IN ('marketplace.residual.prepared','marketplace.residual.confirmed','marketplace.residual.failed')
  AND EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE id=event.payload->>'residual_plan_id' AND basis->'version'='6'::jsonb) THEN
  IF TG_OP='DELETE' OR ROW(NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload,OLD.created_at)
   THEN RAISE EXCEPTION 'marketplace_stripe_successive_outbox_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER marketplace_stripe_successive_outbox_immutable BEFORE UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_successive_outbox_immutable();

-- Exact historical V4 bodies with narrowly scoped successor changes.
CREATE OR REPLACE FUNCTION marketplace_residual_source_evidence_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; credit_row record; s jsonb; b jsonb; o record;
 certificates jsonb; projected jsonb; receipt jsonb; prefix jsonb; seq integer:=1; refund_total bigint;
 refund_remaining bigint; debit bigint; expected_ops integer:=0; fee_total bigint:=0; excess_total bigint:=0; credit_total bigint:=0;
 source_transfers jsonb; expected_transfers jsonb; expected_request jsonb; expected_reference text; durable_event outbox_messages;
BEGIN
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 IF p.id IS NULL OR p.basis->'version' IS DISTINCT FROM '4'::jsonb THEN RETURN false; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 IF f.provider IS DISTINCT FROM 'stripe' OR f.host_merchant_id IS DISTINCT FROM p.host_merchant_id OR p.generation<>1
   OR p.basis_hash IS DISTINCT FROM marketplace_contribution_hash(p.basis)
   OR p.allocation_hash IS DISTINCT FROM marketplace_contribution_hash(p.allocation)
   OR p.basis->>'fundingPlanId' IS DISTINCT FROM f.payment_intent_id OR p.basis->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
   OR p.basis->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans successor WHERE successor.funding_plan_id=f.payment_intent_id AND successor.id<>p.id
     AND NOT COALESCE((successor.generation=2 AND successor.basis->'version'='6'::jsonb AND successor.basis->>'kind'='stripe_v4_successive_residual'
       AND successor.basis->>'fundingPlanId'=f.payment_intent_id AND successor.host_merchant_id=f.host_merchant_id
       AND successor.basis#>>'{sourceRefundFunding,context,residual,residualPlanId}'=p.id
       AND successor.basis#>'{sourceRefundFunding,context,residual,basis}'=p.basis
       AND successor.basis#>'{sourceRefundFunding,context,residual,allocation}'=p.allocation
       AND successor.basis#>>'{sourceRefundFunding,context,residual,basisHash}'=p.basis_hash
       AND successor.basis#>>'{sourceRefundFunding,context,residual,allocationHash}'=p.allocation_hash),false))
   THEN RETURN false; END IF;
 SELECT jsonb_agg(c.certificate ORDER BY c.credit_sequence) INTO certificates FROM marketplace_refund_contribution_credits c
   JOIN marketplace_refund_contribution_journals j ON j.id=c.id AND j.status='credited' AND j.certificate_hash=c.certificate_hash
   WHERE c.funding_plan_id=f.payment_intent_id AND c.host_merchant_id=p.host_merchant_id AND c.account_fingerprint=f.account_fingerprint;
 SELECT projected_plan INTO projected FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id ORDER BY credit_sequence DESC LIMIT 1;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',r.id,'returnId',r.return_id,'allocationHash',r.allocation_hash,
   'requestHash',refund_operation.request_hash,'providerOperationId',refund_operation.provider_operation_id,'amountCents',r.amount_cents)
   ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id),sum(r.amount_cents) INTO prefix,refund_total
   FROM marketplace_refund_plans r JOIN marketplace_refund_operations refund_operation ON refund_operation.refund_plan_id=r.id
   WHERE r.funding_plan_id=f.payment_intent_id AND r.host_merchant_id=p.host_merchant_id AND r.status='confirmed'
   AND (r.allocation->>'cumulativeRefundCents')::bigint <= (p.allocation->>'refundedCents')::bigint
   AND refund_operation.status='confirmed' AND refund_operation.claimed_at IS NOT NULL AND refund_operation.reconciled_at IS NOT NULL AND refund_operation.provider_operation_id IS NOT NULL;
 IF certificates IS NULL OR p.basis#>'{fundingContributions,certificates}' IS DISTINCT FROM certificates
   OR jsonb_array_length(certificates)+1<>jsonb_array_length(p.allocation->'sources')
   OR projected->'fullyFunded' IS DISTINCT FROM 'true'::jsonb OR projected->>'planHash' IS DISTINCT FROM p.basis#>>'{fundingContributions,planHash}'
   OR projected->'contributedNetCents' IS DISTINCT FROM p.basis#>'{fundingContributions,contributedNetCents}'
   OR p.basis->'refunds' IS DISTINCT FROM prefix OR refund_total IS DISTINCT FROM (p.allocation->>'refundedCents')::bigint
   OR projected->'cumulativeRefundCents' IS DISTINCT FROM p.allocation->'refundedCents'
   OR projected->'platformRemainingCents' IS DISTINCT FROM p.allocation->'platformRetainedCents'
   OR EXISTS(SELECT 1 FROM marketplace_refund_plans r WHERE r.funding_plan_id=f.payment_intent_id AND r.status<>'confirmed'
     AND (r.allocation->>'cumulativeRefundCents')::bigint <= (p.allocation->>'refundedCents')::bigint)
   THEN RETURN false; END IF;
 IF jsonb_array_length(projected->'remainingBeneficiaries')<>jsonb_array_length(p.allocation->'beneficiaries') THEN RETURN false; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(projected->'remainingBeneficiaries') x
     WHERE x.value->>'merchantId'=b->>'merchantId' AND x.value->'amountCents'=b->'amountCents' AND x.value->'providerFeeCents'=b->'providerFeeCents')
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') x
     WHERE x.value->>'merchantId'=b->>'merchantId' AND x.value->>'destination'=b->>'destination') THEN RETURN false; END IF;
 END LOOP;
 s:=p.allocation#>'{sources,0}';
 debit:=LEAST(refund_total,f.net_amount_cents);refund_remaining:=refund_total-debit;
 IF s->>'sourceId' IS DISTINCT FROM 'original' OR s->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id
   OR s->>'chargeId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}' OR s->>'balanceTransactionId' IS DISTINCT FROM f.budget#>>'{capture,balanceTransactionId}'
   OR s->'capturedGrossCents' IS DISTINCT FROM to_jsonb(f.amount_cents) OR s->'processingFeeCents' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR s->'creditedNetCents' IS DISTINCT FROM to_jsonb(f.net_amount_cents) OR s->'refundDebitCents' IS DISTINCT FROM to_jsonb(debit)
   OR s->'platformRetainedCents' IS DISTINCT FROM p.allocation->'platformRetainedCents' THEN RETURN false; END IF;
 FOR credit_row IN SELECT * FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id ORDER BY credit_sequence LOOP
   s:=p.allocation->'sources'->seq;receipt:=credit_row.certificate;debit:=LEAST(refund_remaining,credit_row.credit_cents);refund_remaining:=refund_remaining-debit;
   IF s->>'sourceId' IS DISTINCT FROM 'contribution:'||credit_row.certificate_hash OR s->>'providerPaymentId' IS DISTINCT FROM credit_row.provider_payment_intent_id
     OR s->>'chargeId' IS DISTINCT FROM credit_row.provider_charge_id OR s->>'balanceTransactionId' IS DISTINCT FROM credit_row.provider_balance_transaction_id
     OR s->'capturedGrossCents' IS DISTINCT FROM receipt#>'{proof,balance,amountCents}' OR s->'processingFeeCents' IS DISTINCT FROM to_jsonb(credit_row.processing_fee_cents)
     OR s->'creditedNetCents' IS DISTINCT FROM to_jsonb(credit_row.credit_cents) OR s->'refundDebitCents' IS DISTINCT FROM to_jsonb(debit)
     OR (s->>'excessLiabilityCents')::bigint IS DISTINCT FROM COALESCE((receipt->>'excessLiabilityCents')::bigint,0)
     THEN RETURN false; END IF;
   credit_total:=credit_total+credit_row.credit_cents;fee_total:=fee_total+credit_row.processing_fee_cents;
   excess_total:=excess_total+COALESCE((receipt->>'excessLiabilityCents')::bigint,0);seq:=seq+1;
 END LOOP;
 IF refund_remaining<>0 OR p.allocation->'contributedNetCents' IS DISTINCT FROM to_jsonb(credit_total)
   OR p.allocation->'contributionProcessingFeeCents' IS DISTINCT FROM to_jsonb(fee_total)
   OR p.allocation->'excessLiabilityCents' IS DISTINCT FROM to_jsonb(excess_total) THEN RETURN false; END IF;
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
       THEN RETURN false; END IF;
     IF o.status='confirmed' THEN
       SELECT * INTO durable_event FROM outbox_messages WHERE event_id='marketplace_residual_confirmed_'||o.id;
       expected_request:=jsonb_build_object('residual_plan_id',p.id,'operation_id',o.id,'payment_intent_id',f.payment_intent_id,
         'beneficiary_merchant_id',o.beneficiary_merchant_id,'amount_cents',o.amount_cents,'source_id',o.source_id,'provider_transfer_id',o.provider_transfer_id,
         'reconciliation_required',durable_event.payload->'reconciliation_required');
       IF o.claimed_at IS NULL OR o.reconciled_at IS NULL OR o.provider_transfer_id IS NULL OR o.provider_transfer_id !~ '^tr_[A-Za-z0-9_]+$'
         OR durable_event.event_type IS DISTINCT FROM 'marketplace.residual.confirmed' OR durable_event.merchant_id IS DISTINCT FROM f.host_merchant_id
         OR durable_event.correlation_id IS DISTINCT FROM f.payment_intent_id OR durable_event.causation_id IS DISTINCT FROM o.id
         OR durable_event.producer IS DISTINCT FROM 'marketplace' OR durable_event.schema_version IS DISTINCT FROM 1
         OR jsonb_typeof(durable_event.payload->'reconciliation_required') IS DISTINCT FROM 'boolean'
         OR durable_event.payload IS DISTINCT FROM expected_request THEN RETURN false; END IF;
     ELSIF p.status='completed' THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 IF (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=p.id)<>expected_ops THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_stripe_source_refund_evidence_valid(funding jsonb, admission boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=funding->'context'; p jsonb:=funding->'plan'; f marketplace_funding_plans; pi payment_intents;
 residual marketplace_residual_plans; current_refund marketplace_refund_plans; refund_row record; operation_row record;
 ctx_operations jsonb; prefix jsonb; identities jsonb; context_identities jsonb; expected_history jsonb; receipt jsonb;
 expected_event jsonb; actual_event outbox_messages; previous_total bigint:=0; frontier integer; i integer:=0;
 actual_dispute boolean; source_row jsonb; contribution_row record;
BEGIN
 -- New source-aware refunds/reversals after V6 need a separate combined ledger.
 -- Frozen receipts remain certifiable; they never grant fresh admission.
 IF admission AND EXISTS(SELECT 1 FROM marketplace_residual_plans successor
   WHERE successor.funding_plan_id=c#>>'{basis,fundingPlanId}' AND successor.basis->'version'='6'::jsonb) THEN RETURN false; END IF;
 IF NOT marketplace_stripe_source_refund_replay_valid(funding) THEN RETURN false; END IF;
 SELECT * INTO current_refund FROM marketplace_refund_plans WHERE id=c->>'refundPlanId';
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=current_refund.funding_plan_id;
 SELECT * INTO pi FROM payment_intents WHERE id=f.payment_intent_id AND merchant_id=f.host_merchant_id;
 SELECT * INTO residual FROM marketplace_residual_plans WHERE id=c#>>'{residual,residualPlanId}';
 IF current_refund.id IS NULL OR pi.id IS NULL OR residual.id IS NULL OR f.provider IS DISTINCT FROM 'stripe'
  OR f.host_merchant_id IS DISTINCT FROM current_refund.host_merchant_id OR f.status IS DISTINCT FROM 'held'
  OR pi.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR pi.amount_cents IS DISTINCT FROM f.amount_cents
  OR pi.approved_amount_cents IS DISTINCT FROM f.amount_cents OR pi.currency IS DISTINCT FROM 'BRL'
  OR NOT (pi.status IN ('approved','refunded') OR NOT admission AND pi.status LIKE 'chargeback_%')
  OR f.instructions_hash IS DISTINCT FROM marketplace_contribution_hash(f.instructions)
  OR f.instructions IS DISTINCT FROM pi.creation#>'{input,marketplaceFunding}'
  OR pi.creation#>>'{input,provider}' IS DISTINCT FROM 'stripe'
  OR pi.creation#>>'{input,providerAccountFingerprint}' IS DISTINCT FROM f.account_fingerprint
  OR c->>'returnId' IS DISTINCT FROM current_refund.return_id OR c#>>'{basis,fundingPlanId}' IS DISTINCT FROM f.payment_intent_id
  OR c#>>'{basis,hostMerchantId}' IS DISTINCT FROM f.host_merchant_id OR c#>'{basis,instructions}' IS DISTINCT FROM f.instructions
  OR c#>'{basis,budget}' IS DISTINCT FROM f.budget OR c#>>'{basis,instructionsHash}' IS DISTINCT FROM f.instructions_hash
  OR c#>>'{basis,budgetHash}' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
  OR residual.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR residual.host_merchant_id IS DISTINCT FROM f.host_merchant_id
  OR residual.generation<>1 OR c#>'{residual,generation}' IS DISTINCT FROM to_jsonb(residual.generation)
  OR c#>'{residual,basis}' IS DISTINCT FROM residual.basis OR c#>'{residual,allocation}' IS DISTINCT FROM residual.allocation
  OR c#>>'{residual,basisHash}' IS DISTINCT FROM residual.basis_hash OR c#>>'{residual,allocationHash}' IS DISTINCT FROM residual.allocation_hash
  OR NOT marketplace_residual_source_evidence_valid(residual.id)
  OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
  OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
  THEN RETURN false; END IF;
 SELECT chargeback_at IS NOT NULL INTO actual_dispute FROM marketplace_order_ledgers
  WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id AND purchased_at IS NOT NULL;
 IF actual_dispute IS NULL OR admission AND actual_dispute
  OR NOT (residual.status='completed' AND residual.held_reason IS NULL OR NOT admission AND actual_dispute
    AND residual.status='held' AND residual.held_reason='marketplace_residual_dispute_requires_reconciliation')
  OR EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id AND
    (NOT(status='planned' OR NOT admission AND actual_dispute AND status='cancelled') OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL))
  THEN RETURN false; END IF;
 IF admission AND (EXISTS(SELECT 1 FROM outbox_messages WHERE merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id
    AND event_type='marketplace.financial_reconciliation_required')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_seller_debts d ON d.seller_merchant_id=b.value->>'merchantId' AND d.status='outstanding')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_host_debts d ON d.host_merchant_id=b.value->>'merchantId' AND d.status='outstanding')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE marketplace_stripe_source_beneficiary_exposed(b.value->>'merchantId'))
  OR EXISTS(SELECT 1 FROM marketplace_refund_plans r WHERE r.funding_plan_id=f.payment_intent_id
    AND (r.allocation->>'cumulativeRefundCents')::bigint>(current_refund.allocation->>'cumulativeRefundCents')::bigint)) THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(identity ORDER BY identity->>'lineItemId' COLLATE "C"),'[]'::jsonb) INTO identities FROM (
  SELECT jsonb_build_object('lineItemId',l.id,'variantId',l.source_variant_id,'quantity',l.quantity) identity
    FROM cross_store_line_items l WHERE l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id
  UNION ALL
  SELECT jsonb_build_object('lineItemId',x.value->'lineItemId','variantId',x.value->'variantId','quantity',x.value->'quantity')
    FROM jsonb_array_elements(COALESCE(f.instructions->'hostStockItems','[]'::jsonb)) x) entries;
 SELECT COALESCE(jsonb_agg(value ORDER BY value->>'lineItemId' COLLATE "C"),'[]'::jsonb) INTO context_identities FROM jsonb_array_elements(c#>'{basis,identities}');
 IF identities IS DISTINCT FROM context_identities OR jsonb_array_length(identities)=0
  OR EXISTS(SELECT 1 FROM cross_store_line_items l WHERE l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'lines') x WHERE x.value->>'lineItemId'=l.id
     AND x.value->>'sellerMerchantId'=l.seller_merchant_id AND (x.value->>'grossAmountCents')::bigint=l.unit_price_cents::bigint*l.quantity
     AND (x.value->>'commissionCents')::bigint=l.commission_cents)) THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('operationId',o.id,'merchantId',o.beneficiary_merchant_id,'sourceId',o.source_id,
  'providerTransferId',o.provider_transfer_id,'request',o.request) ORDER BY o.source_id COLLATE "C",o.beneficiary_merchant_id COLLATE "C"),'[]'::jsonb)
  INTO ctx_operations FROM marketplace_residual_operations o WHERE o.residual_plan_id=residual.id;
 IF ctx_operations IS DISTINCT FROM c#>'{residual,operations}' OR EXISTS(SELECT 1 FROM marketplace_residual_operations o
  WHERE o.residual_plan_id=residual.id AND (o.status<>'confirmed' OR o.claimed_at IS NULL OR o.reconciled_at IS NULL
   OR o.provider_transfer_id !~ '^tr_[A-Za-z0-9_]+$' OR o.provider<>'stripe' OR o.account_fingerprint<>f.account_fingerprint)) THEN RETURN false; END IF;
 FOR operation_row IN SELECT * FROM marketplace_residual_operations WHERE residual_plan_id=residual.id LOOP
  SELECT * INTO actual_event FROM outbox_messages WHERE event_id='marketplace_residual_confirmed_'||operation_row.id;
  expected_event:=jsonb_build_object('residual_plan_id',residual.id,'operation_id',operation_row.id,'payment_intent_id',f.payment_intent_id,
   'beneficiary_merchant_id',operation_row.beneficiary_merchant_id,'amount_cents',operation_row.amount_cents,'source_id',operation_row.source_id,
   'provider_transfer_id',operation_row.provider_transfer_id,'reconciliation_required',false);
  IF actual_event.event_type IS DISTINCT FROM 'marketplace.residual.confirmed' OR actual_event.merchant_id IS DISTINCT FROM f.host_merchant_id
   OR actual_event.correlation_id IS DISTINCT FROM f.payment_intent_id OR actual_event.causation_id IS DISTINCT FROM operation_row.id
   OR actual_event.producer IS DISTINCT FROM 'marketplace' OR actual_event.schema_version IS DISTINCT FROM 1
   OR actual_event.payload IS DISTINCT FROM expected_event THEN RETURN false; END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',r.id,'allocationHash',r.allocation_hash,'allocation',r.allocation)
  ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id COLLATE "C") INTO prefix FROM marketplace_refund_plans r
  WHERE r.funding_plan_id=f.payment_intent_id AND (r.allocation->>'cumulativeRefundCents')::bigint<=(current_refund.allocation->>'cumulativeRefundCents')::bigint;
 IF prefix IS DISTINCT FROM c#>'{basis,refunds}' OR current_refund.amount_cents IS DISTINCT FROM (p->>'amountCents')::integer
  OR current_refund.allocation->'cumulativeRefundCents' IS DISTINCT FROM p->'cumulativeRefundCents'
  OR NOT EXISTS(SELECT 1 FROM returns returned WHERE returned.id=current_refund.return_id AND returned.status::text=
    CASE WHEN current_refund.status='confirmed' THEN 'REFUND_COMPLETED' WHEN current_refund.status IN ('submitted','failed') THEN 'REFUND_PROCESSING' ELSE 'INSPECTED_PASS' END)
  THEN RETURN false; END IF;
 frontier:=jsonb_array_length(residual.basis->'refunds'); expected_history:='[]';
 FOR refund_row IN SELECT r.*,o.id operation_id,o.status operation_status,o.claimed_at,o.reconciled_at,o.provider_operation_id,o.request,o.request_hash,
  o.provider operation_provider,o.account_fingerprint operation_account,o.reference operation_reference
  FROM marketplace_refund_plans r LEFT JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id
  WHERE r.funding_plan_id=f.payment_intent_id AND (r.allocation->>'cumulativeRefundCents')::bigint<=(current_refund.allocation->>'cumulativeRefundCents')::bigint
  ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id COLLATE "C" LOOP
  IF refund_row.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR refund_row.amount_cents IS DISTINCT FROM (refund_row.allocation->>'amountCents')::integer
   OR refund_row.allocation_hash IS DISTINCT FROM marketplace_contribution_hash(refund_row.allocation)
   OR (refund_row.allocation->>'cumulativeRefundCents')::bigint<>previous_total+refund_row.amount_cents
   OR NOT EXISTS(SELECT 1 FROM returns r WHERE r.id=refund_row.return_id AND r.merchant_id=f.host_merchant_id AND
    (r.order_id=f.provider_payment_id OR r.order_id=pi.commerce_order_id OR EXISTS(SELECT 1 FROM completed_orders completed
      WHERE completed.merchant_id=f.host_merchant_id AND (completed.external_order_id=f.provider_payment_id OR completed.session_id=pi.session_id) AND completed.id=r.order_id)))
   OR (SELECT COALESCE(jsonb_agg(jsonb_build_object('variantId',item.variant_id,'quantity',item.quantity) ORDER BY item.variant_id COLLATE "C"),'[]'::jsonb)
      FROM return_items item WHERE item.return_id=refund_row.return_id) IS DISTINCT FROM
     (SELECT COALESCE(jsonb_agg(jsonb_build_object('variantId',value->'variantId','quantity',value->'quantity') ORDER BY value->>'variantId' COLLATE "C"),'[]'::jsonb)
      FROM jsonb_array_elements(refund_row.allocation->'lines')) THEN RETURN false; END IF;
  previous_total:=previous_total+refund_row.amount_cents;
  IF refund_row.id=current_refund.id THEN EXIT; END IF;
  IF refund_row.status<>'confirmed' OR refund_row.operation_status IS DISTINCT FROM 'confirmed' OR refund_row.claimed_at IS NULL OR refund_row.reconciled_at IS NULL
   OR refund_row.provider_operation_id IS NULL OR refund_row.provider_operation_id !~ '^re_[A-Za-z0-9_]+$'
   OR refund_row.operation_provider IS DISTINCT FROM 'stripe' OR refund_row.operation_account IS DISTINCT FROM f.account_fingerprint
   OR NOT EXISTS(SELECT 1 FROM returns WHERE id=refund_row.return_id AND status::text='REFUND_COMPLETED')
   OR NOT EXISTS(SELECT 1 FROM return_refunds WHERE return_id=refund_row.return_id AND id='mrefund_return_'||marketplace_contribution_hash(to_jsonb(refund_row.id))
    AND status='COMPLETED' AND provider_refund_id=refund_row.provider_operation_id AND payment_intent_id=f.payment_intent_id AND amount_in_cents=refund_row.amount_cents)
   THEN RETURN false; END IF;
  SELECT * INTO actual_event FROM outbox_messages WHERE event_id='marketplace_refund_'||refund_row.id;
  expected_event:=jsonb_build_object('refund_plan_id',refund_row.id,'return_id',refund_row.return_id,'payment_intent_id',f.payment_intent_id,
   'order_id',f.provider_payment_id,'amount_cents',refund_row.amount_cents,'cumulative_refund_cents',refund_row.allocation->'cumulativeRefundCents',
   'allocation_hash',refund_row.allocation_hash,'provider_refund_id',refund_row.provider_operation_id);
  IF actual_event.event_type IS DISTINCT FROM 'marketplace.refund.confirmed' OR actual_event.merchant_id IS DISTINCT FROM f.host_merchant_id
   OR actual_event.correlation_id IS DISTINCT FROM f.payment_intent_id OR actual_event.causation_id IS DISTINCT FROM refund_row.return_id
   OR actual_event.producer IS DISTINCT FROM 'marketplace' OR actual_event.schema_version IS DISTINCT FROM 1 OR actual_event.payload IS DISTINCT FROM expected_event THEN RETURN false; END IF;
  IF i>=frontier THEN
   SELECT COALESCE(jsonb_agg(jsonb_build_object('payoutId',reversal.residual_operation_id,'providerOperationId',reversal.provider_operation_id,
    'amountCents',reversal.amount_cents,'reference',reversal.reference,'requestHash',reversal.request_hash) ORDER BY reversal.residual_operation_id COLLATE "C"),'[]'::jsonb)
    INTO receipt FROM marketplace_transfer_reversals reversal WHERE reversal.refund_plan_id=refund_row.id;
   IF EXISTS(SELECT 1 FROM marketplace_transfer_reversals reversal WHERE reversal.refund_plan_id=refund_row.id AND
      (reversal.status<>'confirmed' OR reversal.claimed_at IS NULL OR reversal.reconciled_at IS NULL OR reversal.provider_operation_id IS NULL
       OR reversal.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$' OR reversal.payout_id IS NOT NULL OR reversal.host_merchant_id<>f.host_merchant_id
       OR reversal.provider<>'stripe' OR reversal.account_fingerprint<>f.account_fingerprint)) THEN RETURN false; END IF;
   expected_history:=expected_history||jsonb_build_array(jsonb_build_object('refundPlanId',refund_row.id,'returnId',refund_row.return_id,
    'providerOperationId',refund_row.provider_operation_id,'planHash',refund_row.request#>'{stripeSourceFunding,plan,planHash}','reversals',receipt));
  END IF;
  i:=i+1;
 END LOOP;
 IF expected_history IS DISTINCT FROM c->'history' OR previous_total>f.amount_cents OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals reversal
  JOIN marketplace_refund_plans r ON r.id=reversal.refund_plan_id WHERE r.funding_plan_id=f.payment_intent_id AND
   (reversal.payout_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM marketplace_residual_operations o WHERE o.id=reversal.residual_operation_id AND o.residual_plan_id=residual.id)
    OR (r.allocation->>'cumulativeRefundCents')::bigint<=(residual.allocation->>'refundedCents')::bigint)) THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
