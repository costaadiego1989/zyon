-- Reuse certified whole Asaas returns across confirmed buyer refund prefixes.
-- Never creates another wallet return or spends fees/residual/dispute money.
-- Extend the terminal refund guard only for separately certified money.
-- Original allocations, fees, payout identities and block reasons stay frozen.
CREATE OR REPLACE FUNCTION marketplace_refund_funding_activation_valid(r marketplace_refund_plans, o marketplace_refund_operations)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE f marketplace_funding_plans; pi payment_intents; credits jsonb; projected jsonb; total bigint; entry jsonb;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id AND host_merchant_id=r.host_merchant_id;
 SELECT * INTO pi FROM payment_intents WHERE id=r.funding_plan_id AND merchant_id=r.host_merchant_id;
 IF f.payment_intent_id IS NULL OR pi.id IS NULL OR f.status<>'held' OR pi.status<>'approved'
   OR pi.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR pi.amount_cents<>f.amount_cents OR pi.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR o.status<>'planned' OR o.provider<>f.provider OR o.account_fingerprint<>f.account_fingerprint
   OR o.request->>'kind' IS DISTINCT FROM 'refund' OR o.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id
   OR o.request->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint OR o.request->>'environment' IS DISTINCT FROM f.environment
   OR o.request->>'currency' IS DISTINCT FROM 'BRL' OR o.request->'amountCents' IS DISTINCT FROM to_jsonb(r.amount_cents)
   OR o.request->'paymentAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR o.request->>'requestHash' IS DISTINCT FROM o.request_hash
   OR marketplace_contribution_hash(o.request-'requestHash') IS DISTINCT FROM o.request_hash
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=r.funding_plan_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=r.funding_plan_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=r.funding_plan_id)
   OR NOT EXISTS(SELECT 1 FROM marketplace_order_ledgers WHERE host_merchant_id=r.host_merchant_id AND order_id=f.provider_payment_id
      AND purchased_at IS NOT NULL AND chargeback_at IS NULL) THEN RETURN false; END IF;

 IF r.block_reason='marketplace_refund_seller_contribution_required' AND f.provider='stripe' THEN
   IF o.request ? 'asaasWalletReturns' OR o.request->>'sourceId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}'
     OR jsonb_array_length(r.allocation->'requiredContributions')=0
     OR EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=r.funding_plan_id
       AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL)) THEN RETURN false; END IF;
   SELECT jsonb_agg(c.certificate ORDER BY c.credit_sequence),sum(c.credit_cents) INTO credits,total
     FROM marketplace_refund_contribution_credits c JOIN marketplace_refund_contribution_journals j ON j.id=c.id
     WHERE c.funding_plan_id=r.funding_plan_id AND j.status='credited' AND j.certificate_hash=c.certificate_hash;
   SELECT projected_plan INTO projected FROM marketplace_refund_contribution_credits WHERE funding_plan_id=r.funding_plan_id ORDER BY credit_sequence DESC LIMIT 1;
   IF credits IS NULL OR projected->'fullyFunded' IS DISTINCT FROM 'true'::jsonb
     OR projected->>'refundPlanId' IS DISTINCT FROM r.id
     OR o.request#>'{fundingContributions,certificates}' IS DISTINCT FROM credits
     OR o.request#>'{fundingContributions,contributedNetCents}' IS DISTINCT FROM to_jsonb(total)
     OR o.request#>>'{fundingContributions,planHash}' IS DISTINCT FROM projected->>'planHash' THEN RETURN false; END IF;
   FOR entry IN SELECT value FROM jsonb_array_elements(r.allocation->'requiredContributions') LOOP
     IF entry->>'merchantId' IS NULL OR (entry->>'amountCents')::bigint IS DISTINCT FROM
       (SELECT COALESCE(sum(credit_cents),0) FROM marketplace_refund_contribution_credits
        WHERE funding_plan_id=r.funding_plan_id AND merchant_id=entry->>'merchantId') THEN RETURN false; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits c WHERE c.funding_plan_id=r.funding_plan_id
     AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocation->'requiredContributions') e WHERE e->>'merchantId'=c.merchant_id)) THEN RETURN false; END IF;
   RETURN true;
 END IF;

 IF r.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable' AND f.provider='asaas' THEN
   IF o.request ? 'fundingContributions' OR o.request->>'sourceId' IS DISTINCT FROM f.provider_payment_id
     OR o.request->'asaasCapture' IS DISTINCT FROM f.budget->'capture'
     OR jsonb_array_length(r.allocation->'requiredContributions')<>0
     OR (r.allocation->>'cumulativeRefundCents')::bigint>f.net_amount_cents
     OR jsonb_typeof(o.request->'previousRefunds') IS DISTINCT FROM 'array'
     OR jsonb_typeof(o.request->'asaasWalletReturns') IS DISTINCT FROM 'array'
     OR jsonb_array_length(o.request->'asaasWalletReturns')=0
     OR EXISTS(SELECT 1 FROM marketplace_refund_plans p WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id AND p.status<>'confirmed')
     THEN RETURN false; END IF;
   -- Every earlier buyer refund is a complete immutable prefix with its own
   -- claimed operation, completed return and committed financial event.
   IF EXISTS(SELECT 1 FROM marketplace_refund_plans p LEFT JOIN marketplace_refund_operations q ON q.refund_plan_id=p.id
     LEFT JOIN returns rt ON rt.id=p.return_id LEFT JOIN return_refunds rr ON rr.return_id=p.return_id
     WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id AND (
       p.host_merchant_id<>r.host_merchant_id OR q.id IS NULL OR q.status<>'confirmed' OR q.provider<>'asaas'
       OR q.claimed_at IS NULL OR q.reconciled_at IS NULL OR q.provider_operation_id IS NULL
       OR q.provider_operation_id !~ '^asaas_refund_[a-f0-9]{64}$' OR q.account_fingerprint<>f.account_fingerprint
       OR q.request->>'kind' IS DISTINCT FROM 'refund' OR q.request ? 'fundingContributions' OR q.request ? 'transfer'
       OR q.request->>'provider' IS DISTINCT FROM 'asaas' OR q.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id
       OR q.request->>'sourceId' IS DISTINCT FROM f.provider_payment_id OR q.request->>'currency' IS DISTINCT FROM 'BRL'
       OR q.request->>'environment' IS DISTINCT FROM f.environment OR q.request->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint
       OR q.request->'paymentAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
       OR q.request->'amountCents' IS DISTINCT FROM to_jsonb(p.amount_cents) OR q.request->'asaasCapture' IS DISTINCT FROM f.budget->'capture'
       OR q.request->>'requestHash' IS DISTINCT FROM q.request_hash OR q.request->>'reference' IS DISTINCT FROM q.reference
       OR marketplace_contribution_hash(q.request-'requestHash') IS DISTINCT FROM q.request_hash
       OR marketplace_contribution_hash(p.allocation) IS DISTINCT FROM p.allocation_hash
       OR p.allocation->'amountCents' IS DISTINCT FROM to_jsonb(p.amount_cents)
       OR jsonb_array_length(p.allocation->'requiredContributions')<>0
       OR (p.allocation->>'cumulativeRefundCents')::bigint IS DISTINCT FROM (
         SELECT sum(z.amount_cents) FROM marketplace_refund_plans z WHERE z.funding_plan_id=r.funding_plan_id AND z.id<>r.id
           AND (z.allocation->>'cumulativeRefundCents')::bigint<=(p.allocation->>'cumulativeRefundCents')::bigint)
       OR q.request->'previousRefunds' IS DISTINCT FROM (SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',zq.provider_operation_id,
          'amountCents',z.amount_cents) ORDER BY (z.allocation->>'cumulativeRefundCents')::bigint),'[]'::jsonb)
         FROM marketplace_refund_plans z JOIN marketplace_refund_operations zq ON zq.refund_plan_id=z.id
         WHERE z.funding_plan_id=r.funding_plan_id AND z.id<>r.id AND (z.allocation->>'cumulativeRefundCents')::bigint<(p.allocation->>'cumulativeRefundCents')::bigint)
       OR rt.id IS NULL OR rt.merchant_id<>r.host_merchant_id OR rt.status<>'REFUND_COMPLETED'
       OR rr.id IS DISTINCT FROM 'mrefund_return_'||marketplace_contribution_hash(to_jsonb(p.id))
       OR rr.status<>'COMPLETED' OR rr.payment_intent_id IS DISTINCT FROM r.funding_plan_id
       OR rr.amount_in_cents IS DISTINCT FROM p.amount_cents OR rr.provider_refund_id IS DISTINCT FROM q.provider_operation_id OR rr.processed_at IS NULL
       OR NOT EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_refund_'||p.id AND e.event_type='marketplace.refund.confirmed'
         AND e.merchant_id=r.host_merchant_id AND e.schema_version=1 AND e.producer='marketplace' AND e.correlation_id=r.funding_plan_id AND e.causation_id=p.return_id
         AND e.payload=jsonb_build_object('refund_plan_id',p.id,'return_id',p.return_id,'payment_intent_id',r.funding_plan_id,
           'order_id',f.provider_payment_id,'amount_cents',p.amount_cents,'cumulative_refund_cents',(p.allocation->>'cumulativeRefundCents')::bigint,
           'allocation_hash',p.allocation_hash,'provider_refund_id',q.provider_operation_id)))) THEN RETURN false; END IF;
   SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',q.provider_operation_id,'amountCents',p.amount_cents)
     ORDER BY (p.allocation->>'cumulativeRefundCents')::bigint),'[]'::jsonb),COALESCE(sum(p.amount_cents),0) INTO credits,total
     FROM marketplace_refund_plans p JOIN marketplace_refund_operations q ON q.refund_plan_id=p.id
     WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id;
   IF o.request->'previousRefunds' IS DISTINCT FROM credits OR r.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb(total+r.amount_cents)
     OR total+r.amount_cents>f.net_amount_cents
     OR (SELECT count(*) FROM marketplace_refund_plans p JOIN marketplace_refund_operations q ON q.refund_plan_id=p.id
          WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id)<>
        (SELECT count(DISTINCT q.provider_operation_id) FROM marketplace_refund_plans p JOIN marketplace_refund_operations q ON q.refund_plan_id=p.id
          WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id) THEN RETURN false; END IF;
   FOR entry IN SELECT value FROM jsonb_array_elements(o.request->'asaasWalletReturns') LOOP
     IF NOT EXISTS(SELECT 1 FROM marketplace_asaas_wallet_returns w JOIN marketplace_payouts p ON p.id=w.payout_id
       JOIN marketplace_refund_plans origin ON origin.id=w.refund_plan_id
       WHERE w.id=entry->>'id' AND w.payout_id=entry->>'payoutId' AND w.funding_plan_id=r.funding_plan_id
       AND w.host_merchant_id=r.host_merchant_id AND w.status='returned' AND (origin.id=r.id OR origin.status='confirmed')
       AND w.certificate_hash=entry->>'certificateHash' AND w.request=entry->'request' AND w.proof=entry->'proof'
       AND w.amount_cents=p.amount_cents AND p.status='confirmed' AND p.provider_transfer_id=w.original_provider_transfer_id
       AND p.beneficiary_merchant_id=w.seller_merchant_id AND p.funding_plan_id=r.funding_plan_id
       AND marketplace_asaas_wallet_return_request_valid(w) AND marketplace_asaas_wallet_return_proof_valid(w)
       AND (SELECT count(*) FROM marketplace_asaas_wallet_return_receipts WHERE journal_id=w.id)=4
       AND EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_asaas_wallet_return_'||w.id
         AND e.event_type='marketplace.asaas_wallet_return.returned' AND e.merchant_id=r.host_merchant_id
         AND e.payload=jsonb_build_object('journal_id',w.id,'funding_plan_id',r.funding_plan_id,'refund_plan_id',w.refund_plan_id,
           'payout_id',w.payout_id,'amount_cents',w.amount_cents,'certificate_hash',w.certificate_hash))) THEN RETURN false; END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(o.request->'asaasWalletReturns'))<>
     (SELECT count(DISTINCT value->>'payoutId') FROM jsonb_array_elements(o.request->'asaasWalletReturns')) THEN RETURN false; END IF;
   -- Earlier merchant debits are deducted from the SAME held principal; an old
   -- certificate is evidence of one movement, never a newly replenished balance.
   FOR entry IN SELECT value FROM jsonb_array_elements(r.allocation->'merchantDebits') LOOP
     IF (entry->>'amountCents')::bigint + (SELECT COALESCE(sum((d->>'amountCents')::bigint),0)
          FROM marketplace_refund_plans p CROSS JOIN LATERAL jsonb_array_elements(p.allocation->'merchantDebits') d
          WHERE p.funding_plan_id=r.funding_plan_id AND p.id<>r.id AND d->>'merchantId'=entry->>'merchantId') >
       (SELECT COALESCE(sum(amount_cents),0) FROM marketplace_payouts WHERE funding_plan_id=r.funding_plan_id
         AND beneficiary_merchant_id=entry->>'merchantId' AND status='planned' AND claimed_at IS NULL AND provider_transfer_id IS NULL)
       + (SELECT COALESCE(sum(w.amount_cents),0) FROM marketplace_asaas_wallet_returns w
          WHERE w.funding_plan_id=r.funding_plan_id AND w.seller_merchant_id=entry->>'merchantId' AND w.status='returned'
          AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.request->'asaasWalletReturns') e WHERE e->>'id'=w.id)) THEN RETURN false; END IF;
   END LOOP;
   RETURN true;
 END IF;
 RETURN false;
END $$;
