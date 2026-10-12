-- F03: explicit zero-allocation obligations and whole-order V3. No zero charge,
-- credit, restored-fee fiction, original funding release or payout permission.
-- Historical positive V1/V2 function bodies remain literal under named helpers.

CREATE FUNCTION marketplace_seller_positive_fee_dispute_obligation_evidence(target_debt_id text)
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

CREATE FUNCTION marketplace_seller_positive_fee_dispute_obligation_valid(debt_id text)
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

CREATE FUNCTION marketplace_debt_principal_extinction_evidence(target_debt_id text)
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
 IF NOT FOUND OR c.evidence->'version' NOT IN ('1'::jsonb,'2'::jsonb)
   OR c.evidence->>'reason' IS DISTINCT FROM 'stripe_dispute_principal_extinguished'
   OR (c.evidence->'version'='2'::jsonb AND c.evidence->>'feeCollectionState' IS DISTINCT FROM 'uncollected')
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
 expected_certificate:=jsonb_build_object('version',c.evidence->'version','reason','stripe_dispute_principal_extinguished',
   'debtId',d.id,'sellerMerchantId',d.seller_merchant_id,'settlementId',d.settlement_id,'payoutId',p.id,
   'hostMerchantId',f.host_merchant_id,'fundingPlanId',f.payment_intent_id,'providerDisputeId',c.provider_dispute_id,
   'closureSnapshotId',snapshot.id,'requestHash',c.request_hash,'proofHash',c.proof_hash,'provider','stripe',
   'environment',f.environment,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
   'sourceId',req->'sourceId','instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash',
   'chargebackAt',to_char(ledger.chargeback_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'providerTransferId',p.provider_transfer_id,'amountCents',d.amount_cents,'withdrawal',withdrawal,'reinstatement',reinstatement,
   'disputeFeeCents',snapshot.proof->'providerFeeCents','fundingHoldReleased',false,'payoutReauthorized',false);
 IF c.evidence->'version'='2'::jsonb THEN
  expected_certificate:=expected_certificate||jsonb_build_object('sellerDisputeFeeCents',(SELECT value->'feeCents' FROM jsonb_array_elements(snapshot.fee_allocation)
     WHERE value->>'sellerMerchantId'=d.seller_merchant_id),'feeAllocation',snapshot.fee_allocation,'feeCollectionState','uncollected');
 END IF;
 IF c.evidence IS DISTINCT FROM expected_certificate THEN RETURN NULL; END IF;
 IF (c.evidence->'version'='1'::jsonb AND (snapshot.proof->'providerFeeCents' IS DISTINCT FROM '0'::jsonb OR snapshot.proof->'balanceDeltaCents' IS DISTINCT FROM '0'::jsonb))
   OR (c.evidence->'version'='2'::jsonb AND (snapshot.proof->>'providerFeeCents')::bigint<=0) THEN RETURN NULL; END IF;
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
   'funding_hold_released',false,'payout_reauthorized',false);
 IF c.evidence->'version'='2'::jsonb THEN
  event_payload:=event_payload||jsonb_build_object('certificate_version',2,'fee_collection_state','uncollected',
    'seller_dispute_fee_cents',c.evidence->'sellerDisputeFeeCents','fee_allocation',snapshot.fee_allocation);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.debt.principal_extinguished'
   AND merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id AND causation_id=d.id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload)
   THEN RETURN NULL; END IF;
 RETURN c.evidence;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;


CREATE FUNCTION marketplace_debt_principal_extinction_valid(target_debt_id text)
 RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT marketplace_debt_principal_extinction_evidence(target_debt_id) IS NOT NULL
$$;

CREATE FUNCTION marketplace_seller_zero_fee_dispute_obligation_evidence(target_debt_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE cert RECORD; principal jsonb; bound jsonb; snapshot jsonb; allocation jsonb;
BEGIN
 principal:=marketplace_debt_principal_extinction_evidence(target_debt_id);
 IF principal IS NULL THEN RETURN NULL; END IF;
 SELECT pc.* INTO cert FROM marketplace_debt_principal_extinctions pc WHERE pc.debt_id=target_debt_id;
 bound:=marketplace_order_dispute_basis(cert.funding_plan_id);
 IF bound IS NULL THEN RETURN NULL; END IF;
 snapshot:=bound->'snapshot';
 SELECT movement INTO allocation FROM jsonb_array_elements(snapshot->'fee_allocation') movement
   WHERE movement->>'sellerMerchantId'=cert.seller_merchant_id;
 IF allocation IS NULL OR allocation->'feeCents' IS DISTINCT FROM '0'::jsonb
   OR cert.seller_merchant_id=cert.host_merchant_id
   OR cert.closure_snapshot_id IS DISTINCT FROM snapshot->>'id'
   OR cert.request_hash IS DISTINCT FROM snapshot->>'request_hash' OR cert.proof_hash IS DISTINCT FROM snapshot->>'proof_hash'
   OR (principal->'version'='1'::jsonb AND principal->'disputeFeeCents' IS DISTINCT FROM '0'::jsonb)
   OR (principal->'version'='2'::jsonb AND (principal->'sellerDisputeFeeCents' IS DISTINCT FROM '0'::jsonb
       OR principal->'feeAllocation' IS DISTINCT FROM snapshot->'fee_allocation'))
   OR EXISTS(SELECT 1 FROM marketplace_seller_fee_collections journal WHERE journal.fee_certificate_id=cert.id OR journal.debt_id=target_debt_id)
   OR EXISTS(SELECT 1 FROM marketplace_seller_fee_credits receipt WHERE receipt.fee_certificate_id=cert.id)
   THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',2,'reason','stripe_seller_zero_fee_dispute_obligation_closed','debtId',target_debt_id,
   'feeCertificateId',cert.id,'feeCertificateHash',cert.evidence_hash,'hostMerchantId',cert.host_merchant_id,
   'fundingPlanId',cert.funding_plan_id,'sellerMerchantId',cert.seller_merchant_id,'providerDisputeId',cert.provider_dispute_id,
   'closureSnapshotId',cert.closure_snapshot_id,'provider','stripe','environment',principal->'environment','accountFingerprint',principal->'accountFingerprint',
   'principalAmountCents',cert.amount_cents,'disputeFeeCents',0,'collectedFeeCents',0,'processingFeeCents',0,
   'excessLiabilityCents',0,'creditHashes','[]'::jsonb,'fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION marketplace_seller_dispute_obligation_evidence(target_debt_id text)
 RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE principal_version jsonb; own_fee jsonb;
BEGIN
 SELECT cert.evidence->'version',cert.evidence->'sellerDisputeFeeCents' INTO principal_version,own_fee
   FROM marketplace_debt_principal_extinctions cert WHERE cert.debt_id=target_debt_id;
 IF principal_version='1'::jsonb OR principal_version='2'::jsonb AND own_fee='0'::jsonb THEN
   RETURN marketplace_seller_zero_fee_dispute_obligation_evidence(target_debt_id);
 END IF;
 RETURN marketplace_seller_positive_fee_dispute_obligation_evidence(target_debt_id);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_seller_zero_fee_dispute_obligation_valid(target_debt_id text)
 RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE obligation RECORD; expected jsonb; event_payload jsonb;
BEGIN
 SELECT cert.* INTO obligation FROM marketplace_seller_dispute_obligations cert WHERE cert.debt_id=target_debt_id;
 IF NOT FOUND THEN RETURN false; END IF;
 expected:=marketplace_seller_zero_fee_dispute_obligation_evidence(target_debt_id);
 IF expected IS NULL OR obligation.evidence IS DISTINCT FROM expected
   OR obligation.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR obligation.id IS DISTINCT FROM 'mseller_obligation_'||marketplace_contribution_hash(jsonb_build_array(obligation.host_merchant_id,obligation.funding_plan_id,obligation.debt_id))
   OR obligation.debt_id IS DISTINCT FROM expected->>'debtId' OR obligation.fee_certificate_id IS DISTINCT FROM expected->>'feeCertificateId'
   OR obligation.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR obligation.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR obligation.seller_merchant_id IS DISTINCT FROM expected->>'sellerMerchantId' THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('obligation_id',obligation.id,'debt_id',obligation.debt_id,'fee_certificate_id',obligation.fee_certificate_id,
   'funding_plan_id',obligation.funding_plan_id,'seller_merchant_id',obligation.seller_merchant_id,'evidence_hash',obligation.evidence_hash,
   'principal_amount_cents',expected->'principalAmountCents','dispute_fee_cents',0,'collected_fee_cents',0,'processing_fee_cents',0,
   'excess_liability_cents',0,'funding_hold_released',false,'payout_reauthorized',false,'certificate_version',2,'fee_resolution','zero_allocation');
 RETURN EXISTS(SELECT 1 FROM outbox_messages financial_event WHERE financial_event.event_id=obligation.id
   AND financial_event.event_type='marketplace.seller_dispute_obligation_closed' AND financial_event.merchant_id=obligation.seller_merchant_id
   AND financial_event.correlation_id=obligation.funding_plan_id AND financial_event.causation_id=obligation.debt_id
   AND financial_event.producer='marketplace' AND financial_event.schema_version=1 AND financial_event.payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_seller_dispute_obligation_valid(debt_id text)
 RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE certificate_version jsonb;
BEGIN
 SELECT obligation.evidence->'version' INTO certificate_version FROM marketplace_seller_dispute_obligations obligation WHERE obligation.debt_id=$1;
 IF certificate_version='1'::jsonb THEN RETURN marketplace_seller_positive_fee_dispute_obligation_valid($1); END IF;
 IF certificate_version='2'::jsonb THEN RETURN marketplace_seller_zero_fee_dispute_obligation_valid($1); END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;


CREATE FUNCTION marketplace_order_dispute_closure_v2_evidence(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE b jsonb; f jsonb; s jsonb; req jsonb; proof jsonb; host jsonb; host_principal jsonb:=null; allocation jsonb;
 p RECORD; c RECORD; o RECORD; e jsonb; seller_refs jsonb:='[]'::jsonb; payout_refs jsonb; collected bigint:=0; processing bigint:=0; external_count integer:=0; host_fee bigint; host_obligation RECORD; host_ref jsonb;
BEGIN
 b:=marketplace_order_dispute_basis(target_funding); IF b IS NULL THEN RETURN NULL; END IF;
 f:=b->'funding'; s:=b->'snapshot'; req:=s->'request'; proof:=s->'proof';
 host_fee:=COALESCE((SELECT (value->>'feeCents')::bigint FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'=f->>'host_merchant_id'),0);
 IF host_fee=0 THEN RETURN marketplace_order_dispute_closure_v1_evidence(target_funding); END IF;
 IF host_fee NOT BETWEEN 1 AND 2147483647 OR (proof->>'providerFeeCents')::bigint<=0 THEN RETURN NULL; END IF;
 SELECT value INTO host FROM jsonb_array_elements(f#>'{budget,beneficiaries}') WHERE value->>'merchantId'=f->>'host_merchant_id';
 IF host IS NULL OR (host->>'amountCents')::bigint<0
   THEN RETURN NULL; END IF;
 IF (host->>'amountCents')::bigint>0 THEN
   SELECT * INTO p FROM marketplace_payouts WHERE funding_plan_id=target_funding AND kind='host_receivable';
   IF NOT FOUND OR marketplace_host_principal_extinction_valid(p.id) IS NOT TRUE THEN RETURN NULL; END IF;
   SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE payout_id=p.id;
   host_principal:=jsonb_build_object('certificateId',c.id,'evidenceHash',c.evidence_hash,'payoutId',p.id,'amountCents',c.amount_cents);
   IF marketplace_host_dispute_obligation_valid(p.id) IS NOT TRUE THEN RETURN NULL; END IF;
   SELECT * INTO host_obligation FROM marketplace_host_dispute_obligations WHERE payout_id=p.id;
   e:=host_obligation.evidence;
   IF e->'disputeFeeCents' IS DISTINCT FROM to_jsonb(host_fee) OR e->'collectedFeeCents' IS DISTINCT FROM to_jsonb(host_fee)
     OR e->>'feeCertificateId' IS DISTINCT FROM c.id OR e->>'feeCertificateHash' IS DISTINCT FROM c.evidence_hash
     OR e->>'providerDisputeId' IS DISTINCT FROM s->>'provider_dispute_id' OR e->>'closureSnapshotId' IS DISTINCT FROM s->>'id'
     THEN RETURN NULL; END IF;
   host_ref:=jsonb_build_object('obligationId',host_obligation.id,'payoutId',p.id,'feeCertificateId',c.id,'feeCertificateHash',c.evidence_hash,
     'obligationEvidenceHash',host_obligation.evidence_hash,'principalAmountCents',e->'principalAmountCents','disputeFeeCents',e->'disputeFeeCents',
     'collectedFeeCents',e->'collectedFeeCents','processingFeeCents',e->'processingFeeCents','creditHashes',e->'creditHashes');
   collected:=(e->>'collectedFeeCents')::bigint; processing:=(e->>'processingFeeCents')::bigint;
 ELSE RETURN NULL;
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
 RETURN jsonb_build_object('version',2,'reason','stripe_order_dispute_closed','hostMerchantId',f->'host_merchant_id','fundingPlanId',target_funding,
   'providerDisputeId',s->'provider_dispute_id','closureSnapshotId',s->'id','requestHash',s->'request_hash','proofHash',s->'proof_hash',
   'instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash','provider','stripe','environment',f->'environment','accountFingerprint',f->'account_fingerprint',
   'providerPaymentId',f->'provider_payment_id','sourceId',req->'sourceId','chargebackAt',b->'chargebackAt','principalReinstatedCents',proof->'principalReinstatedCents',
   'disputeFeeCents',proof->'providerFeeCents','hostDisputeFeeCents',host_fee,'collectedFeeCents',collected,'processingFeeCents',processing,'excessLiabilityCents',0,
   'hostPrincipal',host_principal,'hostObligation',host_ref,'sellerObligations',seller_refs,'payouts',payout_refs,'originalFundingStatus','held','operationalHoldClosed',true,'fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE FUNCTION marketplace_order_dispute_closure_legacy_valid(target_funding text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
   'evidence_hash',c.evidence_hash,'principal_reinstated_cents',expected->'principalReinstatedCents','dispute_fee_cents',expected->'disputeFeeCents','host_dispute_fee_cents',expected->'hostDisputeFeeCents',
   'collected_fee_cents',expected->'collectedFeeCents','processing_fee_cents',expected->'processingFeeCents','excess_liability_cents',0,
   'original_funding_status','held','operational_hold_closed',true,'funding_hold_released',false,'payout_reauthorized',false);
 IF expected->'version'='2'::jsonb THEN event_payload:=event_payload||jsonb_build_object('host_obligation_id',expected#>'{hostObligation,obligationId}'); END IF;
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.order_dispute_closed'
   AND merchant_id=c.host_merchant_id AND correlation_id=c.funding_plan_id AND causation_id=c.provider_dispute_id AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_order_dispute_closure_evidence(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE b jsonb; f jsonb; s jsonb; req jsonb; proof jsonb; host jsonb; host_principal jsonb:=null; allocation jsonb;
 p RECORD; c RECORD; o RECORD; e jsonb; seller_refs jsonb:='[]'::jsonb; payout_refs jsonb; collected bigint:=0; processing bigint:=0; external_count integer:=0; host_fee bigint; host_obligation RECORD; host_ref jsonb; zero_profile boolean; result jsonb;
BEGIN
 b:=marketplace_order_dispute_basis(target_funding); IF b IS NULL THEN RETURN NULL; END IF;
 f:=b->'funding'; s:=b->'snapshot'; req:=s->'request'; proof:=s->'proof';
 host_fee:=COALESCE((SELECT (value->>'feeCents')::bigint FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'=f->>'host_merchant_id'),0);
 zero_profile:=(proof->>'providerFeeCents')::bigint=0
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(s->'fee_allocation') fee WHERE fee->>'sellerMerchantId'<>f->>'host_merchant_id' AND fee->'feeCents'='0'::jsonb)
   OR host_fee=0 AND EXISTS(SELECT 1 FROM jsonb_array_elements(req->'sales') sale WHERE sale->>'sellerMerchantId'=f->>'host_merchant_id');
 IF zero_profile IS NOT TRUE THEN RETURN marketplace_order_dispute_closure_v2_evidence(target_funding); END IF;
 IF host_fee NOT BETWEEN 0 AND 2147483647 OR (proof->>'providerFeeCents')::bigint NOT BETWEEN 0 AND 2147483647 THEN RETURN NULL; END IF;
 SELECT value INTO host FROM jsonb_array_elements(f#>'{budget,beneficiaries}') WHERE value->>'merchantId'=f->>'host_merchant_id';
 IF host IS NULL OR (host->>'amountCents')::bigint<0
   THEN RETURN NULL; END IF;
 IF (host->>'amountCents')::bigint>0 THEN
   SELECT * INTO p FROM marketplace_payouts WHERE funding_plan_id=target_funding AND kind='host_receivable';
   IF NOT FOUND OR marketplace_host_principal_extinction_valid(p.id) IS NOT TRUE THEN RETURN NULL; END IF;
   SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE payout_id=p.id;
   host_principal:=jsonb_build_object('certificateId',c.id,'evidenceHash',c.evidence_hash,'payoutId',p.id,'amountCents',c.amount_cents);
   IF host_fee>0 THEN
   IF marketplace_host_dispute_obligation_valid(p.id) IS NOT TRUE THEN RETURN NULL; END IF;
   SELECT * INTO host_obligation FROM marketplace_host_dispute_obligations WHERE payout_id=p.id;
   e:=host_obligation.evidence;
   IF e->'disputeFeeCents' IS DISTINCT FROM to_jsonb(host_fee) OR e->'collectedFeeCents' IS DISTINCT FROM to_jsonb(host_fee)
     OR e->>'feeCertificateId' IS DISTINCT FROM c.id OR e->>'feeCertificateHash' IS DISTINCT FROM c.evidence_hash
     OR e->>'providerDisputeId' IS DISTINCT FROM s->>'provider_dispute_id' OR e->>'closureSnapshotId' IS DISTINCT FROM s->>'id'
     THEN RETURN NULL; END IF;
   host_ref:=jsonb_build_object('obligationId',host_obligation.id,'payoutId',p.id,'feeCertificateId',c.id,'feeCertificateHash',c.evidence_hash,
     'obligationEvidenceHash',host_obligation.evidence_hash,'principalAmountCents',e->'principalAmountCents','disputeFeeCents',e->'disputeFeeCents',
     'collectedFeeCents',e->'collectedFeeCents','processingFeeCents',e->'processingFeeCents','creditHashes',e->'creditHashes');
   collected:=(e->>'collectedFeeCents')::bigint; processing:=(e->>'processingFeeCents')::bigint;
   END IF;
 ELSE
   IF host_fee>0 OR EXISTS(SELECT 1 FROM marketplace_payouts po WHERE po.funding_plan_id=target_funding AND po.kind='host_receivable')
     OR EXISTS(SELECT 1 FROM marketplace_host_debts debt JOIN marketplace_payouts po ON po.id=debt.payout_id WHERE po.funding_plan_id=target_funding)
     OR EXISTS(SELECT 1 FROM marketplace_host_principal_extinctions cert WHERE cert.funding_plan_id=target_funding) THEN RETURN NULL; END IF;
 END IF;
 IF host_fee=0 AND (EXISTS(SELECT 1 FROM marketplace_host_dispute_obligations obligation WHERE obligation.funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_host_fee_collections journal WHERE journal.funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_host_fee_credits receipt WHERE receipt.funding_plan_id=target_funding)
   OR EXISTS(SELECT 1 FROM marketplace_host_fee_excess_liabilities liability JOIN marketplace_host_fee_collections journal ON journal.id=liability.collection_id WHERE journal.funding_plan_id=target_funding))
   THEN RETURN NULL; END IF;
 FOR allocation IN SELECT value FROM jsonb_array_elements(s->'fee_allocation') WHERE value->>'sellerMerchantId'<>f->>'host_merchant_id' ORDER BY(value->>'sellerMerchantId') COLLATE "C" LOOP
   external_count:=external_count+1;
   IF (allocation->>'feeCents')::bigint NOT BETWEEN 0 AND 2147483647 THEN RETURN NULL; END IF;
   SELECT * INTO p FROM marketplace_payouts WHERE funding_plan_id=target_funding AND beneficiary_merchant_id=allocation->>'sellerMerchantId' AND kind='seller_settlement';
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT oo.* INTO o FROM marketplace_seller_dispute_obligations oo JOIN marketplace_debt_principal_extinctions pc ON pc.id=oo.fee_certificate_id
     WHERE oo.funding_plan_id=target_funding AND oo.seller_merchant_id=allocation->>'sellerMerchantId' AND pc.payout_id=p.id;
   IF NOT FOUND OR marketplace_seller_dispute_obligation_valid(o.debt_id) IS NOT TRUE THEN RETURN NULL; END IF;
   e:=o.evidence;
   IF (allocation->'feeCents'='0'::jsonb AND (e->'version' IS DISTINCT FROM '2'::jsonb
        OR e->>'reason' IS DISTINCT FROM 'stripe_seller_zero_fee_dispute_obligation_closed'
        OR e->'processingFeeCents' IS DISTINCT FROM '0'::jsonb OR e->'creditHashes' IS DISTINCT FROM '[]'::jsonb))
     OR ((allocation->>'feeCents')::bigint>0 AND (e->'version' IS DISTINCT FROM '1'::jsonb
        OR e->>'reason' IS DISTINCT FROM 'stripe_seller_dispute_obligation_closed')) THEN RETURN NULL; END IF;
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
 result:=jsonb_build_object('version',3,'reason','stripe_order_dispute_closed','hostMerchantId',f->'host_merchant_id','fundingPlanId',target_funding,
   'providerDisputeId',s->'provider_dispute_id','closureSnapshotId',s->'id','requestHash',s->'request_hash','proofHash',s->'proof_hash',
   'instructionsHash',req->'instructionsHash','budgetHash',req->'budgetHash','provider','stripe','environment',f->'environment','accountFingerprint',f->'account_fingerprint',
   'providerPaymentId',f->'provider_payment_id','sourceId',req->'sourceId','chargebackAt',b->'chargebackAt','principalReinstatedCents',proof->'principalReinstatedCents',
   'disputeFeeCents',proof->'providerFeeCents','hostDisputeFeeCents',host_fee,'collectedFeeCents',collected,'processingFeeCents',processing,'excessLiabilityCents',0,
   'hostPrincipal',host_principal,'sellerObligations',seller_refs,'payouts',payout_refs,'originalFundingStatus','held','operationalHoldClosed',true,'fundingHoldReleased',false,'payoutReauthorized',false);
 IF host_fee>0 THEN result:=result||jsonb_build_object('hostObligation',host_ref); END IF;
 RETURN result;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION marketplace_order_dispute_closure_valid(target_funding text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; expected jsonb; req jsonb; event_payload jsonb;
BEGIN
 SELECT * INTO c FROM marketplace_order_dispute_closures WHERE funding_plan_id=target_funding; IF NOT FOUND THEN RETURN false; END IF;
 IF c.evidence->'version' IN ('1'::jsonb,'2'::jsonb) THEN RETURN marketplace_order_dispute_closure_legacy_valid(target_funding); END IF;
 IF c.evidence->'version' IS DISTINCT FROM '3'::jsonb THEN RETURN false; END IF;
 expected:=marketplace_order_dispute_closure_evidence(target_funding);
 SELECT request INTO req FROM marketplace_dispute_closure_snapshots WHERE id=c.closure_snapshot_id;
 IF expected IS NULL OR c.evidence IS DISTINCT FROM expected OR c.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR c.id IS DISTINCT FROM 'morder_dispute_closure_'||marketplace_contribution_hash(jsonb_build_array(c.host_merchant_id,c.funding_plan_id))
   OR c.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR c.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   OR c.provider_dispute_id IS DISTINCT FROM expected->>'providerDisputeId' OR c.closure_snapshot_id IS DISTINCT FROM expected->>'closureSnapshotId'
   OR marketplace_seller_dispute_native_proof_valid(req,c.observation) IS NOT TRUE
   OR marketplace_order_dispute_proof_hash(c.observation) IS DISTINCT FROM expected->>'proofHash' THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('certificate_id',c.id,'funding_plan_id',c.funding_plan_id,'host_merchant_id',c.host_merchant_id,'provider_dispute_id',c.provider_dispute_id,
   'evidence_hash',c.evidence_hash,'principal_reinstated_cents',expected->'principalReinstatedCents','dispute_fee_cents',expected->'disputeFeeCents','host_dispute_fee_cents',expected->'hostDisputeFeeCents',
   'collected_fee_cents',expected->'collectedFeeCents','processing_fee_cents',expected->'processingFeeCents','excess_liability_cents',0,
   'original_funding_status','held','operational_hold_closed',true,'funding_hold_released',false,'payout_reauthorized',false);
 IF expected ? 'hostObligation' THEN event_payload:=event_payload||jsonb_build_object('host_obligation_id',expected#>'{hostObligation,obligationId}'); END IF;
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=c.id AND event_type='marketplace.order_dispute_closed'
   AND merchant_id=c.host_merchant_id AND correlation_id=c.funding_plan_id AND causation_id=c.provider_dispute_id AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
