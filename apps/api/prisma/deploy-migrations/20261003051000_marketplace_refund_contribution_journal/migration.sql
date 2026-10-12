-- Separately paid, explicitly authorised Stripe receipt imports. No debit mandate.
CREATE TABLE marketplace_refund_contribution_customers (
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 customer_id text NOT NULL CHECK(customer_id ~ '^cus_[A-Za-z0-9_]+$'),
 proof jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(merchant_id,environment,account_fingerprint),
 UNIQUE(environment,account_fingerprint,customer_id),
 CHECK(COALESCE(proof->>'merchantId'=merchant_id AND proof->>'environment'=environment
   AND proof->>'accountFingerprint'=account_fingerprint AND proof->>'customerId'=customer_id
   AND proof->>'observedAt' IS NOT NULL,false))
);
CREATE TABLE marketplace_refund_contribution_journals (
 id text PRIMARY KEY,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 refund_plan_id text NOT NULL REFERENCES marketplace_refund_plans(id) ON DELETE RESTRICT,
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 actor_user_id text NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
 approval_hash text NOT NULL CHECK(approval_hash ~ '^[a-f0-9]{64}$'),
 customer_id text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 provider_payment_intent_id text NOT NULL UNIQUE CHECK(provider_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 request jsonb NOT NULL,
 request_hash text NOT NULL UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 customer_proof jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('approved','observing','unproven','credited')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 claim_token text,
 claimed_at timestamptz(3),
 certificate jsonb,
 certificate_hash text CHECK(certificate_hash ~ '^[a-f0-9]{64}$'),
 credit_sequence integer CHECK(credit_sequence>0),
 credited_at timestamptz(3),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(merchant_id,environment,account_fingerprint) REFERENCES marketplace_refund_contribution_customers(merchant_id,environment,account_fingerprint),
 CHECK(COALESCE(request->'version'='1'::jsonb AND request->>'reason'='refund_processing_fee_contribution'
   AND request->>'provider'='stripe' AND request->>'method'='card' AND request->>'currency'='BRL'
   AND request->>'contributionId'=id AND request->>'fundingPlanId'=funding_plan_id
   AND request->>'hostMerchantId'=host_merchant_id AND request->>'refundPlanId'=refund_plan_id
   AND request->>'merchantId'=merchant_id AND request->>'customerId'=customer_id
   AND request->>'environment'=environment AND request->>'accountFingerprint'=account_fingerprint
   AND request->>'providerPaymentIntentId'=provider_payment_intent_id AND request->>'requestHash'=request_hash
   AND request->>'authorisationId'='contribution-consent:'||id||':'||actor_user_id
   AND request->>'authorisedAt' IS NOT NULL AND request->>'reference' ~ '^mcontribution_[a-f0-9]{64}$'
   AND (request->>'grossAmountCents')::numeric BETWEEN 1 AND 2147483647
   AND trunc((request->>'grossAmountCents')::numeric)=(request->>'grossAmountCents')::numeric
   AND (request->>'maximumCreditCents')::numeric BETWEEN 1 AND 2147483647
   AND trunc((request->>'maximumCreditCents')::numeric)=(request->>'maximumCreditCents')::numeric,false)),
 CHECK((status='credited' AND certificate IS NOT NULL AND certificate_hash IS NOT NULL AND credit_sequence IS NOT NULL AND credited_at IS NOT NULL)
   OR (status<>'credited' AND certificate IS NULL AND certificate_hash IS NULL AND credit_sequence IS NULL AND credited_at IS NULL)),
 CHECK(status<>'observing' OR claim_token IS NOT NULL AND claimed_at IS NOT NULL)
);
CREATE UNIQUE INDEX marketplace_refund_contribution_one_open ON marketplace_refund_contribution_journals(funding_plan_id) WHERE status<>'credited';
CREATE INDEX marketplace_refund_contribution_recovery ON marketplace_refund_contribution_journals(status,updated_at,id);
CREATE TABLE marketplace_refund_contribution_credits (
 id text PRIMARY KEY REFERENCES marketplace_refund_contribution_journals(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL,
 refund_plan_id text NOT NULL,
 merchant_id text NOT NULL,
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 provider_payment_intent_id text NOT NULL UNIQUE,
 provider_charge_id text NOT NULL UNIQUE CHECK(provider_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
 provider_balance_transaction_id text NOT NULL UNIQUE CHECK(provider_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
 credit_sequence integer NOT NULL CHECK(credit_sequence>0),
 request_hash text NOT NULL,
 certificate jsonb NOT NULL,
 certificate_hash text NOT NULL CHECK(certificate_hash ~ '^[a-f0-9]{64}$'),
 credit_cents integer NOT NULL CHECK(credit_cents>0),
 processing_fee_cents integer NOT NULL CHECK(processing_fee_cents>=0),
 projected_plan jsonb NOT NULL,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(funding_plan_id,credit_sequence),
 CHECK(COALESCE(certificate->'version'='1'::jsonb AND certificate->>'reason'='refund_processing_fee_contribution_credit'
   AND certificate->>'certificateHash'=certificate_hash AND certificate#>>'{request,requestHash}'=request_hash
   AND certificate->'creditCents'=to_jsonb(credit_cents) AND certificate->'processingFeeCents'=to_jsonb(processing_fee_cents)
   AND certificate#>>'{proof,paymentIntent,id}'=provider_payment_intent_id
   AND certificate#>>'{proof,charge,id}'=provider_charge_id AND certificate#>>'{proof,balance,id}'=provider_balance_transaction_id
   AND certificate#>>'{proof,balance,sourceId}'=provider_charge_id AND certificate#>>'{proof,balance,type}'='charge'
   AND certificate#>>'{proof,balance,status}'='available' AND certificate#>>'{proof,balance,currency}'='BRL'
   AND certificate#>'{proof,balance,netCents}'=to_jsonb(credit_cents) AND certificate#>'{proof,balance,feeCents}'=to_jsonb(processing_fee_cents)
   AND (certificate#>>'{proof,balance,amountCents}')::bigint=credit_cents::bigint+processing_fee_cents
   AND certificate#>>'{proof,paymentIntent,status}'='succeeded' AND certificate#>>'{proof,charge,status}'='succeeded'
   AND certificate#>'{proof,charge,paid}'='true'::jsonb AND certificate#>'{proof,charge,captured}'='true'::jsonb
   AND certificate#>'{proof,charge,disputed}'='false'::jsonb AND certificate#>'{proof,charge,refundedAmountCents}'='0'::jsonb
   AND certificate#>'{proof,charge,refundsComplete}'='true'::jsonb AND certificate#>'{proof,charge,refundIds}'='[]'::jsonb,false))
);

CREATE FUNCTION marketplace_contribution_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(marketplace_recovery_canonical(value),'UTF8')),'hex')
$$;
CREATE FUNCTION marketplace_contribution_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_contribution_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_customer_immutable BEFORE UPDATE OR DELETE ON marketplace_refund_contribution_customers
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();
CREATE TRIGGER marketplace_contribution_credit_immutable BEFORE UPDATE OR DELETE ON marketplace_refund_contribution_credits
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();

CREATE FUNCTION marketplace_contribution_journal_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; rp RECORD; actor RECORD; mapping RECORD; outstanding bigint;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_contribution_immutable'; END IF;
 IF TG_OP='UPDATE' THEN
   IF OLD.status='credited' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_contribution_immutable'; END IF;
   IF (to_jsonb(NEW)-ARRAY['status','version','claim_token','claimed_at','certificate','certificate_hash','credit_sequence','credited_at','updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','claim_token','claimed_at','certificate','certificate_hash','credit_sequence','credited_at','updated_at'])
     THEN RAISE EXCEPTION 'marketplace_contribution_approval_immutable'; END IF;
   IF NEW.status='credited' AND OLD.status<>'observing' THEN RAISE EXCEPTION 'marketplace_contribution_claim_required'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_contribution_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT * INTO rp FROM marketplace_refund_plans WHERE id=NEW.refund_plan_id;
 SELECT * INTO actor FROM merchant_users WHERE id=NEW.actor_user_id;
 SELECT * INTO mapping FROM marketplace_refund_contribution_customers WHERE merchant_id=NEW.merchant_id
   AND environment=NEW.environment AND account_fingerprint=NEW.account_fingerprint;
 SELECT (value->>'amountCents')::bigint-COALESCE((SELECT sum(credit_cents) FROM marketplace_refund_contribution_credits
   WHERE funding_plan_id=f.payment_intent_id AND merchant_id=NEW.merchant_id),0) INTO outstanding
   FROM jsonb_array_elements(rp.allocation->'requiredContributions') WHERE value->>'merchantId'=NEW.merchant_id;
 IF f.provider IS DISTINCT FROM 'stripe' OR f.status IS DISTINCT FROM 'held' OR f.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id
   OR f.environment IS DISTINCT FROM NEW.environment OR f.account_fingerprint IS DISTINCT FROM NEW.account_fingerprint
   OR rp.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR rp.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id
   OR rp.status IS DISTINCT FROM 'blocked' OR rp.block_reason IS DISTINCT FROM 'marketplace_refund_seller_contribution_required'
   OR actor.merchant_id IS DISTINCT FROM NEW.merchant_id OR actor.role NOT IN ('owner','admin') OR actor.disabled_at IS NOT NULL
   OR mapping.customer_id IS DISTINCT FROM NEW.customer_id OR NEW.status<>'approved' OR NEW.version<>0
   OR NEW.request_hash IS DISTINCT FROM marketplace_contribution_hash(NEW.request-'requestHash')
   OR NEW.request->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
   OR NEW.request->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
   OR NEW.request->>'originalPaymentIntentId' IS DISTINCT FROM f.provider_payment_id
   OR NEW.request->>'originalChargeId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}'
   OR NEW.request->>'originalBalanceTransactionId' IS DISTINCT FROM f.budget#>>'{capture,balanceTransactionId}'
   OR outstanding IS NULL OR outstanding<=0 OR NEW.request->'maximumCreditCents' IS DISTINCT FROM to_jsonb(outstanding)
   OR NEW.request->>'sellerDestination' IS DISTINCT FROM (SELECT value->>'destination' FROM jsonb_array_elements(f.instructions->'destinations')
     WHERE value->>'merchantId'=NEW.merchant_id)
   OR NEW.customer_proof->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR NEW.customer_proof->>'customerId' IS DISTINCT FROM NEW.customer_id
   OR NEW.customer_proof->>'environment' IS DISTINCT FROM NEW.environment OR NEW.customer_proof->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint
   OR NEW.customer_proof->>'observedAt' IS NULL
   OR (NEW.customer_proof->>'observedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR NOT EXISTS(SELECT 1 FROM marketplace_payouts p WHERE p.funding_plan_id=f.payment_intent_id AND p.beneficiary_merchant_id=NEW.merchant_id
     AND p.destination=NEW.request->>'sellerDestination' AND p.status='planned' AND p.claimed_at IS NULL AND p.provider_transfer_id IS NULL)
   OR EXISTS(SELECT 1 FROM payment_intents WHERE provider_payment_id=NEW.provider_payment_intent_id)
   THEN RAISE EXCEPTION 'marketplace_contribution_approval_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_journal_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_refund_contribution_journals
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_journal_guard();

CREATE FUNCTION marketplace_contribution_credit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j RECORD; f RECORD; rp RECORD; ledger RECORD; pay RECORD; amount bigint; fee bigint; total bigint; c jsonb;
BEGIN
 SELECT * INTO j FROM marketplace_refund_contribution_journals WHERE id=NEW.id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=j.funding_plan_id;
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_contribution_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT * INTO rp FROM marketplace_refund_plans WHERE id=j.refund_plan_id;
 SELECT * INTO ledger FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id;
 SELECT * INTO pay FROM payment_intents WHERE id=f.payment_intent_id;
 c:=NEW.certificate;
 IF j.status IS DISTINCT FROM 'observing' OR j.claim_token IS NULL OR j.claimed_at IS NULL
   OR f.provider IS DISTINCT FROM 'stripe' OR f.status IS DISTINCT FROM 'held' OR f.funded_at IS NULL
   OR ledger.purchased_at IS NULL OR ledger.chargeback_at IS NOT NULL
   OR pay.merchant_id IS DISTINCT FROM f.host_merchant_id OR pay.provider_payment_id IS DISTINCT FROM f.provider_payment_id
   OR pay.status IS DISTINCT FROM 'approved' OR pay.amount_cents IS DISTINCT FROM f.amount_cents
   OR pay.approved_amount_cents IS DISTINCT FROM f.amount_cents OR pay.currency IS DISTINCT FROM 'BRL'
   OR pay.creation#>'{input,marketplaceFunding}' IS DISTINCT FROM f.instructions
   OR f.instructions_hash IS DISTINCT FROM marketplace_contribution_hash(f.instructions)
   OR marketplace_contribution_hash(f.budget) IS DISTINCT FROM j.request->>'budgetHash'
   OR rp.status IS DISTINCT FROM 'blocked' OR rp.block_reason IS DISTINCT FROM 'marketplace_refund_seller_contribution_required'
   OR NEW.funding_plan_id IS DISTINCT FROM j.funding_plan_id OR NEW.host_merchant_id IS DISTINCT FROM j.host_merchant_id
   OR NEW.refund_plan_id IS DISTINCT FROM j.refund_plan_id OR NEW.merchant_id IS DISTINCT FROM j.merchant_id
   OR NEW.environment IS DISTINCT FROM j.environment OR NEW.account_fingerprint IS DISTINCT FROM j.account_fingerprint
   OR NEW.provider_payment_intent_id IS DISTINCT FROM j.provider_payment_intent_id OR NEW.request_hash IS DISTINCT FROM j.request_hash
   OR c->'request' IS DISTINCT FROM j.request OR c#>'{proof,request}' IS DISTINCT FROM j.request
   OR NEW.certificate_hash IS DISTINCT FROM marketplace_contribution_hash(c-'certificateHash')
   OR c#>>'{proof,provider}' IS DISTINCT FROM 'stripe' OR c#>>'{proof,accountFingerprint}' IS DISTINCT FROM j.account_fingerprint
   OR c#>>'{proof,paymentIntent,customerId}' IS DISTINCT FROM j.customer_id OR c#>>'{proof,charge,customerId}' IS DISTINCT FROM j.customer_id
   OR c#>>'{proof,charge,paymentIntentId}' IS DISTINCT FROM j.provider_payment_intent_id
   OR c#>>'{proof,paymentIntent,latestChargeId}' IS DISTINCT FROM NEW.provider_charge_id
   OR c#>>'{proof,charge,balanceTransactionId}' IS DISTINCT FROM NEW.provider_balance_transaction_id
   OR c#>>'{proof,paymentIntent,environment}' IS DISTINCT FROM j.environment OR c#>>'{proof,charge,environment}' IS DISTINCT FROM j.environment
   OR c#>>'{proof,charge,paymentMethodType}' IS DISTINCT FROM 'card'
   OR c#>'{proof,paymentIntent,applicationFeeCents}' IS DISTINCT FROM 'null'::jsonb
   OR c#>'{proof,paymentIntent,onBehalfOf}' IS DISTINCT FROM 'null'::jsonb OR c#>'{proof,paymentIntent,transferDestination}' IS DISTINCT FROM 'null'::jsonb
   OR c#>'{proof,charge,applicationFeeCents}' IS DISTINCT FROM 'null'::jsonb OR c#>'{proof,charge,transferId}' IS DISTINCT FROM 'null'::jsonb
   OR c#>'{proof,paymentIntent,amountCents}' IS DISTINCT FROM j.request->'grossAmountCents'
   OR c#>'{proof,paymentIntent,receivedAmountCents}' IS DISTINCT FROM j.request->'grossAmountCents'
   OR c#>'{proof,charge,amountCents}' IS DISTINCT FROM j.request->'grossAmountCents'
   OR c#>'{proof,balance,amountCents}' IS DISTINCT FROM j.request->'grossAmountCents'
   OR NEW.credit_cents>(j.request->>'maximumCreditCents')::bigint
   OR c#>>'{proof,observedAt}' IS NULL
   OR (c#>>'{proof,observedAt}')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR (c#>>'{proof,observedAt}')::timestamptz<(j.request->>'authorisedAt')::timestamptz
   OR NEW.credit_sequence<>(SELECT count(*)+1 FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL))
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals r JOIN marketplace_refund_plans p ON p.id=r.refund_plan_id
     WHERE p.funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_refund_plans p LEFT JOIN marketplace_refund_operations o ON o.refund_plan_id=p.id
     WHERE p.funding_plan_id=f.payment_intent_id AND p.id<>j.refund_plan_id AND
       (p.status<>'confirmed' OR o.status IS DISTINCT FROM 'confirmed' OR o.provider_operation_id IS NULL OR o.claimed_at IS NULL OR o.reconciled_at IS NULL))
   OR EXISTS(SELECT 1 FROM marketplace_refund_operations WHERE refund_plan_id=j.refund_plan_id)
   OR EXISTS(SELECT 1 FROM marketplace_funding_plans WHERE provider='stripe' AND
     (provider_payment_id=NEW.provider_payment_intent_id OR budget#>>'{capture,sourceId}'=NEW.provider_charge_id
      OR budget#>>'{capture,balanceTransactionId}'=NEW.provider_balance_transaction_id))
   OR EXISTS(SELECT 1 FROM payment_intents WHERE provider_payment_id=NEW.provider_payment_intent_id)
   THEN RAISE EXCEPTION 'marketplace_contribution_credit_unproven'; END IF;
 IF c#>'{proof,paymentIntent,metadata}' IS DISTINCT FROM jsonb_build_object('reason','refund_processing_fee_contribution','contributionId',j.id,
   'fundingPlanId',j.funding_plan_id,'refundPlanId',j.refund_plan_id,'merchantId',j.merchant_id,'requestHash',j.request_hash,'reference',j.request->>'reference')
   THEN RAISE EXCEPTION 'marketplace_contribution_receipt_unbound'; END IF;
 SELECT COALESCE(sum(credit_cents),0)+NEW.credit_cents,COALESCE(sum(processing_fee_cents),0)+NEW.processing_fee_cents INTO amount,fee
   FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id;
 IF NEW.projected_plan->>'fundingPlanId' IS DISTINCT FROM f.payment_intent_id OR NEW.projected_plan->>'hostMerchantId' IS DISTINCT FROM f.host_merchant_id
   OR NEW.projected_plan->>'refundPlanId' IS DISTINCT FROM j.refund_plan_id OR NEW.projected_plan->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
   OR NEW.projected_plan->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
   OR NEW.projected_plan->>'planHash' IS DISTINCT FROM marketplace_contribution_hash(NEW.projected_plan-'planHash')
   OR NEW.projected_plan->'contributedNetCents' IS DISTINCT FROM to_jsonb(amount)
   OR NEW.projected_plan->'contributionProcessingFeeCents' IS DISTINCT FROM to_jsonb(fee)
   OR NEW.projected_plan->'cumulativeRefundCents' IS DISTINCT FROM rp.allocation->'cumulativeRefundCents'
   OR jsonb_array_length(NEW.projected_plan->'credits')<>NEW.credit_sequence
   OR NEW.projected_plan->'credits' IS DISTINCT FROM ((SELECT COALESCE(jsonb_agg(jsonb_build_object('contributionId',id,'certificateHash',certificate_hash)
     ORDER BY credit_sequence),'[]'::jsonb) FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id)
     ||jsonb_build_array(jsonb_build_object('contributionId',NEW.id,'certificateHash',NEW.certificate_hash)))
   THEN RAISE EXCEPTION 'marketplace_contribution_projection_unproven'; END IF;
 SELECT COALESCE(sum((value->>'amountCents')::bigint),0)+(NEW.projected_plan->>'platformRemainingCents')::bigint
   +(NEW.projected_plan->>'cumulativeRefundCents')::bigint INTO total FROM jsonb_array_elements(NEW.projected_plan->'remainingBeneficiaries');
 IF total IS DISTINCT FROM f.net_amount_cents::bigint+amount THEN RAISE EXCEPTION 'marketplace_contribution_budget_not_conserved'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_credit_guard BEFORE INSERT ON marketplace_refund_contribution_credits
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_credit_guard();

CREATE FUNCTION marketplace_contribution_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j RECORD; c RECORD;
BEGIN
 SELECT * INTO j FROM marketplace_refund_contribution_journals WHERE id=NEW.id;
 SELECT * INTO c FROM marketplace_refund_contribution_credits WHERE id=NEW.id;
 IF (j.status='credited') IS DISTINCT FROM (c.id IS NOT NULL) OR c.id IS NOT NULL AND
   (j.certificate IS DISTINCT FROM c.certificate OR j.certificate_hash IS DISTINCT FROM c.certificate_hash OR j.credit_sequence IS DISTINCT FROM c.credit_sequence
    OR NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_refund_contribution_credited_'||j.id
      AND event_type='marketplace.refund.contribution_credited' AND merchant_id=j.merchant_id
      AND payload->>'certificate_hash'=c.certificate_hash AND payload->'credited_net_cents'=to_jsonb(c.credit_cents)))
   THEN RAISE EXCEPTION 'marketplace_contribution_credit_commit_incomplete'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_contribution_credit_commit AFTER INSERT ON marketplace_refund_contribution_credits
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_contribution_journal_commit AFTER INSERT OR UPDATE ON marketplace_refund_contribution_journals
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_commit_guard();
