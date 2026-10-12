-- Stripe refunds after certified V4 payouts. Original charge, fee receipts and
-- payout journals remain immutable. A historical receipt is not fresh admission.
-- All JSON hashes use the existing application-compatible canonical encoder.

-- Full V4 binding at its immutable initial refund frontier. Later buyer refunds
-- cannot erase or refresh an existing source certificate or operation request.
CREATE FUNCTION marketplace_residual_source_evidence_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id AND id<>p.id)
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

-- This function certifies durable local evidence, not native PSP state. The
-- provider adapter performs complete GET inventories before a claimed POST.
CREATE FUNCTION marketplace_stripe_source_refund_evidence_valid(funding jsonb, admission boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=funding->'context'; p jsonb:=funding->'plan'; f marketplace_funding_plans; pi payment_intents;
 residual marketplace_residual_plans; current_refund marketplace_refund_plans; refund_row record; operation_row record;
 ctx_operations jsonb; prefix jsonb; identities jsonb; context_identities jsonb; expected_history jsonb; receipt jsonb;
 expected_event jsonb; actual_event outbox_messages; previous_total bigint:=0; frontier integer; i integer:=0;
 actual_dispute boolean; source_row jsonb; contribution_row record;
BEGIN
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

CREATE FUNCTION marketplace_stripe_source_beneficiary_exposed(merchant_id text)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM marketplace_residual_operations o JOIN marketplace_residual_plans r ON r.id=o.residual_plan_id
  WHERE o.beneficiary_merchant_id=merchant_id AND o.status IN ('unknown','pending','confirmed') AND r.status='held'
   AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recoveries recovery WHERE recovery.residual_operation_id=o.id
    AND recovery.funding_plan_id=r.funding_plan_id AND recovery.host_merchant_id=r.host_merchant_id AND recovery.beneficiary_merchant_id=o.beneficiary_merchant_id
    AND recovery.provider=o.provider AND recovery.account_fingerprint=o.account_fingerprint AND recovery.provider_transfer_id=o.provider_transfer_id
    AND recovery.amount_cents=o.amount_cents AND r.held_reason='marketplace_residual_dispute_requires_reconciliation'
    AND EXISTS(SELECT 1 FROM marketplace_funding_plans f JOIN marketplace_order_ledgers l ON l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id
      WHERE f.payment_intent_id=recovery.funding_plan_id AND f.status='held' AND l.chargeback_at IS NOT NULL)))
 OR EXISTS(SELECT 1 FROM marketplace_payouts p JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id
  JOIN marketplace_order_ledgers l ON l.host_merchant_id=f.host_merchant_id AND l.order_id=f.provider_payment_id
  WHERE p.beneficiary_merchant_id=merchant_id AND p.status IN ('unknown','pending','confirmed') AND l.chargeback_at IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recoveries recovery WHERE recovery.payout_id=p.id AND recovery.funding_plan_id=f.payment_intent_id
    AND recovery.host_merchant_id=f.host_merchant_id AND recovery.beneficiary_merchant_id=p.beneficiary_merchant_id AND recovery.provider=p.provider
    AND recovery.account_fingerprint=p.account_fingerprint AND recovery.provider_transfer_id=p.provider_transfer_id AND recovery.amount_cents=p.amount_cents AND f.status='held')
   AND EXISTS(SELECT 1 FROM marketplace_transfer_reversals reversal JOIN marketplace_refund_plans r ON r.id=reversal.refund_plan_id WHERE r.funding_plan_id=f.payment_intent_id))
$$;

-- Only V4 changes: keep its original committed frontier after later refunds.
-- No function rename is used: both existing constraint triggers retain their OID
-- and execute this replacement. V1-V3 (and separately guarded Asaas V5) return.
CREATE OR REPLACE FUNCTION marketplace_residual_source_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_row marketplace_residual_plans;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN
  SELECT * INTO plan_row FROM marketplace_residual_plans WHERE id=NEW.id;
 ELSE
  SELECT * INTO plan_row FROM marketplace_residual_plans WHERE id=NEW.residual_plan_id;
 END IF;
 IF plan_row.basis->'version' IS DISTINCT FROM '4'::jsonb THEN RETURN NEW; END IF;
 IF (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=plan_row.id) IS DISTINCT FROM
   (SELECT COALESCE(sum(jsonb_array_length(value->'beneficiaries')),0) FROM jsonb_array_elements(plan_row.allocation->'sources'))
  THEN RAISE EXCEPTION 'marketplace_residual_source_operation_inventory_invalid'; END IF;
 IF NOT marketplace_residual_source_evidence_valid(plan_row.id) THEN RAISE EXCEPTION 'marketplace_residual_sources_funding_unproven'; END IF;
 IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=plan_row.funding_plan_id
   AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL))
  THEN RAISE EXCEPTION 'marketplace_residual_source_prior_transfer_unproven'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION marketplace_stripe_source_refund_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r marketplace_refund_plans; f marketplace_funding_plans; expected jsonb; target_id text;
BEGIN
 IF NOT NEW.request ? 'stripeSourceFunding' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM marketplace_refund_plans WHERE id=NEW.refund_plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id;
 IF f.provider_payment_id IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 END IF;
 IF TG_TABLE_NAME='marketplace_transfer_reversals' THEN target_id:=NEW.residual_operation_id; ELSE target_id:=NULL; END IF;
 expected:=marketplace_stripe_source_refund_expected_request(NEW.request->'stripeSourceFunding',target_id);
 IF expected IS NULL OR expected IS DISTINCT FROM NEW.request OR NEW.request_hash IS DISTINCT FROM expected->>'requestHash'
  OR NEW.provider IS DISTINCT FROM 'stripe' OR NEW.account_fingerprint IS DISTINCT FROM f.account_fingerprint
  OR NEW.reference IS DISTINCT FROM expected->>'reference' OR NEW.request#>>'{stripeSourceFunding,context,refundPlanId}' IS DISTINCT FROM r.id
  THEN RAISE EXCEPTION 'marketplace_stripe_source_request_binding_invalid'; END IF;
 IF TG_TABLE_NAME='marketplace_transfer_reversals' THEN
  IF NEW.amount_cents IS DISTINCT FROM (expected->>'amountCents')::integer THEN RAISE EXCEPTION 'marketplace_stripe_source_request_binding_invalid'; END IF;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'planned' OR NEW.version<>0 OR NEW.claimed_at IS NOT NULL OR NEW.provider_operation_id IS NOT NULL
   THEN RAISE EXCEPTION 'marketplace_stripe_source_initial_claim_invalid'; END IF;
 ELSIF OLD.claimed_at IS NULL AND NEW.claimed_at IS NOT NULL THEN
  IF OLD.status<>'planned' OR NEW.status<>'unknown' OR NEW.version<>OLD.version+1
   OR NOT marketplace_stripe_source_refund_evidence_valid(NEW.request->'stripeSourceFunding',true)
   THEN RAISE EXCEPTION 'marketplace_stripe_source_claim_unproven'; END IF;
  IF TG_TABLE_NAME='marketplace_refund_operations' AND EXISTS(SELECT 1 FROM marketplace_transfer_reversals reversal
   WHERE reversal.refund_plan_id=r.id AND (reversal.status<>'confirmed' OR reversal.provider_operation_id IS NULL OR reversal.claimed_at IS NULL OR reversal.reconciled_at IS NULL))
   THEN RAISE EXCEPTION 'marketplace_stripe_source_reversals_unproven'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE TRIGGER marketplace_stripe_source_refund_claim_guard BEFORE INSERT OR UPDATE ON marketplace_refund_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_refund_claim_guard();
CREATE TRIGGER marketplace_stripe_source_reversal_claim_guard BEFORE INSERT OR UPDATE ON marketplace_transfer_reversals
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_refund_claim_guard();

-- Complete inventory is checked at COMMIT, after all rows/outbox messages from
-- one financial transaction exist. Confirmed late GET receipts retain the frozen
-- request even when fresh admission is closed by a dispute or financial marker.
CREATE FUNCTION marketplace_stripe_source_refund_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r marketplace_refund_plans; funding jsonb; expected jsonb; refund_operation marketplace_refund_operations;
 reversal_row marketplace_transfer_reversals; required_row jsonb; target marketplace_residual_operations;
 event_row outbox_messages; expected_event jsonb; count_required integer; admission boolean:=false;
BEGIN
 IF TG_TABLE_NAME='marketplace_refund_plans' THEN SELECT * INTO r FROM marketplace_refund_plans WHERE id=NEW.id;
 ELSE SELECT * INTO r FROM marketplace_refund_plans WHERE id=NEW.refund_plan_id; END IF;
 IF r.id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO refund_operation FROM marketplace_refund_operations WHERE refund_plan_id=r.id;
 funding:=refund_operation.request->'stripeSourceFunding';
 IF funding IS NULL THEN SELECT request->'stripeSourceFunding' INTO funding FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id ORDER BY id LIMIT 1; END IF;
 IF funding IS NULL THEN
  IF EXISTS(SELECT 1 FROM marketplace_residual_plans residual WHERE residual.funding_plan_id=r.funding_plan_id AND residual.basis->'version'='4'::jsonb
   AND (r.allocation->>'cumulativeRefundCents')::bigint>(residual.allocation->>'refundedCents')::bigint)
   AND (refund_operation.id IS NOT NULL OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id))
   THEN RAISE EXCEPTION 'marketplace_stripe_source_context_required'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' AND TG_TABLE_NAME<>'marketplace_refund_plans' THEN admission:=true; END IF;
 IF NOT marketplace_stripe_source_refund_evidence_valid(funding,admission) THEN RAISE EXCEPTION 'marketplace_stripe_source_evidence_unproven'; END IF;
 count_required:=jsonb_array_length(funding#>'{plan,requiredReversals}');
 IF (SELECT count(*) FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id)<>count_required
  THEN RAISE EXCEPTION 'marketplace_stripe_source_operation_inventory_invalid'; END IF;
 FOR required_row IN SELECT value FROM jsonb_array_elements(funding#>'{plan,requiredReversals}') LOOP
  SELECT * INTO reversal_row FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id AND residual_operation_id=required_row->>'payoutId';
  SELECT * INTO target FROM marketplace_residual_operations WHERE id=required_row->>'payoutId';
  expected:=marketplace_stripe_source_refund_expected_request(funding,required_row->>'payoutId');
  IF reversal_row.id IS NULL OR target.id IS NULL OR reversal_row.payout_id IS NOT NULL OR target.residual_plan_id IS DISTINCT FROM funding#>>'{context,residual,residualPlanId}'
   OR target.source_id IS DISTINCT FROM required_row->>'sourceId' OR target.beneficiary_merchant_id IS DISTINCT FROM required_row->>'merchantId'
   OR reversal_row.host_merchant_id IS DISTINCT FROM r.host_merchant_id OR reversal_row.provider IS DISTINCT FROM 'stripe'
   OR reversal_row.account_fingerprint IS DISTINCT FROM expected->>'accountFingerprint'
   OR reversal_row.amount_cents IS DISTINCT FROM (required_row->>'amountCents')::integer OR reversal_row.request IS DISTINCT FROM expected
   OR reversal_row.request_hash IS DISTINCT FROM expected->>'requestHash' OR reversal_row.reference IS DISTINCT FROM expected->>'reference'
   THEN RAISE EXCEPTION 'marketplace_stripe_source_operation_binding_invalid'; END IF;
  IF reversal_row.status='confirmed' THEN
   SELECT * INTO event_row FROM outbox_messages WHERE event_id='marketplace_reversal_'||reversal_row.id;
   expected_event:=jsonb_build_object('reversal_operation_id',reversal_row.id,'refund_plan_id',r.id,'payout_id',NULL,
    'residual_operation_id',target.id,'amount_cents',reversal_row.amount_cents,'provider_reversal_id',reversal_row.provider_operation_id,'request_hash',reversal_row.request_hash);
   IF reversal_row.claimed_at IS NULL OR reversal_row.reconciled_at IS NULL OR reversal_row.provider_operation_id IS NULL OR reversal_row.provider_operation_id !~ '^trr_[A-Za-z0-9_]+$'
    OR event_row.event_type IS DISTINCT FROM 'marketplace.transfer_reversal.confirmed' OR event_row.merchant_id IS DISTINCT FROM r.host_merchant_id
    OR event_row.correlation_id IS DISTINCT FROM r.id OR event_row.causation_id IS DISTINCT FROM target.id
    OR event_row.producer IS DISTINCT FROM 'marketplace' OR event_row.schema_version IS DISTINCT FROM 1 OR event_row.payload IS DISTINCT FROM expected_event
    THEN RAISE EXCEPTION 'marketplace_stripe_source_reversal_receipt_unproven'; END IF;
  END IF;
 END LOOP;
 IF refund_operation.id IS NOT NULL THEN
  expected:=marketplace_stripe_source_refund_expected_request(funding);
  IF refund_operation.provider IS DISTINCT FROM 'stripe' OR refund_operation.account_fingerprint IS DISTINCT FROM expected->>'accountFingerprint'
   OR refund_operation.request IS DISTINCT FROM expected OR refund_operation.request_hash IS DISTINCT FROM expected->>'requestHash'
   OR refund_operation.reference IS DISTINCT FROM expected->>'reference' OR r.status NOT IN ('prepared','submitted','confirmed','failed')
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals WHERE refund_plan_id=r.id AND status<>'confirmed')
   THEN RAISE EXCEPTION 'marketplace_stripe_source_buyer_refund_binding_invalid'; END IF;
  IF refund_operation.status='confirmed' THEN
   SELECT * INTO event_row FROM outbox_messages WHERE event_id='marketplace_refund_'||r.id;
   expected_event:=jsonb_build_object('refund_plan_id',r.id,'return_id',r.return_id,'payment_intent_id',r.funding_plan_id,
    'order_id',(SELECT provider_payment_id FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id),
    'amount_cents',r.amount_cents,'cumulative_refund_cents',r.allocation->'cumulativeRefundCents','allocation_hash',r.allocation_hash,'provider_refund_id',refund_operation.provider_operation_id);
   IF r.status<>'confirmed' OR refund_operation.claimed_at IS NULL OR refund_operation.reconciled_at IS NULL
    OR refund_operation.provider_operation_id IS NULL OR refund_operation.provider_operation_id !~ '^re_[A-Za-z0-9_]+$'
    OR NOT EXISTS(SELECT 1 FROM returns WHERE id=r.return_id AND status::text='REFUND_COMPLETED')
    OR NOT EXISTS(SELECT 1 FROM return_refunds WHERE return_id=r.return_id AND id='mrefund_return_'||marketplace_contribution_hash(to_jsonb(r.id))
      AND status='COMPLETED' AND provider_refund_id=refund_operation.provider_operation_id AND payment_intent_id=r.funding_plan_id AND amount_in_cents=r.amount_cents)
    OR event_row.event_type IS DISTINCT FROM 'marketplace.refund.confirmed' OR event_row.merchant_id IS DISTINCT FROM r.host_merchant_id
    OR event_row.correlation_id IS DISTINCT FROM r.funding_plan_id OR event_row.causation_id IS DISTINCT FROM r.return_id
    OR event_row.producer IS DISTINCT FROM 'marketplace' OR event_row.schema_version IS DISTINCT FROM 1 OR event_row.payload IS DISTINCT FROM expected_event
    THEN RAISE EXCEPTION 'marketplace_stripe_source_buyer_receipt_unproven'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE CONSTRAINT TRIGGER marketplace_stripe_source_refund_plan_guard AFTER INSERT OR UPDATE ON marketplace_refund_plans
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_refund_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_stripe_source_refund_operation_guard AFTER INSERT OR UPDATE ON marketplace_refund_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_refund_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_stripe_source_reversal_operation_guard AFTER INSERT OR UPDATE ON marketplace_transfer_reversals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_refund_commit_guard();

-- Existing all-provider/account/native-ID unique indexes are deliberately kept,
-- including receipts from legacy requests. NULL means no certified receipt.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_refund_operations_receipt_key
 ON marketplace_refund_operations(provider,account_fingerprint,provider_operation_id);
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_transfer_reversals_receipt_key
 ON marketplace_transfer_reversals(provider,account_fingerprint,provider_operation_id);

CREATE FUNCTION marketplace_stripe_source_journal_deny_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='marketplace_refund_plans' THEN
  IF EXISTS(SELECT 1 FROM marketplace_residual_plans p WHERE p.funding_plan_id=OLD.funding_plan_id AND p.basis->'version'='4'::jsonb
   AND (OLD.allocation->>'cumulativeRefundCents')::bigint>(p.allocation->>'refundedCents')::bigint)
   THEN RAISE EXCEPTION 'marketplace_stripe_source_journal_immutable'; END IF;
 ELSIF OLD.request ? 'stripeSourceFunding' THEN RAISE EXCEPTION 'marketplace_stripe_source_journal_immutable'; END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER marketplace_stripe_source_refund_delete_guard BEFORE DELETE ON marketplace_refund_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_journal_deny_delete();
CREATE TRIGGER marketplace_stripe_source_refund_operation_delete_guard BEFORE DELETE ON marketplace_refund_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_journal_deny_delete();
CREATE TRIGGER marketplace_stripe_source_reversal_delete_guard BEFORE DELETE ON marketplace_transfer_reversals
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_journal_deny_delete();

CREATE FUNCTION marketplace_stripe_source_outbox_immutable_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE protected boolean;
BEGIN
 protected:=OLD.event_type='marketplace.financial_reconciliation_required'
  OR OLD.event_type='marketplace.refund.confirmed' AND EXISTS(SELECT 1 FROM marketplace_refund_operations o
    WHERE 'marketplace_refund_'||o.refund_plan_id=OLD.event_id AND o.request ? 'stripeSourceFunding')
  OR OLD.event_type='marketplace.transfer_reversal.confirmed' AND EXISTS(SELECT 1 FROM marketplace_transfer_reversals o
    WHERE 'marketplace_reversal_'||o.id=OLD.event_id AND o.request ? 'stripeSourceFunding')
  OR OLD.event_type='marketplace.residual.confirmed' AND EXISTS(SELECT 1 FROM marketplace_residual_operations o
    WHERE 'marketplace_residual_confirmed_'||o.id=OLD.event_id AND o.request->'version'='4'::jsonb);
 IF protected THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_stripe_source_outbox_immutable'; END IF;
  IF ROW(NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload,OLD.created_at)
   THEN RAISE EXCEPTION 'marketplace_stripe_source_outbox_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_stripe_source_outbox_immutable_guard BEFORE UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_outbox_immutable_guard();

CREATE FUNCTION marketplace_stripe_source_marker_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r marketplace_refund_plans; operation_row record; expected_event jsonb; expected_id text; expected_reason text;
BEGIN
 IF NEW.event_type IS DISTINCT FROM 'marketplace.financial_reconciliation_required' THEN RETURN NEW; END IF;
 IF NEW.event_id LIKE 'marketplace_refund_financial_reconciliation_%' THEN
  SELECT * INTO r FROM marketplace_refund_plans WHERE id=NEW.payload->>'refund_plan_id';
  SELECT * INTO operation_row FROM marketplace_refund_operations WHERE refund_plan_id=r.id;
  IF operation_row.id IS NULL OR NOT operation_row.request ? 'stripeSourceFunding' THEN RETURN NEW; END IF;
  expected_id:='marketplace_refund_financial_reconciliation_'||r.id; expected_reason:='marketplace_refund_provider_history_requires_reconciliation';
 ELSIF NEW.event_id LIKE 'marketplace_reversal_financial_reconciliation_%' THEN
  SELECT * INTO operation_row FROM marketplace_transfer_reversals WHERE id=NEW.payload->>'operation_id';
  IF operation_row.id IS NULL OR NOT operation_row.request ? 'stripeSourceFunding' THEN RETURN NEW; END IF;
  SELECT * INTO r FROM marketplace_refund_plans WHERE id=operation_row.refund_plan_id;
  expected_id:='marketplace_reversal_financial_reconciliation_'||operation_row.id; expected_reason:='marketplace_reversal_provider_history_requires_reconciliation';
 ELSE RETURN NEW; END IF;
 expected_event:=jsonb_build_object('refund_plan_id',r.id,'operation_id',operation_row.id,'payment_intent_id',r.funding_plan_id,
  'request_hash',operation_row.request_hash,'provider_operation_id',operation_row.provider_operation_id,'reason',expected_reason);
 IF operation_row.status IS DISTINCT FROM 'confirmed' OR operation_row.claimed_at IS NULL OR operation_row.reconciled_at IS NULL
  OR operation_row.provider_operation_id IS NULL OR NEW.event_id IS DISTINCT FROM expected_id OR NEW.payload IS DISTINCT FROM expected_event
  OR NEW.merchant_id IS DISTINCT FROM r.host_merchant_id OR NEW.correlation_id IS DISTINCT FROM r.funding_plan_id
  OR NEW.causation_id IS DISTINCT FROM operation_row.id OR NEW.producer IS DISTINCT FROM 'marketplace' OR NEW.schema_version IS DISTINCT FROM 1
  OR NOT EXISTS(SELECT 1 FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id AND status='held')
  THEN RAISE EXCEPTION 'marketplace_stripe_source_financial_marker_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_stripe_source_marker_binding_guard AFTER INSERT ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_stripe_source_marker_binding_guard();

CREATE FUNCTION marketplace_stripe_source_refund_plan_shape_valid(funding jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE ctx jsonb := funding->'context'; plan jsonb := funding->'plan';
  source_row jsonb; source_original jsonb; reversal_row jsonb; beneficiary_row jsonb;
  total_debit bigint := 0; total_reversal bigint; before_held bigint; after_held bigint;
  source_count integer; source_index integer; key_name text;
BEGIN
  IF jsonb_typeof(funding) IS DISTINCT FROM 'object'
    OR ctx->'version' IS DISTINCT FROM '1'::jsonb OR ctx->>'kind' IS DISTINCT FROM 'stripe_v4_refund_sources'
    OR plan->'version' IS DISTINCT FROM '1'::jsonb OR plan->>'kind' IS DISTINCT FROM 'stripe_v4_refund_sources'
    OR plan->>'contextHash' IS DISTINCT FROM marketplace_contribution_hash(ctx)
    OR plan->>'planHash' IS DISTINCT FROM marketplace_contribution_hash(plan-'planHash')
    OR plan->>'refundPlanId' IS DISTINCT FROM ctx->>'refundPlanId'
    OR ctx#>'{residual,basis,version}' IS DISTINCT FROM '4'::jsonb
    OR ctx#>'{residual,allocation,version}' IS DISTINCT FROM '4'::jsonb
    OR ctx#>'{residual,generation}' IS DISTINCT FROM '1'::jsonb
    OR ctx#>>'{residual,basisHash}' IS DISTINCT FROM marketplace_contribution_hash(ctx#>'{residual,basis}')
    OR ctx#>>'{residual,allocationHash}' IS DISTINCT FROM marketplace_contribution_hash(ctx#>'{residual,allocation}')
    OR NOT marketplace_residual_allocation_valid(ctx#>'{residual,allocation}')
    OR NOT marketplace_residual_source_cents(plan->'amountCents') OR (plan->>'amountCents')::bigint <= 0
    OR NOT marketplace_residual_source_cents(plan->'cumulativeRefundCents')
    OR (plan->>'cumulativeRefundCents')::bigint > (ctx#>>'{basis,budget,capture,amountCents}')::bigint
    OR jsonb_typeof(plan->'sources') IS DISTINCT FROM 'array'
    OR jsonb_typeof(plan->'requiredReversals') IS DISTINCT FROM 'array'
    OR jsonb_typeof(ctx->'history') IS DISTINCT FROM 'array'
    OR jsonb_array_length(ctx->'history') > 2000 THEN RETURN false; END IF;
  source_count := jsonb_array_length(plan->'sources');
  IF source_count NOT BETWEEN 2 AND 2001
    OR source_count <> jsonb_array_length(ctx#>'{residual,allocation,sources}')
    OR (SELECT count(DISTINCT entry.value->>'sourceId') FROM jsonb_array_elements(plan->'sources') entry) <> source_count
    OR jsonb_array_length(plan->'requiredReversals') > 2000
    OR (SELECT count(DISTINCT entry.value->>'payoutId') FROM jsonb_array_elements(plan->'requiredReversals') entry)
       <> jsonb_array_length(plan->'requiredReversals') THEN RETURN false; END IF;
  FOR source_index IN 0..source_count-1 LOOP
    source_row := plan->'sources'->source_index;
    source_original := ctx#>'{residual,allocation,sources}'->source_index;
    IF jsonb_typeof(source_row->'sourceId') IS DISTINCT FROM 'string'
      OR source_row->>'sourceId' IS DISTINCT FROM source_original->>'sourceId'
      OR source_row->>'chargeId' IS DISTINCT FROM source_original->>'chargeId'
      OR source_row->'creditedNetCents' IS DISTINCT FROM source_original->'creditedNetCents'
      OR jsonb_typeof(source_row->'beneficiaryBalances') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
    FOREACH key_name IN ARRAY ARRAY['creditedNetCents','refundedBeforeCents','refundDebitCents','refundedAfterCents',
      'netTransferredBeforeCents','reversalCents','platformBeforeCents','platformAfterCents','availableBeforeCents','availableAfterCents'] LOOP
      IF NOT marketplace_residual_source_cents(source_row->key_name) THEN RETURN false; END IF;
    END LOOP;
    IF (source_row->>'refundedAfterCents')::bigint <> (source_row->>'refundedBeforeCents')::bigint + (source_row->>'refundDebitCents')::bigint
      OR (source_row->>'reversalCents')::bigint > (source_row->>'netTransferredBeforeCents')::bigint
      OR (source_row->>'creditedNetCents')::bigint <> (source_row->>'refundedBeforeCents')::bigint +
         (source_row->>'platformBeforeCents')::bigint + (source_row->>'netTransferredBeforeCents')::bigint + (source_row->>'availableBeforeCents')::bigint
      OR (source_row->>'creditedNetCents')::bigint <> (source_row->>'refundedAfterCents')::bigint +
         (source_row->>'platformAfterCents')::bigint + (source_row->>'netTransferredBeforeCents')::bigint -
         (source_row->>'reversalCents')::bigint + (source_row->>'availableAfterCents')::bigint
      OR source_index > 0 AND ((source_row->>'platformBeforeCents')::bigint <> 0 OR (source_row->>'platformAfterCents')::bigint <> 0)
      THEN RETURN false; END IF;
    SELECT COALESCE(sum((entry.value->>'amountCents')::bigint),0) INTO total_reversal
      FROM jsonb_array_elements(plan->'requiredReversals') entry WHERE entry.value->>'sourceId'=source_row->>'sourceId';
    IF total_reversal <> (source_row->>'reversalCents')::bigint THEN RETURN false; END IF;
    before_held := 0; after_held := 0;
    FOR beneficiary_row IN SELECT value FROM jsonb_array_elements(source_row->'beneficiaryBalances') LOOP
      IF jsonb_typeof(beneficiary_row->'merchantId') IS DISTINCT FROM 'string' OR btrim(beneficiary_row->>'merchantId')=''
        OR NOT marketplace_residual_source_cents(beneficiary_row->'availableBeforeCents')
        OR NOT marketplace_residual_source_cents(beneficiary_row->'availableAfterCents')
        OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx#>'{basis,budget,beneficiaries}') entry
          WHERE entry.value->>'merchantId'=beneficiary_row->>'merchantId') THEN RETURN false; END IF;
      before_held := before_held + (beneficiary_row->>'availableBeforeCents')::bigint;
      after_held := after_held + (beneficiary_row->>'availableAfterCents')::bigint;
    END LOOP;
    IF before_held <> (source_row->>'availableBeforeCents')::bigint OR after_held <> (source_row->>'availableAfterCents')::bigint
      OR (SELECT count(DISTINCT entry.value->>'merchantId') FROM jsonb_array_elements(source_row->'beneficiaryBalances') entry)
        <> jsonb_array_length(source_row->'beneficiaryBalances') THEN RETURN false; END IF;
    total_debit := total_debit + (source_row->>'refundDebitCents')::bigint;
  END LOOP;
  FOR reversal_row IN SELECT value FROM jsonb_array_elements(plan->'requiredReversals') LOOP
    IF NOT marketplace_residual_source_cents(reversal_row->'amountCents') OR (reversal_row->>'amountCents')::bigint <= 0
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(ctx#>'{residual,operations}') operation_entry
        WHERE operation_entry.value->>'operationId'=reversal_row->>'payoutId'
          AND operation_entry.value->>'sourceId'=reversal_row->>'sourceId'
          AND operation_entry.value->>'merchantId'=reversal_row->>'merchantId'
          AND (operation_entry.value#>>'{request,amountCents}')::bigint >= (reversal_row->>'amountCents')::bigint) THEN RETURN false; END IF;
  END LOOP;
  RETURN total_debit=(plan->>'amountCents')::bigint;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_stripe_source_refund_expected_request(funding jsonb, target_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE c jsonb:=funding->'context'; p jsonb:=funding->'plan'; cap jsonb:=c#>'{basis,budget,capture}';
 target jsonb; reversal jsonb; previous jsonb; prior_reversals jsonb; raw jsonb;
BEGIN
 SELECT COALESCE(jsonb_agg(x.receipt ORDER BY x.position),'[]'::jsonb) INTO previous FROM (
  SELECT jsonb_build_object('providerOperationId',e.value->'providerOperationId','amountCents',e.value->'amountCents') receipt,e.ord position
    FROM jsonb_array_elements(c#>'{residual,basis,refunds}') WITH ORDINALITY e(value,ord)
  UNION ALL
  SELECT jsonb_build_object('providerOperationId',h.value->'providerOperationId','amountCents',r.value#>'{allocation,amountCents}'),
    jsonb_array_length(c#>'{residual,basis,refunds}')+h.ord
    FROM jsonb_array_elements(c->'history') WITH ORDINALITY h(value,ord)
    JOIN LATERAL jsonb_array_elements(c#>'{basis,refunds}') r(value) ON r.value->>'refundPlanId'=h.value->>'refundPlanId'
 ) x;
 IF target_id IS NOT NULL THEN
  SELECT value INTO target FROM jsonb_array_elements(c#>'{residual,operations}') WHERE value->>'operationId'=target_id;
  SELECT value INTO reversal FROM jsonb_array_elements(p->'requiredReversals') WHERE value->>'payoutId'=target_id;
  IF target IS NULL OR reversal IS NULL THEN RETURN NULL; END IF;
 END IF;
 raw:=jsonb_build_object('kind',CASE WHEN target_id IS NULL THEN 'refund' ELSE 'transfer_reversal' END,
  'provider','stripe','environment',cap->'environment','accountFingerprint',cap->'accountFingerprint',
  'providerPaymentId',cap->'providerPaymentId','sourceId',cap->'sourceId','paymentAmountCents',cap->'amountCents',
  'amountCents',CASE WHEN target_id IS NULL THEN p->'amountCents' ELSE reversal->'amountCents' END,
  'currency','BRL','previousRefunds',previous,'reference',CASE WHEN target_id IS NULL
   THEN 'mrefund_'||marketplace_contribution_hash(jsonb_build_array(c#>>'{basis,hostMerchantId}',c->>'returnId'))
   ELSE 'mreverse_'||marketplace_contribution_hash(jsonb_build_array(c#>>'{basis,hostMerchantId}',c->>'refundPlanId',target_id)) END,
  'stripeSourceFunding',funding);
 IF target_id IS NOT NULL THEN
  SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',r.value->'providerOperationId','amountCents',r.value->'amountCents',
   'reference',r.value->'reference','requestHash',r.value->'requestHash') ORDER BY h.ord,r.ord),'[]'::jsonb) INTO prior_reversals
   FROM jsonb_array_elements(c->'history') WITH ORDINALITY h(value,ord)
   CROSS JOIN LATERAL jsonb_array_elements(h.value->'reversals') WITH ORDINALITY r(value,ord) WHERE r.value->>'payoutId'=target_id;
  raw:=raw||jsonb_build_object('transfer',jsonb_build_object('kind','residual','requestHash',target#>'{request,requestHash}',
   'providerTransferId',target->'providerTransferId','destination',target#>'{request,destination}',
   'amountCents',target#>'{request,amountCents}','reference',target#>'{request,reference}')||
    CASE WHEN jsonb_array_length(prior_reversals)>0 THEN jsonb_build_object('previousReversals',prior_reversals) ELSE '{}'::jsonb END);
 END IF;
 RETURN raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw));
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

-- Replay only each beneficiary's cash and own transfers. Original-source room
-- belonging to a different merchant can never finance this refund.
CREATE FUNCTION marketplace_stripe_source_refund_replay_valid(funding jsonb)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb:=funding->'context'; snapshot jsonb:=c#>'{residual,allocation}'; expected jsonb;
 held jsonb:='{}'; held_before jsonb; reversed jsonb:='{}'; refunded jsonb:='{}'; debits jsonb;
 before_a jsonb; after_a jsonb; s jsonb; b jsonb; n jsonb; op record; row_refund record;
 step_context jsonb; step_sources jsonb; required jsonb; balances jsonb; raw jsonb;
 source_id text; merchant_id text; frontier integer; k integer; i integer; count_refunds integer;
 credit bigint; before_amount bigint; after_amount bigint; debit bigint; sent bigint; available bigint;
 needed bigint; take bigint; platform_release bigint; merchant_credit bigint;
 net_before bigint; reversed_now bigint; refunded_before bigint; before_cash bigint; after_cash bigint;
BEGIN
 IF NOT marketplace_stripe_source_refund_plan_shape_valid(funding) THEN RETURN false; END IF;
 frontier:=jsonb_array_length(c#>'{residual,basis,refunds}'); count_refunds:=jsonb_array_length(c#>'{basis,refunds}');
 IF frontier<1 OR count_refunds<>frontier+jsonb_array_length(c->'history')+1 OR count_refunds>2000 THEN RETURN false; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(snapshot->'sources') LOOP
  source_id:=s->>'sourceId'; held:=jsonb_set(held,ARRAY[source_id],'{}'::jsonb,true);
  refunded:=jsonb_set(refunded,ARRAY[source_id],s->'refundDebitCents',true);
 END LOOP;
 FOR k IN frontier..count_refunds-1 LOOP
  before_a:=c#>'{basis,refunds}'->(k-1)->'allocation'; after_a:=c#>'{basis,refunds}'->k->'allocation';
  held_before:=held; debits:='{}'; required:='[]'; merchant_credit:=0;
  FOR s IN SELECT value FROM jsonb_array_elements(snapshot->'sources') LOOP debits:=jsonb_set(debits,ARRAY[s->>'sourceId'],'0'::jsonb,true); END LOOP;
  platform_release:=(before_a->>'platformRemainingCents')::bigint-(after_a->>'platformRemainingCents')::bigint;
  FOR b IN SELECT value FROM jsonb_array_elements(before_a->'remainingBeneficiaries') ORDER BY value->>'merchantId' COLLATE "C" LOOP
   merchant_id:=b->>'merchantId';
   SELECT COALESCE(sum((certificate.value->>'creditCents')::bigint),0) INTO credit
    FROM jsonb_array_elements(c#>'{residual,basis,fundingContributions,certificates}') certificate
    WHERE certificate.value#>>'{request,merchantId}'=merchant_id;
   IF credit IS DISTINCT FROM COALESCE((SELECT (value->>'amountCents')::bigint FROM jsonb_array_elements(before_a->'requiredContributions') WHERE value->>'merchantId'=merchant_id),0)
    OR credit IS DISTINCT FROM COALESCE((SELECT (value->>'amountCents')::bigint FROM jsonb_array_elements(after_a->'requiredContributions') WHERE value->>'merchantId'=merchant_id),0)
    THEN RETURN false; END IF;
   SELECT value INTO n FROM jsonb_array_elements(after_a->'remainingBeneficiaries') WHERE value->>'merchantId'=merchant_id;
   IF n IS NULL THEN RETURN false; END IF;
   before_amount:=(b->>'amountCents')::bigint+credit; after_amount:=(n->>'amountCents')::bigint+credit;
   SELECT COALESCE(sum((o.value#>>'{request,amountCents}')::bigint-COALESCE((reversed->> (o.value->>'operationId'))::bigint,0)),0) INTO sent
    FROM jsonb_array_elements(c#>'{residual,operations}') o WHERE o.value->>'merchantId'=merchant_id;
   SELECT COALESCE(sum(COALESCE((value->>merchant_id)::bigint,0)),0) INTO available FROM jsonb_each(held_before);
   SELECT (value->>'amountCents')::bigint INTO debit FROM jsonb_array_elements(after_a->'merchantDebits') WHERE value->>'merchantId'=merchant_id;
   IF debit IS NULL OR before_amount<0 OR after_amount<0 OR sent+available<>before_amount OR before_amount-debit<>after_amount THEN RETURN false; END IF;
   IF debit<0 THEN
    merchant_credit:=merchant_credit-debit;
    held:=jsonb_set(held,ARRAY['original',merchant_id],to_jsonb(COALESCE((held#>>ARRAY['original',merchant_id])::bigint,0)-debit),true);
    CONTINUE;
   END IF;
   needed:=debit;
   FOR s IN SELECT value FROM jsonb_array_elements(snapshot->'sources') LOOP
    source_id:=s->>'sourceId'; available:=COALESCE((held#>>ARRAY[source_id,merchant_id])::bigint,0); take:=LEAST(needed,available);
    held:=jsonb_set(held,ARRAY[source_id,merchant_id],to_jsonb(available-take),true);
    debits:=jsonb_set(debits,ARRAY[source_id],to_jsonb((debits->>source_id)::bigint+take),true); needed:=needed-take;
   END LOOP;
   FOR op IN SELECT o.value FROM jsonb_array_elements(c#>'{residual,operations}') o
    JOIN LATERAL jsonb_array_elements(snapshot->'sources') WITH ORDINALITY source(value,ord) ON source.value->>'sourceId'=o.value->>'sourceId'
    WHERE o.value->>'merchantId'=merchant_id ORDER BY source.ord,o.value->>'operationId' COLLATE "C" LOOP
    take:=LEAST(needed,(op.value#>>'{request,amountCents}')::bigint-COALESCE((reversed->>(op.value->>'operationId'))::bigint,0));
    IF take>0 THEN
     required:=required||jsonb_build_array(jsonb_build_object('payoutId',op.value->'operationId','sourceId',op.value->'sourceId','merchantId',op.value->'merchantId','amountCents',take));
     source_id:=op.value->>'sourceId'; debits:=jsonb_set(debits,ARRAY[source_id],to_jsonb((debits->>source_id)::bigint+take),true);
     reversed:=jsonb_set(reversed,ARRAY[op.value->>'operationId'],to_jsonb(COALESCE((reversed->>(op.value->>'operationId'))::bigint,0)+take),true); needed:=needed-take;
    END IF;
   END LOOP;
   IF needed<>0 THEN RETURN false; END IF;
  END LOOP;
  IF platform_release<merchant_credit OR platform_release<0 THEN RETURN false; END IF;
  debits:=jsonb_set(debits,ARRAY['original'],to_jsonb((debits->>'original')::bigint+platform_release-merchant_credit),true);
  step_sources:='[]'; i:=0;
  FOR s IN SELECT value FROM jsonb_array_elements(snapshot->'sources') LOOP
   source_id:=s->>'sourceId';
   SELECT COALESCE(sum((o.value#>>'{request,amountCents}')::bigint-COALESCE((reversed->>(o.value->>'operationId'))::bigint,0)),0)
    INTO net_before FROM jsonb_array_elements(c#>'{residual,operations}') o WHERE o.value->>'sourceId'=source_id;
   SELECT COALESCE(sum((value->>'amountCents')::bigint),0) INTO reversed_now FROM jsonb_array_elements(required) WHERE value->>'sourceId'=source_id;
   net_before:=net_before+reversed_now; refunded_before:=(refunded->>source_id)::bigint;
   SELECT COALESCE(sum(value::bigint),0) INTO before_cash FROM jsonb_each_text(held_before->source_id);
   SELECT COALESCE(sum(value::bigint),0) INTO after_cash FROM jsonb_each_text(held->source_id);
   SELECT COALESCE(jsonb_agg(jsonb_build_object('merchantId',m.merchant,'availableBeforeCents',COALESCE((held_before#>>ARRAY[source_id,m.merchant])::bigint,0),
    'availableAfterCents',COALESCE((held#>>ARRAY[source_id,m.merchant])::bigint,0)) ORDER BY m.merchant COLLATE "C"),'[]'::jsonb) INTO balances FROM (
     SELECT key merchant FROM jsonb_each(held_before->source_id) UNION SELECT key FROM jsonb_each(held->source_id)) m
    WHERE COALESCE((held_before#>>ARRAY[source_id,m.merchant])::bigint,0)>0 OR COALESCE((held#>>ARRAY[source_id,m.merchant])::bigint,0)>0;
   step_sources:=step_sources||jsonb_build_array(jsonb_build_object('sourceId',s->'sourceId','chargeId',s->'chargeId','creditedNetCents',s->'creditedNetCents',
    'refundedBeforeCents',refunded_before,'refundDebitCents',debits->source_id,'refundedAfterCents',refunded_before+(debits->>source_id)::bigint,
    'netTransferredBeforeCents',net_before,'reversalCents',reversed_now,'platformBeforeCents',CASE WHEN i=0 THEN (before_a->>'platformRemainingCents')::bigint ELSE 0 END,
    'platformAfterCents',CASE WHEN i=0 THEN (after_a->>'platformRemainingCents')::bigint ELSE 0 END,'availableBeforeCents',before_cash,'availableAfterCents',after_cash,'beneficiaryBalances',balances));
   refunded:=jsonb_set(refunded,ARRAY[source_id],to_jsonb(refunded_before+(debits->>source_id)::bigint),true); i:=i+1;
  END LOOP;
  SELECT r.id,r.return_id INTO row_refund FROM marketplace_refund_plans r WHERE r.id=c#>'{basis,refunds}'->k->>'refundPlanId';
  IF row_refund.id IS NULL THEN RETURN false; END IF;
  step_context:=jsonb_set(c,'{basis,refunds}',(SELECT jsonb_agg(value ORDER BY ord) FROM jsonb_array_elements(c#>'{basis,refunds}') WITH ORDINALITY entries(value,ord) WHERE ord<=k+1));
  step_context:=jsonb_set(step_context,'{history}',(SELECT COALESCE(jsonb_agg(value ORDER BY ord),'[]'::jsonb) FROM jsonb_array_elements(c->'history') WITH ORDINALITY entries(value,ord) WHERE ord<=k-frontier));
  step_context:=step_context||jsonb_build_object('refundPlanId',row_refund.id,'returnId',row_refund.return_id);
  raw:=jsonb_build_object('version',1,'kind','stripe_v4_refund_sources','contextHash',marketplace_contribution_hash(step_context),
   'refundPlanId',row_refund.id,'amountCents',after_a->'amountCents','cumulativeRefundCents',after_a->'cumulativeRefundCents','sources',step_sources,'requiredReversals',required);
  expected:=raw||jsonb_build_object('planHash',marketplace_contribution_hash(raw));
  IF NOT marketplace_stripe_source_refund_plan_shape_valid(jsonb_build_object('context',step_context,'plan',expected)) THEN RETURN false; END IF;
  IF k=count_refunds-1 THEN
   IF step_context IS DISTINCT FROM c OR expected IS DISTINCT FROM funding->'plan' THEN RETURN false; END IF;
  ELSE
   IF c->'history'->(k-frontier)->>'planHash' IS DISTINCT FROM expected->>'planHash'
    OR NOT EXISTS(SELECT 1 FROM marketplace_refund_operations operation WHERE operation.refund_plan_id=row_refund.id
      AND operation.request->'stripeSourceFunding'=jsonb_build_object('context',step_context,'plan',expected)) THEN RETURN false; END IF;
  END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
