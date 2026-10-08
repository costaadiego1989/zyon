-- F02: close only the original seller principal plus its fully collected,
-- proportional positive Stripe dispute fee. This append-only certificate grants
-- no funding release, payout permission, excess return or historical mutation.
CREATE TABLE marketplace_seller_dispute_obligations (
 id text PRIMARY KEY CHECK(id ~ '^mseller_obligation_[a-f0-9]{64}$'),
 debt_id text NOT NULL UNIQUE REFERENCES marketplace_seller_debts(id) ON DELETE RESTRICT,
 fee_certificate_id text NOT NULL UNIQUE REFERENCES marketplace_debt_principal_extinctions(id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 seller_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 evidence jsonb NOT NULL,
 evidence_hash text NOT NULL UNIQUE CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX marketplace_seller_dispute_obligation_seller
 ON marketplace_seller_dispute_obligations(seller_merchant_id,funding_plan_id);

-- Validate native ledger observations at their original observation time. This
-- pure historical predicate neither calls a PSP nor claims fresh native proof.
CREATE FUNCTION marketplace_seller_dispute_native_proof_valid(req jsonb,proof jsonb)
 RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE movement jsonb; observed timestamptz; withdrawn bigint:=0; reinstated bigint:=0;
 fees bigint:=0; balance_delta bigint:=0; amount bigint; fee bigint; net bigint;
BEGIN
 observed:=(proof->>'observedAt')::timestamptz;
 IF observed IS NULL OR proof->'version' IS DISTINCT FROM '1'::jsonb
   OR proof->>'requestHash' IS DISTINCT FROM req->>'requestHash' OR proof->>'provider' IS DISTINCT FROM 'stripe'
   OR proof->>'environment' IS DISTINCT FROM req->>'environment'
   OR proof->>'accountFingerprint' IS DISTINCT FROM req->>'accountFingerprint'
   OR proof->>'providerPaymentId' IS DISTINCT FROM req->>'providerPaymentId'
   OR proof->>'sourceId' IS DISTINCT FROM req->>'sourceId' OR proof->>'providerDisputeId' IS DISTINCT FROM req->>'providerDisputeId'
   OR proof->'amountCents' IS DISTINCT FROM req->'amountCents' OR proof->>'currency' IS DISTINCT FROM 'BRL'
   OR COALESCE(proof->>'status' IN ('won','lost'),false) IS NOT TRUE
   OR jsonb_typeof(proof->'entries') IS DISTINCT FROM 'array'
   THEN RETURN false; END IF;
 IF jsonb_array_length(proof->'entries')<>(CASE WHEN proof->>'status'='won' THEN 2 ELSE 1 END)
   OR (SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(proof->'entries'))
      <>jsonb_array_length(proof->'entries') THEN RETURN false; END IF;
 FOR movement IN SELECT value FROM jsonb_array_elements(proof->'entries') LOOP
   IF COALESCE(movement->>'balanceTransactionId' ~ '^txn_[A-Za-z0-9_]+$'
     AND movement->>'balanceTransactionId'<>req->>'captureBalanceTransactionId'
     AND jsonb_typeof(movement->'amountCents')='number' AND jsonb_typeof(movement->'feeCents')='number'
     AND jsonb_typeof(movement->'netCents')='number'
     AND abs((movement->>'amountCents')::numeric)<=2147483647 AND abs((movement->>'feeCents')::numeric)<=2147483647
     AND abs((movement->>'netCents')::numeric)<=2147483647
     AND trunc((movement->>'amountCents')::numeric)=(movement->>'amountCents')::numeric
     AND trunc((movement->>'feeCents')::numeric)=(movement->>'feeCents')::numeric
     AND trunc((movement->>'netCents')::numeric)=(movement->>'netCents')::numeric
     AND jsonb_typeof(movement->'created')='number' AND jsonb_typeof(movement->'availableOn')='number'
     AND trunc((movement->>'created')::numeric)=(movement->>'created')::numeric
     AND trunc((movement->>'availableOn')::numeric)=(movement->>'availableOn')::numeric
     AND (movement->>'created')::numeric>0 AND (movement->>'availableOn')::numeric>0
     AND to_timestamp((movement->>'created')::double precision)<=observed+interval '60 seconds'
     AND to_timestamp((movement->>'availableOn')::double precision)<=observed+interval '60 seconds',false) IS NOT TRUE
     THEN RETURN false; END IF;
   amount:=(movement->>'amountCents')::bigint; fee:=(movement->>'feeCents')::bigint; net:=(movement->>'netCents')::bigint;
   IF amount-fee IS DISTINCT FROM net THEN RETURN false; END IF;
   IF movement->>'kind'='principal_withdrawal' AND amount=-(req->>'amountCents')::bigint AND fee>=0 THEN
     withdrawn:=withdrawn-amount;
   ELSIF movement->>'kind'='principal_reinstatement' AND amount=(req->>'amountCents')::bigint AND fee<=0 THEN
     reinstated:=reinstated+amount;
   ELSE RETURN false;
   END IF;
   fees:=fees+fee; balance_delta:=balance_delta+net;
 END LOOP;
 RETURN withdrawn=(req->>'amountCents')::bigint
   AND reinstated=(CASE WHEN proof->>'status'='won' THEN (req->>'amountCents')::bigint ELSE 0 END)
   AND fees BETWEEN 0 AND 2147483647 AND abs(balance_delta)<=2147483647
   AND balance_delta=reinstated-withdrawn-fees
   AND proof->'principalWithdrawnCents'=to_jsonb(withdrawn) AND proof->'principalReinstatedCents'=to_jsonb(reinstated)
   AND proof->'providerFeeCents'=to_jsonb(fees) AND proof->'balanceDeltaCents'=to_jsonb(balance_delta);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Return exactly one canonical eligible obligation, or NULL. All reads use the
-- current database snapshot; mutable dispatcher lease fields are irrelevant.
CREATE FUNCTION marketplace_seller_dispute_obligation_evidence(target_debt_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE d RECORD; c RECORD; f RECORD; p RECORD; st RECORD; ledger RECORD; payment RECORD; snapshot RECORD;
 native RECORD; credit RECORD; req jsonb; raw_request jsonb; expected_certificate jsonb;
 normalized jsonb; withdrawal jsonb; reinstatement jsonb; event_payload jsonb; credit_hashes jsonb:='[]'::jsonb;
 collected bigint:=0; processing_fee bigint:=0; due bigint; credit_count integer:=0;
BEGIN
 SELECT * INTO d FROM marketplace_seller_debts WHERE id=target_debt_id;
 IF NOT FOUND OR d.status IS DISTINCT FROM 'extinguished' OR d.recovery_id IS NOT NULL
   OR d.deducted_from_settlement_id IS NOT NULL OR d.resolved_at IS NULL OR d.amount_cents<=0 THEN RETURN NULL; END IF;
 SELECT * INTO c FROM marketplace_debt_principal_extinctions WHERE debt_id=d.id;
 IF NOT FOUND OR c.evidence->'version' IS DISTINCT FROM '2'::jsonb
   OR c.evidence->>'reason' IS DISTINCT FROM 'stripe_dispute_principal_extinguished'
   OR c.evidence->>'feeCollectionState' IS DISTINCT FROM 'uncollected'
   OR c.evidence->'fundingHoldReleased' IS DISTINCT FROM 'false'::jsonb
   OR c.evidence->'payoutReauthorized' IS DISTINCT FROM 'false'::jsonb
   OR c.seller_merchant_id IS DISTINCT FROM d.seller_merchant_id OR c.amount_cents IS DISTINCT FROM d.amount_cents
   OR c.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(c.evidence)
   OR c.id IS DISTINCT FROM 'mdebt_extinction_'||marketplace_contribution_hash(jsonb_build_array(c.host_merchant_id,c.funding_plan_id,d.id))
   THEN RETURN NULL; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=c.funding_plan_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO p FROM marketplace_payouts WHERE id=c.payout_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO st FROM marketplace_settlements WHERE id=d.settlement_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO ledger FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO payment FROM payment_intents WHERE id=f.payment_intent_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO snapshot FROM marketplace_dispute_closure_snapshots WHERE id=c.closure_snapshot_id;
 IF NOT FOUND THEN RETURN NULL; END IF;
 req:=snapshot.request;
 IF f.provider IS DISTINCT FROM 'stripe' OR f.host_merchant_id IS DISTINCT FROM c.host_merchant_id
   OR f.environment NOT IN ('test','live') OR COALESCE(f.account_fingerprint ~ '^[a-f0-9]{64}$',false) IS NOT TRUE
   OR f.funded_at IS NULL OR f.instructions_hash IS DISTINCT FROM marketplace_contribution_hash(f.instructions)
   OR f.instructions->>'hostMerchantId' IS DISTINCT FROM f.host_merchant_id OR f.instructions->>'provider' IS DISTINCT FROM 'stripe'
   OR f.instructions->>'environment' IS DISTINCT FROM f.environment OR f.instructions->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint
   OR f.instructions->>'currency' IS DISTINCT FROM 'BRL' OR f.instructions->'amountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.instructions->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR jsonb_typeof(f.instructions->'lines') IS DISTINCT FROM 'array'
   OR jsonb_typeof(f.budget->'beneficiaries') IS DISTINCT FROM 'array'
   OR f.budget->'version' IS DISTINCT FROM '1'::jsonb OR f.budget->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR f.budget#>>'{capture,providerPaymentId}' IS DISTINCT FROM f.provider_payment_id
   OR f.budget#>>'{capture,provider}' IS DISTINCT FROM 'stripe' OR f.budget#>>'{capture,environment}' IS DISTINCT FROM f.environment
   OR f.budget#>>'{capture,accountFingerprint}' IS DISTINCT FROM f.account_fingerprint OR f.budget#>>'{capture,currency}' IS DISTINCT FROM 'BRL'
   OR f.budget#>'{capture,amountCents}' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>'{capture,providerFeeCents}' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR f.budget#>'{capture,netAmountCents}' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
   OR f.budget->'payoutTotalCents' IS DISTINCT FROM to_jsonb(f.payout_total_cents)
   OR f.budget->'platformRetainedCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents)
   OR f.amount_cents-f.provider_fee_cents IS DISTINCT FROM f.net_amount_cents
   OR f.payout_total_cents+f.platform_retained_cents IS DISTINCT FROM f.net_amount_cents
   OR payment.merchant_id IS DISTINCT FROM f.host_merchant_id OR payment.provider_payment_id IS DISTINCT FROM f.provider_payment_id
   OR payment.session_id IS DISTINCT FROM f.checkout_session_id OR payment.currency IS DISTINCT FROM 'BRL'
   OR payment.amount_cents IS DISTINCT FROM f.amount_cents OR payment.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR payment.creation#>'{input,marketplaceFunding}' IS DISTINCT FROM f.instructions
   OR payment.creation#>>'{input,provider}' IS DISTINCT FROM 'stripe'
   OR payment.creation#>>'{input,providerAccountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR ledger.purchased_at IS NULL OR ledger.chargeback_at IS NULL OR ledger.checkout_session_id IS DISTINCT FROM f.checkout_session_id
   OR st.status IS DISTINCT FROM 'chargeback_debt' OR st.host_merchant_id IS DISTINCT FROM f.host_merchant_id
   OR st.seller_merchant_id IS DISTINCT FROM d.seller_merchant_id OR st.order_id IS DISTINCT FROM f.provider_payment_id
   OR st.chargeback_at IS DISTINCT FROM ledger.chargeback_at
   OR p.settlement_id IS DISTINCT FROM d.settlement_id OR p.funding_plan_id IS DISTINCT FROM f.payment_intent_id
   OR p.kind IS DISTINCT FROM 'seller_settlement' OR p.beneficiary_merchant_id IS DISTINCT FROM d.seller_merchant_id
   OR p.provider IS DISTINCT FROM 'stripe' OR p.account_fingerprint IS DISTINCT FROM f.account_fingerprint
   OR p.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR p.currency IS DISTINCT FROM 'BRL'
   OR p.status IS DISTINCT FROM 'confirmed' OR p.claimed_at IS NULL OR p.reconciled_at IS NULL
   OR p.amount_cents IS DISTINCT FROM d.amount_cents OR COALESCE(p.provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') beneficiary
     WHERE beneficiary->>'merchantId'=d.seller_merchant_id AND beneficiary->>'destination'=p.destination
       AND beneficiary->'amountCents'=to_jsonb(d.amount_cents))
   OR snapshot.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR snapshot.host_merchant_id IS DISTINCT FROM f.host_merchant_id
   OR snapshot.provider_dispute_id IS DISTINCT FROM c.provider_dispute_id OR snapshot.request_hash IS DISTINCT FROM c.request_hash
   OR snapshot.proof_hash IS DISTINCT FROM c.proof_hash OR snapshot.proof->>'status' IS DISTINCT FROM 'won'
   OR marketplace_seller_dispute_native_proof_valid(req,snapshot.proof) IS NOT TRUE
   OR marketplace_seller_dispute_native_proof_valid(req,c.observation) IS NOT TRUE
   THEN RETURN NULL; END IF;
 raw_request:=jsonb_build_object('version',1,'hostMerchantId',f.host_merchant_id,'paymentIntentId',f.payment_intent_id,
   'checkoutSessionId',f.checkout_session_id,'instructionsHash',f.instructions_hash,'budgetHash',marketplace_contribution_hash(f.budget),
   'provider','stripe','environment',f.environment,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
   'sourceId',f.budget#>'{capture,sourceId}','captureBalanceTransactionId',f.budget#>'{capture,balanceTransactionId}',
   'captureFeeCents',f.budget#>'{capture,providerFeeCents}','captureNetCents',f.budget#>'{capture,netAmountCents}',
   'providerDisputeId',c.provider_dispute_id,'amountCents',f.amount_cents,'currency','BRL','feePolicy','proportional_seller_sales_v1',
   'sales',(SELECT jsonb_agg(jsonb_build_object('lineItemId',sale->'lineItemId','sellerMerchantId',sale->'sellerMerchantId',
     'grossAmountCents',sale->'grossAmountCents','commissionCents',sale->'commissionCents') ORDER BY (sale->>'lineItemId') COLLATE "C")
       FROM jsonb_array_elements(f.instructions->'lines') sale));
 IF req IS DISTINCT FROM raw_request||jsonb_build_object('requestHash',marketplace_contribution_hash(raw_request))
   OR req->>'requestHash' IS DISTINCT FROM c.request_hash
   OR COALESCE(req->>'providerDisputeId' ~ '^(dp|du)_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(req->>'providerPaymentId' ~ '^pi_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(req->>'sourceId' ~ '^ch_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(req->>'captureBalanceTransactionId' ~ '^txn_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR snapshot.fee_allocation IS DISTINCT FROM marketplace_dispute_fee_allocation(req,(snapshot.proof->>'providerFeeCents')::bigint)
   THEN RETURN NULL; END IF;
 SELECT (snapshot.proof-'observedAt'-'entries')||jsonb_build_object('entries',jsonb_agg(value ORDER BY(value->>'balanceTransactionId') COLLATE "C"))
   INTO normalized FROM jsonb_array_elements(snapshot.proof->'entries');
 IF c.proof_hash IS DISTINCT FROM marketplace_contribution_hash(normalized) THEN RETURN NULL; END IF;
 SELECT (c.observation-'observedAt'-'entries')||jsonb_build_object('entries',jsonb_agg(value ORDER BY(value->>'balanceTransactionId') COLLATE "C"))
   INTO normalized FROM jsonb_array_elements(c.observation->'entries');
 IF c.proof_hash IS DISTINCT FROM marketplace_contribution_hash(normalized) THEN RETURN NULL; END IF;
 IF (SELECT count(*) FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=f.payment_intent_id AND provider_dispute_id=c.provider_dispute_id)<>2
   THEN RETURN NULL; END IF;
 FOR native IN SELECT * FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=f.payment_intent_id AND provider_dispute_id=c.provider_dispute_id LOOP
   IF native.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR native.provider IS DISTINCT FROM 'stripe'
     OR native.environment IS DISTINCT FROM f.environment OR native.account_fingerprint IS DISTINCT FROM f.account_fingerprint
     OR native.request_hash IS DISTINCT FROM c.request_hash OR native.request IS DISTINCT FROM req
     OR native.entry_hash IS DISTINCT FROM marketplace_contribution_hash(native.entry)
     OR native.provider_balance_transaction_id IS DISTINCT FROM native.entry->>'balanceTransactionId'
     OR native.id IS DISTINCT FROM 'mdispute_entry_'||marketplace_contribution_hash(jsonb_build_array(
       'stripe',f.environment,f.account_fingerprint,native.provider_balance_transaction_id))
     OR marketplace_seller_dispute_native_proof_valid(req,native.proof) IS NOT TRUE
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot.proof->'entries') movement WHERE movement=native.entry)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(native.proof->'entries') movement WHERE movement=native.entry)
     THEN RETURN NULL; END IF;
   SELECT (native.proof-'observedAt'-'entries')||jsonb_build_object('entries',jsonb_agg(value ORDER BY(value->>'balanceTransactionId') COLLATE "C"))
     INTO normalized FROM jsonb_array_elements(native.proof->'entries');
   IF native.proof_hash IS DISTINCT FROM marketplace_contribution_hash(normalized) THEN RETURN NULL; END IF;
 END LOOP;
 SELECT value INTO withdrawal FROM jsonb_array_elements(snapshot.proof->'entries') WHERE value->>'kind'='principal_withdrawal';
 SELECT value INTO reinstatement FROM jsonb_array_elements(snapshot.proof->'entries') WHERE value->>'kind'='principal_reinstatement';
 expected_certificate:=jsonb_build_object('version',2,'reason','stripe_dispute_principal_extinguished',
   'debtId',d.id,'sellerMerchantId',d.seller_merchant_id,'settlementId',d.settlement_id,'payoutId',p.id,
   'hostMerchantId',f.host_merchant_id,'fundingPlanId',f.payment_intent_id,'providerDisputeId',c.provider_dispute_id,
   'closureSnapshotId',snapshot.id,'requestHash',c.request_hash,'proofHash',c.proof_hash,'provider','stripe',
   'environment',f.environment,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
   'sourceId',req->'sourceId','instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash',
   'chargebackAt',to_char(ledger.chargeback_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'providerTransferId',p.provider_transfer_id,'amountCents',d.amount_cents,'withdrawal',withdrawal,'reinstatement',reinstatement,
   'disputeFeeCents',snapshot.proof->'providerFeeCents','fundingHoldReleased',false,'payoutReauthorized',false,
   'sellerDisputeFeeCents',(SELECT value->'feeCents' FROM jsonb_array_elements(snapshot.fee_allocation)
     WHERE value->>'sellerMerchantId'=d.seller_merchant_id),'feeAllocation',snapshot.fee_allocation,'feeCollectionState','uncollected');
 IF c.evidence IS DISTINCT FROM expected_certificate THEN RETURN NULL; END IF;
 due:=(c.evidence->>'sellerDisputeFeeCents')::bigint;
 IF due NOT BETWEEN 1 AND 2147483647 OR (c.evidence->>'disputeFeeCents')::bigint<=0 THEN RETURN NULL; END IF;
 SELECT jsonb_build_object('funding_plan_id',f.payment_intent_id,'provider_dispute_id',c.provider_dispute_id,
   'request_hash',c.request_hash,'proof_hash',c.proof_hash,'status','won',
   'principal_withdrawn_cents',snapshot.proof->'principalWithdrawnCents','principal_reinstated_cents',snapshot.proof->'principalReinstatedCents',
   'provider_fee_cents',snapshot.proof->'providerFeeCents','balance_delta_cents',snapshot.proof->'balanceDeltaCents',
   'new_entry_count',count(*),
   'principal_withdrawn_delta_cents',COALESCE(sum(-(entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_withdrawal'),0),
   'principal_reinstated_delta_cents',COALESCE(sum((entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_reinstatement'),0),
   'provider_fee_delta_cents',COALESCE(sum((entry->>'feeCents')::bigint),0),'account_balance_delta_cents',COALESCE(sum((entry->>'netCents')::bigint),0),
   'fee_allocation',snapshot.fee_allocation,'fee_collection_state','uncollected','hold_release_proven',false) INTO event_payload
   FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=f.payment_intent_id AND provider_dispute_id=c.provider_dispute_id AND proof_hash=c.proof_hash;
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=snapshot.id AND event_type='marketplace.dispute.closure_observed'
   AND merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id AND causation_id=c.provider_dispute_id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload) THEN RETURN NULL; END IF;
 event_payload:=jsonb_build_object('certificate_id',c.id,'debt_id',d.id,'payout_id',p.id,'funding_plan_id',f.payment_intent_id,
   'seller_merchant_id',d.seller_merchant_id,'provider_dispute_id',c.provider_dispute_id,'amount_cents',d.amount_cents,
   'evidence_hash',c.evidence_hash,'reason','stripe_dispute_principal_extinguished','dispute_fee_cents',c.evidence->'disputeFeeCents',
   'funding_hold_released',false,'payout_reauthorized',false,'certificate_version',2,'fee_collection_state','uncollected',
   'seller_dispute_fee_cents',due,'fee_allocation',snapshot.fee_allocation);
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.debt.principal_extinguished'
   AND merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id AND causation_id=d.id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload)
   OR EXISTS(SELECT 1 FROM marketplace_seller_fee_collections WHERE fee_certificate_id=c.id AND status NOT IN ('credited','expired'))
   THEN RETURN NULL; END IF;
 FOR credit IN SELECT * FROM marketplace_seller_fee_credits WHERE fee_certificate_id=c.id ORDER BY credit_sequence LOOP
   credit_count:=credit_count+1;
   IF credit_count>2000 OR credit.credit_sequence<>credit_count OR marketplace_seller_fee_credit_valid(credit.id) IS NOT TRUE
     OR credit.merchant_id IS DISTINCT FROM d.seller_merchant_id OR credit.host_merchant_id IS DISTINCT FROM f.host_merchant_id
     OR credit.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR credit.environment IS DISTINCT FROM f.environment
     OR credit.account_fingerprint IS DISTINCT FROM f.account_fingerprint OR credit.excess_liability_cents<>0
     THEN RETURN NULL; END IF;
   collected:=collected+credit.credit_cents; processing_fee:=processing_fee+credit.processing_fee_cents;
   credit_hashes:=credit_hashes||jsonb_build_array(credit.certificate_hash);
 END LOOP;
 IF credit_count=0 OR collected IS DISTINCT FROM due THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'reason','stripe_seller_dispute_obligation_closed','debtId',d.id,
   'feeCertificateId',c.id,'feeCertificateHash',c.evidence_hash,'hostMerchantId',f.host_merchant_id,
   'fundingPlanId',f.payment_intent_id,'sellerMerchantId',d.seller_merchant_id,'providerDisputeId',c.provider_dispute_id,
   'closureSnapshotId',snapshot.id,'provider','stripe','environment',f.environment,'accountFingerprint',f.account_fingerprint,
   'principalAmountCents',d.amount_cents,'disputeFeeCents',due,'collectedFeeCents',collected,
   'processingFeeCents',processing_fee,'excessLiabilityCents',0,'creditHashes',credit_hashes,
   'fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_seller_dispute_obligation_valid(debt_id text)
 RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE obligation RECORD; expected jsonb; event_payload jsonb;
BEGIN
 SELECT o.* INTO obligation FROM marketplace_seller_dispute_obligations o WHERE o.debt_id=$1;
 IF NOT FOUND THEN RETURN false; END IF;
 expected:=marketplace_seller_dispute_obligation_evidence($1);
 IF expected IS NULL OR obligation.evidence IS DISTINCT FROM expected
   OR obligation.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR obligation.id IS DISTINCT FROM 'mseller_obligation_'||marketplace_contribution_hash(jsonb_build_array(
     obligation.host_merchant_id,obligation.funding_plan_id,obligation.debt_id))
   OR obligation.debt_id IS DISTINCT FROM expected->>'debtId'
   OR obligation.fee_certificate_id IS DISTINCT FROM expected->>'feeCertificateId'
   OR obligation.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId'
   OR obligation.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR obligation.seller_merchant_id IS DISTINCT FROM expected->>'sellerMerchantId' THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('obligation_id',obligation.id,'debt_id',obligation.debt_id,'fee_certificate_id',obligation.fee_certificate_id,
   'funding_plan_id',obligation.funding_plan_id,'seller_merchant_id',obligation.seller_merchant_id,'evidence_hash',obligation.evidence_hash,
   'principal_amount_cents',expected->'principalAmountCents','dispute_fee_cents',expected->'disputeFeeCents',
   'collected_fee_cents',expected->'collectedFeeCents','processing_fee_cents',expected->'processingFeeCents',
   'excess_liability_cents',0,'funding_hold_released',false,'payout_reauthorized',false);
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=obligation.id AND event_type='marketplace.seller_dispute_obligation_closed'
   AND merchant_id=obligation.seller_merchant_id AND correlation_id=obligation.funding_plan_id AND causation_id=obligation.debt_id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_seller_dispute_obligation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
 -- Share F01's per-certificate lock: no outstanding approval or credit can race
 -- this exact prefix. Locking alone never replaces receipt validation.
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(
   jsonb_build_array('marketplace-seller-dispute-fee',NEW.fee_certificate_id)),0));
 expected:=marketplace_seller_dispute_obligation_evidence(NEW.debt_id);
 IF expected IS NULL OR NEW.evidence IS DISTINCT FROM expected OR NEW.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR NEW.id IS DISTINCT FROM 'mseller_obligation_'||marketplace_contribution_hash(jsonb_build_array(NEW.host_merchant_id,NEW.funding_plan_id,NEW.debt_id))
   OR NEW.debt_id IS DISTINCT FROM expected->>'debtId' OR NEW.fee_certificate_id IS DISTINCT FROM expected->>'feeCertificateId'
   OR NEW.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR NEW.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR NEW.seller_merchant_id IS DISTINCT FROM expected->>'sellerMerchantId'
   THEN RAISE EXCEPTION 'marketplace_seller_dispute_obligation_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_seller_dispute_obligation_insert BEFORE INSERT ON marketplace_seller_dispute_obligations
 FOR EACH ROW EXECUTE FUNCTION marketplace_seller_dispute_obligation_insert_guard();
CREATE TRIGGER marketplace_seller_dispute_obligation_immutable BEFORE UPDATE OR DELETE ON marketplace_seller_dispute_obligations
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();

CREATE FUNCTION marketplace_seller_dispute_obligation_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_debt_id text; obligation_id text;
BEGIN
 IF TG_TABLE_NAME='outbox_messages' THEN
   SELECT id,debt_id INTO obligation_id,target_debt_id FROM marketplace_seller_dispute_obligations
     WHERE id=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.event_id ELSE NEW.event_id END;
   IF obligation_id IS NULL AND TG_OP='UPDATE' THEN
     SELECT id,debt_id INTO obligation_id,target_debt_id FROM marketplace_seller_dispute_obligations WHERE id=NEW.event_id;
   END IF;
   IF obligation_id IS NOT NULL AND TG_OP='UPDATE' AND
     (to_jsonb(NEW)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
     THEN RAISE EXCEPTION 'marketplace_seller_dispute_obligation_outbox_immutable'; END IF;
   IF obligation_id IS NULL THEN
     IF TG_OP='DELETE' THEN RETURN NULL; END IF;
     IF NEW.event_type IS DISTINCT FROM 'marketplace.seller_dispute_obligation_closed' THEN RETURN NULL; END IF;
     -- A terminal event cannot be committed without its causal certificate.
     target_debt_id:=NEW.payload->>'debt_id';
     SELECT id INTO obligation_id FROM marketplace_seller_dispute_obligations WHERE debt_id=target_debt_id;
     IF obligation_id IS DISTINCT FROM NEW.event_id THEN
       RAISE EXCEPTION 'marketplace_seller_dispute_obligation_commit_incomplete'; END IF;
   END IF;
 ELSE target_debt_id:=NEW.debt_id;
 END IF;
 IF marketplace_seller_dispute_obligation_valid(target_debt_id) IS NOT TRUE THEN
   RAISE EXCEPTION 'marketplace_seller_dispute_obligation_commit_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_seller_dispute_obligation_commit AFTER INSERT ON marketplace_seller_dispute_obligations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_seller_dispute_obligation_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_seller_dispute_obligation_outbox_commit AFTER INSERT OR UPDATE OR DELETE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_seller_dispute_obligation_commit_guard();
