-- Extend the terminal refund guard only for separately certified money.
-- Original allocations, fees, payout identities and block reasons stay frozen.
CREATE FUNCTION marketplace_refund_funding_activation_valid(r marketplace_refund_plans, o marketplace_refund_operations)
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
     OR jsonb_array_length(r.allocation->'requiredContributions')<>0 OR r.amount_cents>f.net_amount_cents
     OR r.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb(r.amount_cents)
     OR o.request->'previousRefunds' IS DISTINCT FROM '[]'::jsonb
     OR EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE funding_plan_id=r.funding_plan_id AND id<>r.id)
     OR jsonb_typeof(o.request->'asaasWalletReturns') IS DISTINCT FROM 'array'
     OR jsonb_array_length(o.request->'asaasWalletReturns')=0 THEN RETURN false; END IF;
   FOR entry IN SELECT value FROM jsonb_array_elements(o.request->'asaasWalletReturns') LOOP
     IF NOT EXISTS(SELECT 1 FROM marketplace_asaas_wallet_returns w JOIN marketplace_payouts p ON p.id=w.payout_id
       WHERE w.id=entry->>'id' AND w.payout_id=entry->>'payoutId' AND w.funding_plan_id=r.funding_plan_id
       AND w.refund_plan_id=r.id AND w.host_merchant_id=r.host_merchant_id AND w.status='returned'
       AND w.certificate_hash=entry->>'certificateHash' AND w.request=entry->'request' AND w.proof=entry->'proof'
       AND w.amount_cents=p.amount_cents AND p.status='confirmed' AND p.provider_transfer_id=w.original_provider_transfer_id
       AND marketplace_asaas_wallet_return_request_valid(w)
       AND (SELECT count(*) FROM marketplace_asaas_wallet_return_receipts WHERE journal_id=w.id)=4) THEN RETURN false; END IF;
   END LOOP;
   IF (SELECT count(*) FROM jsonb_array_elements(o.request->'asaasWalletReturns'))<>
     (SELECT count(DISTINCT value->>'payoutId') FROM jsonb_array_elements(o.request->'asaasWalletReturns')) THEN RETURN false; END IF;
   FOR entry IN SELECT value FROM jsonb_array_elements(r.allocation->'merchantDebits') LOOP
     IF (entry->>'amountCents')::bigint>
       (SELECT COALESCE(sum(amount_cents),0) FROM marketplace_payouts WHERE funding_plan_id=r.funding_plan_id
         AND beneficiary_merchant_id=entry->>'merchantId' AND status='planned' AND claimed_at IS NULL AND provider_transfer_id IS NULL)
       + (SELECT COALESCE(sum(w.amount_cents),0) FROM marketplace_asaas_wallet_returns w
          WHERE w.funding_plan_id=r.funding_plan_id AND w.refund_plan_id=r.id AND w.seller_merchant_id=entry->>'merchantId'
          AND w.status='returned' AND EXISTS(SELECT 1 FROM jsonb_array_elements(o.request->'asaasWalletReturns') e WHERE e->>'id'=w.id)) THEN RETURN false; END IF;
   END LOOP;
   RETURN true;
 END IF;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_refund_plan_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.id, NEW.funding_plan_id, NEW.host_merchant_id, NEW.return_id, NEW.input_hash, NEW.allocation, NEW.allocation_hash, NEW.amount_cents, NEW.block_reason, NEW.created_at)
   IS DISTINCT FROM (OLD.id, OLD.funding_plan_id, OLD.host_merchant_id, OLD.return_id, OLD.input_hash, OLD.allocation, OLD.allocation_hash, OLD.amount_cents, OLD.block_reason, OLD.created_at)
   THEN RAISE EXCEPTION 'marketplace_refund_plan_immutable'; END IF;
 IF OLD.status IN ('blocked','confirmed','failed') AND NEW.status<>OLD.status THEN
   IF NOT (OLD.status='blocked' AND NEW.status='prepared' AND (
     (OLD.block_reason='marketplace_refund_transfer_reversal_required'
       AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_reversals r WHERE r.refund_plan_id=OLD.id AND r.status<>'confirmed')
       AND EXISTS(SELECT 1 FROM marketplace_refund_operations o WHERE o.refund_plan_id=OLD.id AND o.status='planned'
         AND o.request->>'kind'='refund' AND o.request->>'requestHash'=o.request_hash AND (o.request->>'amountCents')::numeric=OLD.amount_cents))
     OR EXISTS(SELECT 1 FROM marketplace_refund_operations o WHERE o.refund_plan_id=OLD.id AND marketplace_refund_funding_activation_valid(OLD,o))))
     THEN RAISE EXCEPTION 'marketplace_refund_plan_terminal'; END IF;
 END IF;
 RETURN NEW;
END $$;
