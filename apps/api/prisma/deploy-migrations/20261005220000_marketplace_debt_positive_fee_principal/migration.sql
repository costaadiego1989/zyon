-- V2 certifies reinstated original principal while the positive native dispute fee
-- remains a separate, uncollected proportional seller liability. All holds remain.
-- V1 remains strictly zero-fee; immutable facts and debt terminal guards are unchanged.
CREATE OR REPLACE FUNCTION marketplace_debt_extinction_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s RECORD; d RECORD; p RECORD; st RECORD; l RECORD; f RECORD; native jsonb; expected jsonb;
 withdrawal jsonb; reinstatement jsonb; normalization jsonb; event_payload jsonb;
BEGIN
 -- Version 1 retains its original zero-fee admission. Version 2 admits only
 -- a native, full principal reinstatement with a remaining positive fee.
 IF NEW.evidence->'version' IS DISTINCT FROM '1'::jsonb AND NEW.evidence->'version' IS DISTINCT FROM '2'::jsonb
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_certificate_version_unproven'; END IF;
 SELECT * INTO s FROM marketplace_dispute_closure_snapshots WHERE id=NEW.closure_snapshot_id;
 IF NOT FOUND OR s.funding_plan_id IS DISTINCT FROM NEW.funding_plan_id OR s.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id
  OR s.provider_dispute_id IS DISTINCT FROM NEW.provider_dispute_id OR s.request_hash IS DISTINCT FROM NEW.request_hash
  OR s.proof_hash IS DISTINCT FROM NEW.proof_hash OR s.proof->>'status' IS DISTINCT FROM 'won'
  OR (NEW.evidence->'version'='1'::jsonb AND
    (s.proof->'providerFeeCents' IS DISTINCT FROM '0'::jsonb OR s.proof->'balanceDeltaCents' IS DISTINCT FROM '0'::jsonb))
  OR (NEW.evidence->'version'='2'::jsonb AND COALESCE(
    (s.proof->>'providerFeeCents')::bigint>0 AND
    (s.proof->>'balanceDeltaCents')::bigint=-(s.proof->>'providerFeeCents')::bigint,false) IS NOT TRUE)
  OR (NEW.evidence->'version'='2'::jsonb AND EXISTS(SELECT 1 FROM jsonb_array_elements(s.proof->'entries')
    WHERE value->>'balanceTransactionId'=s.request->>'captureBalanceTransactionId'))
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_native_proof_required'; END IF;
 -- This validates the genuine fresh observation and frozen capture under the
 -- same order/funding lock, without modifying the earlier snapshot's timestamp.
 PERFORM marketplace_dispute_closure_validate(s.request,NEW.observation);
 SELECT (NEW.observation-'observedAt'-'entries')||jsonb_build_object('entries',jsonb_agg(value ORDER BY(value->>'balanceTransactionId') COLLATE "C"))
  INTO normalization FROM jsonb_array_elements(NEW.observation->'entries');
 IF marketplace_dispute_closure_hash(normalization) IS DISTINCT FROM s.proof_hash
  OR s.fee_allocation IS DISTINCT FROM marketplace_dispute_fee_allocation(s.request,(s.proof->>'providerFeeCents')::integer)
  OR EXISTS(SELECT 1 FROM marketplace_dispute_closure_snapshots WHERE funding_plan_id=NEW.funding_plan_id AND provider_dispute_id<>NEW.provider_dispute_id)
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_native_proof_required'; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF EXISTS(SELECT 1 FROM payment_intents WHERE id=f.payment_intent_id AND status NOT IN('approved','chargeback_pending','chargeback_disputed','chargeback_lost','chargeback_won'))
  OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=NEW.funding_plan_id)
  OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits WHERE funding_plan_id=NEW.funding_plan_id)
  OR EXISTS(SELECT 1 FROM marketplace_contribution_checkouts WHERE funding_plan_id=NEW.funding_plan_id)
  OR EXISTS(SELECT 1 FROM marketplace_contribution_excess_liabilities WHERE funding_plan_id=NEW.funding_plan_id)
  OR EXISTS(SELECT 1 FROM return_refunds rf JOIN returns r ON r.id=rf.return_id JOIN payment_intents pi ON pi.id=f.payment_intent_id
    WHERE r.merchant_id=f.host_merchant_id AND (r.order_id=f.provider_payment_id OR r.order_id=pi.commerce_order_id OR r.order_id IN(
      SELECT co.id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND
        (co.external_order_id IN(f.provider_payment_id,pi.commerce_order_id) OR co.session_id=pi.session_id)
      UNION ALL SELECT co.external_order_id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND
        (co.external_order_id IN(f.provider_payment_id,pi.commerce_order_id) OR co.session_id=pi.session_id))))
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_history_unproven'; END IF;
 SELECT * INTO d FROM marketplace_seller_debts WHERE id=NEW.debt_id FOR UPDATE;
 IF NOT FOUND OR d.status IS DISTINCT FROM 'outstanding' OR d.recovery_id IS NOT NULL OR d.resolved_at IS NOT NULL
  OR d.deducted_from_settlement_id IS NOT NULL OR d.seller_merchant_id IS DISTINCT FROM NEW.seller_merchant_id
  OR d.amount_cents IS DISTINCT FROM NEW.amount_cents THEN RAISE EXCEPTION 'marketplace_debt_extinction_debt_binding_invalid'; END IF;
 SELECT * INTO p FROM marketplace_payouts WHERE id=NEW.payout_id;
 IF NOT FOUND OR p.settlement_id IS DISTINCT FROM d.settlement_id OR p.kind IS DISTINCT FROM 'seller_settlement'
  OR p.funding_plan_id IS DISTINCT FROM NEW.funding_plan_id OR p.beneficiary_merchant_id IS DISTINCT FROM d.seller_merchant_id
  OR p.provider IS DISTINCT FROM 'stripe' OR p.account_fingerprint IS DISTINCT FROM f.account_fingerprint
  OR p.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR p.amount_cents IS DISTINCT FROM d.amount_cents
  OR p.status IS DISTINCT FROM 'confirmed' OR p.claimed_at IS NULL OR p.reconciled_at IS NULL
  OR COALESCE(p.provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$',false) IS NOT TRUE
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_payout_binding_invalid'; END IF;
 SELECT * INTO st FROM marketplace_settlements WHERE id=d.settlement_id;
 SELECT * INTO l FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id;
 IF st.id IS NULL OR l.chargeback_at IS NULL OR st.host_merchant_id IS DISTINCT FROM f.host_merchant_id
  OR st.seller_merchant_id IS DISTINCT FROM d.seller_merchant_id OR st.order_id IS DISTINCT FROM f.provider_payment_id
  OR st.status IS DISTINCT FROM 'chargeback_debt' OR st.chargeback_at IS DISTINCT FROM l.chargeback_at
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_chargeback_binding_invalid'; END IF;
 IF (SELECT count(*) FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=f.payment_intent_id AND provider_dispute_id=NEW.provider_dispute_id)<>2
  OR EXISTS(SELECT 1 FROM marketplace_dispute_ledger_entries e WHERE e.funding_plan_id=f.payment_intent_id AND e.provider_dispute_id=NEW.provider_dispute_id AND
    (e.host_merchant_id IS DISTINCT FROM f.host_merchant_id OR e.request_hash IS DISTINCT FROM s.request_hash
     OR e.request IS DISTINCT FROM s.request OR e.provider IS DISTINCT FROM 'stripe' OR e.environment IS DISTINCT FROM f.environment
     OR e.account_fingerprint IS DISTINCT FROM f.account_fingerprint OR e.entry_hash IS DISTINCT FROM marketplace_dispute_closure_hash(e.entry)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(s.proof->'entries') x WHERE x=e.entry)))
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_ledger_unproven'; END IF;
 SELECT value INTO withdrawal FROM jsonb_array_elements(s.proof->'entries') WHERE value->>'kind'='principal_withdrawal';
 SELECT value INTO reinstatement FROM jsonb_array_elements(s.proof->'entries') WHERE value->>'kind'='principal_reinstatement';
 SELECT jsonb_build_object('funding_plan_id',f.payment_intent_id,'provider_dispute_id',NEW.provider_dispute_id,
  'request_hash',s.request_hash,'proof_hash',s.proof_hash,'status','won',
  'principal_withdrawn_cents',s.proof->'principalWithdrawnCents','principal_reinstated_cents',s.proof->'principalReinstatedCents',
  'provider_fee_cents',s.proof->'providerFeeCents','balance_delta_cents',s.proof->'balanceDeltaCents',
  'new_entry_count',count(*),
  'principal_withdrawn_delta_cents',COALESCE(sum(-(entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_withdrawal'),0),
  'principal_reinstated_delta_cents',COALESCE(sum((entry->>'amountCents')::bigint) FILTER(WHERE entry->>'kind'='principal_reinstatement'),0),
  'provider_fee_delta_cents',COALESCE(sum((entry->>'feeCents')::bigint),0),
  'account_balance_delta_cents',COALESCE(sum((entry->>'netCents')::bigint),0),'fee_allocation',s.fee_allocation,
  'fee_collection_state','uncollected','hold_release_proven',false) INTO event_payload
  FROM marketplace_dispute_ledger_entries WHERE funding_plan_id=f.payment_intent_id AND provider_dispute_id=NEW.provider_dispute_id AND proof_hash=s.proof_hash;
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=s.id AND event_type='marketplace.dispute.closure_observed'
  AND merchant_id=f.host_merchant_id AND correlation_id=f.payment_intent_id AND causation_id=NEW.provider_dispute_id
  AND producer='marketplace' AND schema_version=1 AND payload=event_payload)
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_closure_outbox_required'; END IF;
 expected:=jsonb_build_object('version',NEW.evidence->'version','reason','stripe_dispute_principal_extinguished',
  'debtId',d.id,'sellerMerchantId',d.seller_merchant_id,'settlementId',d.settlement_id,'payoutId',p.id,
  'hostMerchantId',f.host_merchant_id,'fundingPlanId',f.payment_intent_id,'providerDisputeId',NEW.provider_dispute_id,
  'closureSnapshotId',s.id,'requestHash',s.request_hash,'proofHash',s.proof_hash,'provider','stripe','environment',f.environment,
  'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,'sourceId',s.request->'sourceId',
  'instructionsHash',s.request->'instructionsHash','budgetHash',s.request->'budgetHash',
  'chargebackAt',to_char(l.chargeback_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'providerTransferId',p.provider_transfer_id,
  'amountCents',d.amount_cents,'withdrawal',withdrawal,'reinstatement',reinstatement,'disputeFeeCents',s.proof->'providerFeeCents',
  'fundingHoldReleased',false,'payoutReauthorized',false);
 IF NEW.evidence->'version'='2'::jsonb THEN
  expected:=expected||jsonb_build_object('sellerDisputeFeeCents',
   (SELECT value->'feeCents' FROM jsonb_array_elements(s.fee_allocation) WHERE value->>'sellerMerchantId'=d.seller_merchant_id),
   'feeAllocation',s.fee_allocation,'feeCollectionState','uncollected');
 END IF;
 IF NEW.evidence IS DISTINCT FROM expected OR NEW.evidence_hash IS DISTINCT FROM marketplace_dispute_closure_hash(expected)
  OR NEW.id IS DISTINCT FROM 'mdebt_extinction_'||marketplace_dispute_closure_hash(jsonb_build_array(f.host_merchant_id,f.payment_intent_id,d.id))
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_certificate_unproven'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketplace_debt_extinction_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d RECORD; expected jsonb;
BEGIN
 SELECT * INTO d FROM marketplace_seller_debts WHERE id=NEW.debt_id;
 IF NOT FOUND OR d.status IS DISTINCT FROM 'extinguished' OR d.recovery_id IS NOT NULL OR d.resolved_at IS NULL
  OR d.deducted_from_settlement_id IS NOT NULL OR d.amount_cents IS DISTINCT FROM NEW.amount_cents
  OR d.seller_merchant_id IS DISTINCT FROM NEW.seller_merchant_id
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_status_required_at_commit'; END IF;
 expected:=jsonb_build_object('certificate_id',NEW.id,'debt_id',NEW.debt_id,'payout_id',NEW.payout_id,'funding_plan_id',NEW.funding_plan_id,
  'seller_merchant_id',NEW.seller_merchant_id,'provider_dispute_id',NEW.provider_dispute_id,'amount_cents',NEW.amount_cents,
  'evidence_hash',NEW.evidence_hash,'reason','stripe_dispute_principal_extinguished','dispute_fee_cents',NEW.evidence->'disputeFeeCents',
  'funding_hold_released',false,'payout_reauthorized',false);
 IF NEW.evidence->'version'='2'::jsonb THEN
  expected:=expected||jsonb_build_object('certificate_version',2,'fee_collection_state','uncollected',
   'seller_dispute_fee_cents',NEW.evidence->'sellerDisputeFeeCents','fee_allocation',NEW.evidence->'feeAllocation');
 END IF;
 IF NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=NEW.id AND event_type='marketplace.debt.principal_extinguished'
  AND merchant_id=NEW.host_merchant_id AND correlation_id=NEW.funding_plan_id AND causation_id=NEW.debt_id
  AND producer='marketplace' AND schema_version=1 AND payload=expected)
  THEN RAISE EXCEPTION 'marketplace_debt_extinction_outbox_required_at_commit'; END IF;
 RETURN NULL;
END $$;
