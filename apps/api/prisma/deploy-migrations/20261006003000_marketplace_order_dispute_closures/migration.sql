-- F02 closed profile: native full Stripe reinstatement, confirmed original
-- transfers, positive external seller fees paid with certified zero-excess
-- obligations and a frozen zero host fee. No funding or transfer is reopened.
CREATE TABLE marketplace_host_principal_extinctions (
 id text PRIMARY KEY CHECK(id ~ '^mhost_extinction_[a-f0-9]{64}$'),
 payout_id text NOT NULL UNIQUE REFERENCES marketplace_host_debts(payout_id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 provider_dispute_id text NOT NULL,
 closure_snapshot_id text NOT NULL REFERENCES marketplace_dispute_closure_snapshots(id) ON DELETE RESTRICT,
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 observation jsonb NOT NULL, evidence jsonb NOT NULL,
 evidence_hash text NOT NULL UNIQUE CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE marketplace_order_dispute_closures (
 id text PRIMARY KEY CHECK(id ~ '^morder_dispute_closure_[a-f0-9]{64}$'),
 funding_plan_id text NOT NULL UNIQUE REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 provider_dispute_id text NOT NULL,
 closure_snapshot_id text NOT NULL REFERENCES marketplace_dispute_closure_snapshots(id) ON DELETE RESTRICT,
 observation jsonb NOT NULL, evidence jsonb NOT NULL,
 evidence_hash text NOT NULL UNIQUE CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- HISTORICAL_VALIDATOR: explicit copy of the original frozen funding/request
-- bindings. It removes transport freshness and all locks for historical reads;
-- INSERT independently invokes the original fresh validator with observation.

CREATE FUNCTION marketplace_order_dispute_historical_validate(req jsonb, proof_body jsonb) RETURNS void LANGUAGE plpgsql STABLE AS $$
DECLARE f RECORD; raw jsonb; expected jsonb; entries jsonb; movement jsonb; orders text[];
  withdrawn bigint:=0; reinstated bigint:=0; fees bigint:=0; net_total bigint:=0;
  amount bigint; fee bigint; net bigint; observed timestamptz;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=req->>'paymentIntentId';
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_dispute_funding_unproven'; END IF;
 SELECT fp.*,pay.merchant_id AS payment_merchant,pay.provider_payment_id AS payment_provider,pay.status AS payment_status,
   pay.currency AS payment_currency,pay.amount_cents AS payment_amount,pay.approved_amount_cents,pay.commerce_order_id,pay.session_id,pay.creation,
   ledger.purchased_at,ledger.chargeback_at,ledger.checkout_session_id AS ledger_session
 INTO f FROM marketplace_funding_plans fp JOIN payment_intents pay ON pay.id=fp.payment_intent_id
 JOIN marketplace_order_ledgers ledger ON ledger.host_merchant_id=fp.host_merchant_id AND ledger.order_id=fp.provider_payment_id
 WHERE fp.payment_intent_id=req->>'paymentIntentId';
 IF NOT FOUND OR f.provider IS DISTINCT FROM 'stripe' OR f.status IS DISTINCT FROM 'held' OR f.funded_at IS NULL OR f.budget IS NULL
   OR f.host_merchant_id IS DISTINCT FROM req->>'hostMerchantId' OR f.payment_merchant IS DISTINCT FROM f.host_merchant_id
   OR f.payment_provider IS DISTINCT FROM f.provider_payment_id OR f.payment_currency IS DISTINCT FROM 'BRL'
   OR f.payment_amount IS DISTINCT FROM f.amount_cents OR f.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR (f.payment_status='approved' OR left(f.payment_status,11)='chargeback_') IS NOT TRUE
   OR f.chargeback_at IS NULL OR f.purchased_at IS NULL OR f.session_id IS DISTINCT FROM f.checkout_session_id OR f.ledger_session IS DISTINCT FROM f.checkout_session_id
   OR f.instructions_hash IS DISTINCT FROM marketplace_dispute_closure_hash(f.instructions)
   OR f.creation#>'{input,marketplaceFunding}' IS DISTINCT FROM f.instructions OR f.creation#>>'{input,provider}' IS DISTINCT FROM 'stripe'
   OR f.creation#>>'{input,providerAccountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR f.creation#>>'{input,merchantId}' IS DISTINCT FROM f.host_merchant_id OR f.creation#>>'{input,intentId}' IS DISTINCT FROM f.payment_intent_id
   OR f.creation#>>'{input,sessionId}' IS DISTINCT FROM f.checkout_session_id
   OR NULLIF(f.creation#>>'{input,stripeConnectAccountId}','') IS NOT NULL OR NULLIF(f.creation#>>'{input,merchantPayoutDestination}','') IS NOT NULL
   OR NULLIF(f.creation#>>'{input,settlementMode}','') IS NOT NULL
   OR f.instructions->>'hostMerchantId' IS DISTINCT FROM f.host_merchant_id OR f.instructions->>'provider' IS DISTINCT FROM 'stripe'
   OR f.instructions->>'environment' IS DISTINCT FROM f.environment OR f.instructions->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint
   OR f.instructions->'amountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>>'{capture,providerPaymentId}' IS DISTINCT FROM f.provider_payment_id OR f.budget#>>'{capture,provider}' IS DISTINCT FROM 'stripe'
   OR f.budget#>>'{capture,environment}' IS DISTINCT FROM f.environment OR f.budget#>>'{capture,accountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR f.budget#>>'{capture,currency}' IS DISTINCT FROM 'BRL' OR f.budget#>'{capture,amountCents}' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>'{capture,providerFeeCents}' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR f.budget#>'{capture,netAmountCents}' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
   OR f.budget->'payoutTotalCents' IS DISTINCT FROM to_jsonb(f.payout_total_cents)
   OR f.budget->'platformRetainedCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents)
   OR f.amount_cents-f.provider_fee_cents IS DISTINCT FROM f.net_amount_cents
   OR f.payout_total_cents+f.platform_retained_cents IS DISTINCT FROM f.net_amount_cents
   OR jsonb_typeof(f.instructions->'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(f.budget->'beneficiaries') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'marketplace_dispute_funding_unproven'; END IF;
 SELECT array_agg(order_id) INTO orders FROM (
   SELECT f.provider_payment_id order_id UNION SELECT f.commerce_order_id WHERE f.commerce_order_id IS NOT NULL
   UNION SELECT co.id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND (co.external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR co.session_id=f.session_id)
   UNION SELECT co.external_order_id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND co.external_order_id IS NOT NULL
     AND (co.external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR co.session_id=f.session_id)
 ) identities;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM returns WHERE merchant_id=f.host_merchant_id AND order_id=ANY(orders) AND status NOT IN ('REJECTED','CANCELLED'))
   OR EXISTS(SELECT 1 FROM return_refunds rf JOIN returns t ON t.id=rf.return_id
     WHERE t.merchant_id=f.host_merchant_id AND t.order_id=ANY(orders))
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals rv LEFT JOIN marketplace_payouts po ON po.id=rv.payout_id
     LEFT JOIN marketplace_refund_plans rp ON rp.id=rv.refund_plan_id LEFT JOIN marketplace_residual_operations ro ON ro.id=rv.residual_operation_id
     LEFT JOIN marketplace_residual_plans rg ON rg.id=ro.residual_plan_id
     WHERE po.funding_plan_id=f.payment_intent_id OR rp.funding_plan_id=f.payment_intent_id OR rg.funding_plan_id=f.payment_intent_id)
   OR (SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id) IS DISTINCT FROM
     (SELECT count(*) FROM jsonb_array_elements(f.budget->'beneficiaries') benef WHERE (benef->>'amountCents')::bigint>0)
   OR (SELECT count(DISTINCT beneficiary_merchant_id) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id) IS DISTINCT FROM
     (SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_payouts po WHERE po.funding_plan_id=f.payment_intent_id AND
     (po.provider IS DISTINCT FROM 'stripe' OR po.account_fingerprint IS DISTINCT FROM f.account_fingerprint
      OR po.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR po.currency IS DISTINCT FROM 'BRL'
      OR ((po.status IN ('planned','cancelled') AND po.claimed_at IS NULL AND po.provider_transfer_id IS NULL)
        OR (po.status='confirmed' AND po.claimed_at IS NOT NULL AND po.reconciled_at IS NOT NULL AND po.provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$')) IS NOT TRUE
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') benef WHERE benef->>'merchantId'=po.beneficiary_merchant_id
        AND benef->>'destination'=po.destination AND (benef->>'amountCents')::bigint=po.amount_cents)))
   THEN RAISE EXCEPTION 'marketplace_dispute_history_unproven'; END IF;
 raw:=jsonb_build_object('version',1,'hostMerchantId',f.host_merchant_id,'paymentIntentId',f.payment_intent_id,
   'checkoutSessionId',f.checkout_session_id,'instructionsHash',f.instructions_hash,'budgetHash',marketplace_dispute_closure_hash(f.budget),
   'provider','stripe','environment',f.environment,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
   'sourceId',f.budget#>'{capture,sourceId}','captureBalanceTransactionId',f.budget#>'{capture,balanceTransactionId}',
   'captureFeeCents',f.budget#>'{capture,providerFeeCents}','captureNetCents',f.budget#>'{capture,netAmountCents}',
   'providerDisputeId',req->>'providerDisputeId','amountCents',f.amount_cents,'currency','BRL','feePolicy','proportional_seller_sales_v1',
   'sales',(SELECT jsonb_agg(jsonb_build_object('lineItemId',sale->'lineItemId','sellerMerchantId',sale->'sellerMerchantId',
     'grossAmountCents',sale->'grossAmountCents','commissionCents',sale->'commissionCents') ORDER BY (sale->>'lineItemId') COLLATE "C")
     FROM jsonb_array_elements(f.instructions->'lines') sale));
 expected:=raw||jsonb_build_object('requestHash',marketplace_dispute_closure_hash(raw));
 IF req IS DISTINCT FROM expected OR req->>'providerDisputeId' !~ '^(dp|du)_[A-Za-z0-9_]+$'
   OR req->>'sourceId' !~ '^ch_[A-Za-z0-9_]+$' OR req->>'providerPaymentId' !~ '^pi_[A-Za-z0-9_]+$'
   OR req->>'captureBalanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$' OR req->>'accountFingerprint' !~ '^[a-f0-9]{64}$'
   OR f.instructions->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR jsonb_array_length(req->'sales') NOT BETWEEN 1 AND 2000
   OR (SELECT count(DISTINCT value->>'lineItemId') FROM jsonb_array_elements(req->'sales'))<>jsonb_array_length(req->'sales')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(req->'sales') sale WHERE COALESCE(length(sale->>'lineItemId')>0
     AND length(sale->>'sellerMerchantId')>0 AND jsonb_typeof(sale->'grossAmountCents')='number' AND jsonb_typeof(sale->'commissionCents')='number'
     AND (sale->>'grossAmountCents')::numeric>0 AND trunc((sale->>'grossAmountCents')::numeric)=(sale->>'grossAmountCents')::numeric
     AND (sale->>'commissionCents')::numeric>=0 AND trunc((sale->>'commissionCents')::numeric)=(sale->>'commissionCents')::numeric
     AND (sale->>'commissionCents')::numeric<(sale->>'grossAmountCents')::numeric,false) IS NOT TRUE)
   OR (SELECT sum((sale->>'grossAmountCents')::bigint) FROM jsonb_array_elements(req->'sales') sale)>f.amount_cents
   THEN RAISE EXCEPTION 'marketplace_dispute_request_unproven'; END IF;
 observed:=(proof_body->>'observedAt')::timestamptz;
 IF observed IS NULL
   OR COALESCE(proof_body->'version'='1'::jsonb AND proof_body->>'requestHash'=req->>'requestHash'
     AND proof_body->>'provider'='stripe' AND proof_body->>'environment'=req->>'environment'
     AND proof_body->>'accountFingerprint'=req->>'accountFingerprint' AND proof_body->>'providerPaymentId'=req->>'providerPaymentId'
     AND proof_body->>'sourceId'=req->>'sourceId' AND proof_body->>'providerDisputeId'=req->>'providerDisputeId'
     AND proof_body->'amountCents'=req->'amountCents' AND proof_body->>'currency'='BRL' AND proof_body->>'status' IN ('won','lost')
     AND jsonb_typeof(proof_body->'entries')='array',false) IS NOT TRUE
   THEN RAISE EXCEPTION 'marketplace_dispute_proof_unproven'; END IF;
 entries:=proof_body->'entries';
 IF jsonb_array_length(entries)<>(CASE WHEN proof_body->>'status'='won' THEN 2 ELSE 1 END)
   OR (SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries)
   THEN RAISE EXCEPTION 'marketplace_dispute_proof_unproven'; END IF;
 FOR movement IN SELECT value FROM jsonb_array_elements(entries) LOOP
   IF COALESCE(movement->>'balanceTransactionId' ~ '^txn_[A-Za-z0-9_]+$'
     AND movement->>'balanceTransactionId'<>req->>'captureBalanceTransactionId'
     AND jsonb_typeof(movement->'amountCents')='number' AND jsonb_typeof(movement->'feeCents')='number' AND jsonb_typeof(movement->'netCents')='number'
     AND abs((movement->>'amountCents')::numeric)<=2147483647 AND abs((movement->>'feeCents')::numeric)<=2147483647 AND abs((movement->>'netCents')::numeric)<=2147483647
     AND trunc((movement->>'amountCents')::numeric)=(movement->>'amountCents')::numeric
     AND trunc((movement->>'feeCents')::numeric)=(movement->>'feeCents')::numeric AND trunc((movement->>'netCents')::numeric)=(movement->>'netCents')::numeric
     AND jsonb_typeof(movement->'created')='number' AND jsonb_typeof(movement->'availableOn')='number'
     AND trunc((movement->>'created')::numeric)=(movement->>'created')::numeric AND trunc((movement->>'availableOn')::numeric)=(movement->>'availableOn')::numeric
     AND (movement->>'created')::numeric>0 AND (movement->>'availableOn')::numeric>0
     AND to_timestamp((movement->>'created')::double precision)<=observed+interval '60 seconds'
     AND to_timestamp((movement->>'availableOn')::double precision)<=observed+interval '60 seconds',false) IS NOT TRUE
     THEN RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   amount:=(movement->>'amountCents')::bigint; fee:=(movement->>'feeCents')::bigint; net:=(movement->>'netCents')::bigint;
   IF amount-fee<>net THEN RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   IF movement->>'kind'='principal_withdrawal' AND amount=-f.amount_cents AND fee>=0 THEN withdrawn:=withdrawn-amount;
   ELSIF movement->>'kind'='principal_reinstatement' AND amount=f.amount_cents AND fee<=0 THEN reinstated:=reinstated+amount;
   ELSE RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   fees:=fees+fee; net_total:=net_total+net;
 END LOOP;
 IF withdrawn<>f.amount_cents OR reinstated<>(CASE WHEN proof_body->>'status'='won' THEN f.amount_cents ELSE 0 END)
   OR fees NOT BETWEEN 0 AND 2147483647 OR abs(net_total)>2147483647 OR net_total<>reinstated-withdrawn-fees
   OR proof_body->'principalWithdrawnCents' IS DISTINCT FROM to_jsonb(withdrawn)
   OR proof_body->'principalReinstatedCents' IS DISTINCT FROM to_jsonb(reinstated)
   OR proof_body->'providerFeeCents' IS DISTINCT FROM to_jsonb(fees) OR proof_body->'balanceDeltaCents' IS DISTINCT FROM to_jsonb(net_total)
   THEN RAISE EXCEPTION 'marketplace_dispute_totals_unproven'; END IF;
END $$;

CREATE FUNCTION marketplace_order_dispute_proof_hash(proof jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT marketplace_contribution_hash((proof-'observedAt'-'entries')||jsonb_build_object('entries',
   (SELECT jsonb_agg(value ORDER BY(value->>'balanceTransactionId') COLLATE "C") FROM jsonb_array_elements(proof->'entries'))))
$$;

CREATE FUNCTION marketplace_order_dispute_basis(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE f RECORD; s RECORD; native RECORD; ledger RECORD; event_payload jsonb; native_count integer;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=target_funding;
 IF NOT FOUND OR f.status IS DISTINCT FROM 'held' THEN RETURN NULL; END IF;
 SELECT * INTO s FROM marketplace_dispute_closure_snapshots
   WHERE funding_plan_id=target_funding AND proof->>'status'='won';
 IF NOT FOUND OR (SELECT count(*) FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=target_funding AND proof->>'status'='won')<>1
   OR marketplace_seller_dispute_native_proof_valid(s.request,s.proof) IS NOT TRUE
   OR s.proof_hash IS DISTINCT FROM marketplace_order_dispute_proof_hash(s.proof)
   OR s.request_hash IS DISTINCT FROM s.request->>'requestHash'
   OR s.host_merchant_id IS DISTINCT FROM f.host_merchant_id
   OR s.id IS DISTINCT FROM 'mdispute_snapshot_'||marketplace_contribution_hash(jsonb_build_array(f.host_merchant_id,target_funding,s.provider_dispute_id,s.proof_hash))
   OR s.observed_at IS DISTINCT FROM (s.proof->>'observedAt')::timestamptz
   OR s.fee_allocation IS DISTINCT FROM marketplace_dispute_fee_allocation(s.request,(s.proof->>'providerFeeCents')::bigint)
   THEN RETURN NULL; END IF;
 PERFORM marketplace_order_dispute_historical_validate(s.request,s.proof);
 -- This terminal profile admits no other financial/cargo operation history.
 IF EXISTS(SELECT 1 FROM marketplace_shipment_journals WHERE funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits WHERE funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_contribution_checkouts WHERE funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_contribution_excess_liabilities WHERE funding_plan_id=target_funding)
   OR (SELECT count(DISTINCT provider_transfer_id) FROM marketplace_payouts WHERE funding_plan_id=target_funding)
       <>(SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_payouts p WHERE p.funding_plan_id=target_funding AND
     (p.status IS DISTINCT FROM 'confirmed' OR p.claimed_at IS NULL OR p.reconciled_at IS NULL
      OR COALESCE(p.provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$',false) IS NOT TRUE
      OR COALESCE(p.destination ~ '^acct_[A-Za-z0-9_]+$',false) IS NOT TRUE
      OR p.amount_cents<=0 OR p.kind IS DISTINCT FROM CASE WHEN p.beneficiary_merchant_id=f.host_merchant_id THEN 'host_receivable' ELSE 'seller_settlement' END))
   THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=target_funding AND provider_dispute_id=s.provider_dispute_id)<>2
   OR EXISTS(SELECT 1 FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=target_funding AND provider_dispute_id<>s.provider_dispute_id)
   THEN RETURN NULL; END IF;
 FOR native IN SELECT * FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=target_funding LOOP
   IF native.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR native.provider IS DISTINCT FROM 'stripe'
     OR native.environment IS DISTINCT FROM f.environment OR native.account_fingerprint IS DISTINCT FROM f.account_fingerprint
     OR native.request_hash IS DISTINCT FROM s.request_hash OR native.request IS DISTINCT FROM s.request
     OR native.entry_hash IS DISTINCT FROM marketplace_contribution_hash(native.entry)
     OR native.provider_balance_transaction_id IS DISTINCT FROM native.entry->>'balanceTransactionId'
     OR native.id IS DISTINCT FROM 'mdispute_entry_'||marketplace_contribution_hash(jsonb_build_array('stripe',f.environment,f.account_fingerprint,native.provider_balance_transaction_id))
     OR marketplace_seller_dispute_native_proof_valid(s.request,native.proof) IS NOT TRUE
     OR native.proof_hash IS DISTINCT FROM marketplace_order_dispute_proof_hash(native.proof)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.proof->'entries') movement WHERE movement=native.entry)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(native.proof->'entries') movement WHERE movement=native.entry)
     THEN RETURN NULL; END IF;
 END LOOP;
 SELECT jsonb_build_object('funding_plan_id',target_funding,'provider_dispute_id',s.provider_dispute_id,
   'request_hash',s.request_hash,'proof_hash',s.proof_hash,'status','won',
   'principal_withdrawn_cents',s.proof->'principalWithdrawnCents','principal_reinstated_cents',s.proof->'principalReinstatedCents',
   'provider_fee_cents',s.proof->'providerFeeCents','balance_delta_cents',s.proof->'balanceDeltaCents',
   'new_entry_count',count(*),
   'principal_withdrawn_delta_cents',COALESCE(sum(-(entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_withdrawal'),0),
   'principal_reinstated_delta_cents',COALESCE(sum((entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_reinstatement'),0),
   'provider_fee_delta_cents',COALESCE(sum((entry->>'feeCents')::bigint),0),
   'account_balance_delta_cents',COALESCE(sum((entry->>'netCents')::bigint),0),
   'fee_allocation',s.fee_allocation,'fee_collection_state','uncollected','hold_release_proven',false)
 INTO event_payload FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=target_funding AND proof_hash=s.proof_hash;
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=s.id AND event_type='marketplace.dispute.closure_observed'
   AND merchant_id=f.host_merchant_id AND correlation_id=target_funding AND causation_id=s.provider_dispute_id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload) THEN RETURN NULL; END IF;
 SELECT * INTO ledger FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id;
 RETURN jsonb_build_object('funding',to_jsonb(f),'snapshot',to_jsonb(s),'chargebackAt',to_char(ledger.chargeback_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_host_principal_extinction_evidence(target_payout text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE p RECORD; d RECORD; b jsonb; f jsonb; s jsonb; req jsonb; proof jsonb; host_fee bigint;
BEGIN
 SELECT * INTO p FROM marketplace_payouts WHERE id=target_payout;
 IF NOT FOUND OR p.kind IS DISTINCT FROM 'host_receivable' THEN RETURN NULL; END IF;
 SELECT * INTO d FROM marketplace_host_debts WHERE payout_id=target_payout;
 IF NOT FOUND OR d.host_merchant_id IS DISTINCT FROM p.beneficiary_merchant_id OR d.amount_cents IS DISTINCT FROM p.amount_cents
   OR d.recovery_id IS NOT NULL OR (d.status='outstanding' AND d.resolved_at IS NULL OR d.status='extinguished' AND d.resolved_at IS NOT NULL) IS NOT TRUE
   THEN RETURN NULL; END IF;
 b:=marketplace_order_dispute_basis(p.funding_plan_id); IF b IS NULL THEN RETURN NULL; END IF;
 f:=b->'funding'; s:=b->'snapshot'; req:=s->'request'; proof:=s->'proof';
 IF d.host_merchant_id IS DISTINCT FROM f->>'host_merchant_id' THEN RETURN NULL; END IF;
 host_fee:=COALESCE((SELECT (value->>'feeCents')::bigint FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'=d.host_merchant_id),0);
 RETURN jsonb_build_object('version',1,'reason','stripe_host_dispute_principal_extinguished','payoutId',p.id,'hostMerchantId',d.host_merchant_id,
   'fundingPlanId',p.funding_plan_id,'providerDisputeId',s->'provider_dispute_id','closureSnapshotId',s->'id','requestHash',s->'request_hash','proofHash',s->'proof_hash',
   'instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash','provider','stripe','environment',f->'environment','accountFingerprint',f->'account_fingerprint',
   'providerPaymentId',f->'provider_payment_id','sourceId',req->'sourceId','chargebackAt',b->'chargebackAt','providerTransferId',p.provider_transfer_id,'amountCents',d.amount_cents,
   'withdrawal',(SELECT value FROM jsonb_array_elements(proof->'entries') WHERE value->>'kind'='principal_withdrawal'),
   'reinstatement',(SELECT value FROM jsonb_array_elements(proof->'entries') WHERE value->>'kind'='principal_reinstatement'),
   'disputeFeeCents',proof->'providerFeeCents','hostDisputeFeeCents',host_fee,'feeCollectionState','uncollected','fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_host_principal_extinction_valid(target_payout text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; expected jsonb; req jsonb; event_payload jsonb;
BEGIN
 SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE payout_id=target_payout; IF NOT FOUND THEN RETURN false; END IF;
 expected:=marketplace_host_principal_extinction_evidence(target_payout);
 SELECT request INTO req FROM marketplace_dispute_closure_snapshots WHERE id=c.closure_snapshot_id;
 IF expected IS NULL OR c.evidence IS DISTINCT FROM expected OR c.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR c.id IS DISTINCT FROM 'mhost_extinction_'||marketplace_contribution_hash(jsonb_build_array(c.host_merchant_id,c.funding_plan_id,c.payout_id))
   OR c.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR c.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR c.provider_dispute_id IS DISTINCT FROM expected->>'providerDisputeId' OR c.closure_snapshot_id IS DISTINCT FROM expected->>'closureSnapshotId'
   OR c.amount_cents IS DISTINCT FROM (expected->>'amountCents')::integer
   OR marketplace_seller_dispute_native_proof_valid(req,c.observation) IS NOT TRUE
   OR marketplace_order_dispute_proof_hash(c.observation) IS DISTINCT FROM expected->>'proofHash'
   OR NOT EXISTS(SELECT 1 FROM marketplace_host_debts WHERE payout_id=target_payout AND status='extinguished' AND resolved_at IS NOT NULL AND recovery_id IS NULL)
   THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('certificate_id',c.id,'payout_id',c.payout_id,'funding_plan_id',c.funding_plan_id,'host_merchant_id',c.host_merchant_id,
   'provider_dispute_id',c.provider_dispute_id,'evidence_hash',c.evidence_hash,'principal_amount_cents',c.amount_cents,'host_dispute_fee_cents',expected->'hostDisputeFeeCents',
   'fee_collection_state','uncollected','funding_hold_released',false,'payout_reauthorized',false);
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.host_principal_extinguished'
   AND merchant_id=c.host_merchant_id AND correlation_id=c.funding_plan_id AND causation_id=c.payout_id AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_order_dispute_closure_evidence(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE b jsonb; f jsonb; s jsonb; req jsonb; proof jsonb; host jsonb; host_principal jsonb:=null; allocation jsonb;
 p RECORD; c RECORD; o RECORD; e jsonb; seller_refs jsonb:='[]'::jsonb; payout_refs jsonb; collected bigint:=0; processing bigint:=0; external_count integer:=0;
BEGIN
 b:=marketplace_order_dispute_basis(target_funding); IF b IS NULL THEN RETURN NULL; END IF;
 f:=b->'funding'; s:=b->'snapshot'; req:=s->'request'; proof:=s->'proof';
 IF (proof->>'providerFeeCents')::bigint<=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(req->'sales') WHERE value->>'sellerMerchantId'=f->>'host_merchant_id')
   THEN RETURN NULL; END IF;
 SELECT value INTO host FROM jsonb_array_elements(f#>'{budget,beneficiaries}') WHERE value->>'merchantId'=f->>'host_merchant_id';
 IF host IS NULL OR (host->>'amountCents')::bigint<0
   OR COALESCE((SELECT (value->>'feeCents')::bigint FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'=f->>'host_merchant_id'),0)<>0
   THEN RETURN NULL; END IF;
 IF (host->>'amountCents')::bigint>0 THEN
   SELECT * INTO p FROM marketplace_payouts WHERE funding_plan_id=target_funding AND kind='host_receivable';
   IF NOT FOUND OR marketplace_host_principal_extinction_valid(p.id) IS NOT TRUE THEN RETURN NULL; END IF;
   SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE payout_id=p.id;
   host_principal:=jsonb_build_object('certificateId',c.id,'evidenceHash',c.evidence_hash,'payoutId',p.id,'amountCents',c.amount_cents);
 ELSE
   IF EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=target_funding AND kind='host_receivable')
     OR EXISTS(SELECT 1 FROM marketplace_host_debts d JOIN marketplace_payouts po ON po.id=d.payout_id WHERE po.funding_plan_id=target_funding)
     OR EXISTS(SELECT 1 FROM marketplace_host_principal_extinctions WHERE funding_plan_id=target_funding) THEN RETURN NULL; END IF;
 END IF;
 FOR allocation IN SELECT value FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'<>f->>'host_merchant_id' ORDER BY(value->>'sellerMerchantId') COLLATE "C" LOOP
   external_count:=external_count+1;
   IF (allocation->>'feeCents')::bigint<=0 THEN RETURN NULL; END IF;
   SELECT * INTO p FROM marketplace_payouts WHERE funding_plan_id=target_funding AND beneficiary_merchant_id=allocation->>'sellerMerchantId' AND kind='seller_settlement';
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT oo.* INTO o FROM marketplace_seller_dispute_obligations oo JOIN marketplace_debt_principal_extinctions pc ON pc.id=oo.fee_certificate_id
     WHERE oo.funding_plan_id=target_funding AND oo.seller_merchant_id=allocation->>'sellerMerchantId' AND pc.payout_id=p.id;
   IF NOT FOUND OR marketplace_seller_dispute_obligation_valid(o.debt_id) IS NOT TRUE THEN RETURN NULL; END IF;
   e:=o.evidence;
   IF e->>'providerDisputeId' IS DISTINCT FROM s->>'provider_dispute_id' OR e->>'closureSnapshotId' IS DISTINCT FROM s->>'id'
     OR e->'principalAmountCents' IS DISTINCT FROM to_jsonb(p.amount_cents) OR e->'disputeFeeCents' IS DISTINCT FROM allocation->'feeCents'
     OR e->'collectedFeeCents' IS DISTINCT FROM allocation->'feeCents' OR e->'excessLiabilityCents' IS DISTINCT FROM '0'::jsonb
     THEN RETURN NULL; END IF;
   collected:=collected+(e->>'collectedFeeCents')::bigint; processing:=processing+(e->>'processingFeeCents')::bigint;
   seller_refs:=seller_refs||jsonb_build_array(jsonb_build_object('obligationId',o.id,'debtId',o.debt_id,'payoutId',p.id,'sellerMerchantId',o.seller_merchant_id,
     'feeCertificateId',o.fee_certificate_id,'feeCertificateHash',e->'feeCertificateHash','obligationEvidenceHash',o.evidence_hash,'principalAmountCents',e->'principalAmountCents',
     'disputeFeeCents',e->'disputeFeeCents','collectedFeeCents',e->'collectedFeeCents','processingFeeCents',e->'processingFeeCents','creditHashes',e->'creditHashes'));
 END LOOP;
 IF external_count=0 OR collected<>(proof->>'providerFeeCents')::bigint OR processing NOT BETWEEN 0 AND 2147483647
   OR (SELECT count(*) FROM marketplace_seller_dispute_obligations WHERE funding_plan_id=target_funding)<>external_count
   OR (SELECT count(*) FROM marketplace_seller_debts d JOIN marketplace_settlements st ON st.id=d.settlement_id
       WHERE st.host_merchant_id=f->>'host_merchant_id' AND st.order_id=f->>'provider_payment_id')<>external_count
   THEN RETURN NULL; END IF;
 SELECT jsonb_agg(jsonb_build_object('payoutId',id,'beneficiaryMerchantId',beneficiary_merchant_id,'kind',kind,'destination',destination,
   'amountCents',amount_cents,'providerTransferId',provider_transfer_id) ORDER BY id COLLATE "C") INTO payout_refs FROM marketplace_payouts WHERE funding_plan_id=target_funding;
 RETURN jsonb_build_object('version',1,'reason','stripe_order_dispute_closed','hostMerchantId',f->'host_merchant_id','fundingPlanId',target_funding,
   'providerDisputeId',s->'provider_dispute_id','closureSnapshotId',s->'id','requestHash',s->'request_hash','proofHash',s->'proof_hash',
   'instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash','provider','stripe','environment',f->'environment','accountFingerprint',f->'account_fingerprint',
   'providerPaymentId',f->'provider_payment_id','sourceId',req->'sourceId','chargebackAt',b->'chargebackAt','principalReinstatedCents',proof->'principalReinstatedCents',
   'disputeFeeCents',proof->'providerFeeCents','hostDisputeFeeCents',0,'collectedFeeCents',collected,'processingFeeCents',processing,'excessLiabilityCents',0,
   'hostPrincipal',host_principal,'sellerObligations',seller_refs,'payouts',payout_refs,'originalFundingStatus','held','operationalHoldClosed',true,'fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_order_dispute_closure_valid(target_funding text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; expected jsonb; req jsonb; event_payload jsonb;
BEGIN
 SELECT * INTO c FROM marketplace_order_dispute_closures WHERE funding_plan_id=target_funding; IF NOT FOUND THEN RETURN false; END IF;
 expected:=marketplace_order_dispute_closure_evidence(target_funding);
 SELECT request INTO req FROM marketplace_dispute_closure_snapshots WHERE id=c.closure_snapshot_id;
 IF expected IS NULL OR c.evidence IS DISTINCT FROM expected OR c.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR c.id IS DISTINCT FROM 'morder_dispute_closure_'||marketplace_contribution_hash(jsonb_build_array(c.host_merchant_id,c.funding_plan_id))
   OR c.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR c.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR c.provider_dispute_id IS DISTINCT FROM expected->>'providerDisputeId' OR c.closure_snapshot_id IS DISTINCT FROM expected->>'closureSnapshotId'
   OR marketplace_seller_dispute_native_proof_valid(req,c.observation) IS NOT TRUE
   OR marketplace_order_dispute_proof_hash(c.observation) IS DISTINCT FROM expected->>'proofHash' THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('certificate_id',c.id,'funding_plan_id',c.funding_plan_id,'host_merchant_id',c.host_merchant_id,'provider_dispute_id',c.provider_dispute_id,
   'evidence_hash',c.evidence_hash,'principal_reinstated_cents',expected->'principalReinstatedCents','dispute_fee_cents',expected->'disputeFeeCents','host_dispute_fee_cents',0,
   'collected_fee_cents',expected->'collectedFeeCents','processing_fee_cents',expected->'processingFeeCents','excess_liability_cents',0,
   'original_funding_status','held','operational_hold_closed',true,'funding_hold_released',false,'payout_reauthorized',false);
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.order_dispute_closed'
   AND merchant_id=c.host_merchant_id AND correlation_id=c.funding_plan_id AND causation_id=c.provider_dispute_id AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_order_dispute_certificate_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb; snapshot RECORD; expected_id text;
BEGIN
 SELECT * INTO snapshot FROM marketplace_dispute_closure_snapshots WHERE id=NEW.closure_snapshot_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_order_dispute_closure_unproven'; END IF;
 -- Fresh proof is actual GET input; no historical timestamp is rewritten.
 PERFORM marketplace_dispute_closure_validate(snapshot.request,NEW.observation);
 IF marketplace_order_dispute_proof_hash(NEW.observation) IS DISTINCT FROM snapshot.proof_hash
   THEN RAISE EXCEPTION 'marketplace_order_dispute_observation_mismatch'; END IF;
 IF TG_TABLE_NAME='marketplace_host_principal_extinctions' THEN
   PERFORM 1 FROM marketplace_host_debts WHERE payout_id=NEW.payout_id FOR UPDATE;
   expected:=marketplace_host_principal_extinction_evidence(NEW.payout_id);
   expected_id:='mhost_extinction_'||marketplace_contribution_hash(jsonb_build_array(NEW.host_merchant_id,NEW.funding_plan_id,NEW.payout_id));
   IF NEW.amount_cents IS DISTINCT FROM (expected->>'amountCents')::integer THEN RAISE EXCEPTION 'marketplace_host_principal_extinction_unproven'; END IF;
 ELSE
   expected:=marketplace_order_dispute_closure_evidence(NEW.funding_plan_id);
   expected_id:='morder_dispute_closure_'||marketplace_contribution_hash(jsonb_build_array(NEW.host_merchant_id,NEW.funding_plan_id));
 END IF;
 IF expected IS NULL OR NEW.id IS DISTINCT FROM expected_id OR NEW.evidence IS DISTINCT FROM expected
   OR NEW.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR NEW.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR NEW.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR NEW.provider_dispute_id IS DISTINCT FROM expected->>'providerDisputeId' OR NEW.closure_snapshot_id IS DISTINCT FROM expected->>'closureSnapshotId'
   THEN RAISE EXCEPTION 'marketplace_order_dispute_closure_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_host_principal_extinction_insert BEFORE INSERT ON marketplace_host_principal_extinctions FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_insert_guard();
CREATE TRIGGER marketplace_order_dispute_closure_insert BEFORE INSERT ON marketplace_order_dispute_closures FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_insert_guard();
CREATE TRIGGER marketplace_host_principal_extinction_immutable BEFORE UPDATE OR DELETE ON marketplace_host_principal_extinctions FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();
CREATE TRIGGER marketplace_order_dispute_closure_immutable BEFORE UPDATE OR DELETE ON marketplace_order_dispute_closures FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();

-- HOST_DEBT_GUARD: isolated host copy. The original resolved/recovery branch
-- remains unchanged; seller trigger and its existing certificates are untouched.

CREATE FUNCTION marketplace_host_debt_principal_valid() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; target_payout TEXT; beneficiary TEXT; old_json JSONB; new_json JSONB;
BEGIN
 IF NEW.status NOT IN ('outstanding','resolved','deducted','extinguished') OR NEW.amount_cents<=0 THEN RAISE EXCEPTION 'marketplace_debt_evidence_required'; END IF;
 IF TG_OP='UPDATE' THEN
  old_json:=to_jsonb(OLD); new_json:=to_jsonb(NEW);
  IF (old_json-ARRAY['status','resolved_at','recovery_id']) IS DISTINCT FROM (new_json-ARRAY['status','resolved_at','recovery_id']) THEN RAISE EXCEPTION 'marketplace_debt_binding_immutable'; END IF;
  IF OLD.status IN ('resolved','deducted','extinguished') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_debt_resolution_terminal'; END IF;
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
 ELSIF NEW.status='extinguished' AND (TG_OP='INSERT' OR OLD.status<>'extinguished') THEN
  IF NEW.recovery_id IS NOT NULL OR NEW.resolved_at IS NULL
   OR NOT EXISTS(SELECT 1 FROM marketplace_host_principal_extinctions e JOIN marketplace_payouts p ON p.id=e.payout_id
    WHERE e.payout_id=NEW.payout_id AND e.host_merchant_id=NEW.host_merchant_id AND e.amount_cents=NEW.amount_cents
     AND p.funding_plan_id=e.funding_plan_id AND p.kind='host_receivable' AND p.beneficiary_merchant_id=NEW.host_merchant_id)
   THEN RAISE EXCEPTION 'marketplace_host_principal_extinction_evidence_required'; END IF;
 ELSIF NEW.status='outstanding' AND (NEW.recovery_id IS NOT NULL OR NEW.resolved_at IS NOT NULL) THEN RAISE EXCEPTION 'marketplace_debt_evidence_required';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER marketplace_host_debt_recovery_valid_trigger ON marketplace_host_debts;
CREATE TRIGGER marketplace_host_debt_recovery_valid_trigger BEFORE INSERT OR UPDATE ON marketplace_host_debts
 FOR EACH ROW EXECUTE FUNCTION marketplace_host_debt_principal_valid();

CREATE FUNCTION marketplace_order_dispute_certificate_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE host_payout text; order_funding text; event text;
BEGIN
 IF TG_TABLE_NAME='marketplace_host_principal_extinctions' THEN host_payout:=NEW.payout_id;
 ELSIF TG_TABLE_NAME='marketplace_order_dispute_closures' THEN order_funding:=NEW.funding_plan_id;
 ELSIF TG_TABLE_NAME='marketplace_host_debts' THEN
   IF NEW.status IS DISTINCT FROM 'extinguished' THEN RETURN NULL; END IF; host_payout:=NEW.payout_id;
 ELSE
   event:=CASE WHEN TG_OP='DELETE' THEN OLD.event_id ELSE NEW.event_id END;
   SELECT payout_id INTO host_payout FROM marketplace_host_principal_extinctions WHERE id=event;
   SELECT funding_plan_id INTO order_funding FROM marketplace_order_dispute_closures WHERE id=event;
   IF TG_OP='UPDATE' THEN
     IF host_payout IS NULL THEN SELECT payout_id INTO host_payout FROM marketplace_host_principal_extinctions WHERE id=OLD.event_id; END IF;
     IF order_funding IS NULL THEN SELECT funding_plan_id INTO order_funding FROM marketplace_order_dispute_closures WHERE id=OLD.event_id; END IF;
     IF (host_payout IS NOT NULL OR order_funding IS NOT NULL) AND
       (to_jsonb(NEW)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at']) IS DISTINCT FROM
       (to_jsonb(OLD)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
       THEN RAISE EXCEPTION 'marketplace_order_dispute_outbox_immutable'; END IF;
   END IF;
   IF TG_OP<>'DELETE' AND (NEW.event_type='marketplace.host_principal_extinguished' AND host_payout IS NULL
       OR NEW.event_type='marketplace.order_dispute_closed' AND order_funding IS NULL)
     THEN RAISE EXCEPTION 'marketplace_order_dispute_commit_incomplete'; END IF;
 END IF;
 IF host_payout IS NOT NULL AND marketplace_host_principal_extinction_valid(host_payout) IS NOT TRUE
   OR order_funding IS NOT NULL AND marketplace_order_dispute_closure_valid(order_funding) IS NOT TRUE
   THEN RAISE EXCEPTION 'marketplace_order_dispute_commit_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_host_principal_extinction_commit AFTER INSERT ON marketplace_host_principal_extinctions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_order_dispute_closure_commit AFTER INSERT ON marketplace_order_dispute_closures DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_host_principal_debt_commit AFTER INSERT OR UPDATE ON marketplace_host_debts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_order_dispute_outbox_commit AFTER INSERT OR UPDATE OR DELETE ON outbox_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_order_dispute_certificate_commit_guard();
