-- Hosted, human-consented contributions. No off-session mandate and no replay.
CREATE TABLE marketplace_contribution_checkouts (
 id text PRIMARY KEY,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 refund_plan_id text NOT NULL REFERENCES marketplace_refund_plans(id) ON DELETE RESTRICT,
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 actor_user_id text NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
 approval_hash text NOT NULL CHECK(approval_hash ~ '^[a-f0-9]{64}$'),
 customer_id text NOT NULL,environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 request jsonb NOT NULL,request_hash text NOT NULL UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),customer_proof jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('approved','creating','open','paid','credited','expired','unproven')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),session_id text UNIQUE CHECK(session_id ~ '^cs_(test_|live_)?[A-Za-z0-9_]+$'),
 payment_intent_id text UNIQUE CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),checkout_url text,observation jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,submitted_at timestamptz(3),updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(merchant_id,environment,account_fingerprint) REFERENCES marketplace_refund_contribution_customers(merchant_id,environment,account_fingerprint),
 CHECK(COALESCE(request->'version'='1'::jsonb AND request->>'reason'='refund_processing_fee_contribution' AND request->>'provider'='stripe'
   AND request->>'method'='card' AND request->>'currency'='BRL' AND request->>'contributionId'=id AND request->>'fundingPlanId'=funding_plan_id
   AND request->>'hostMerchantId'=host_merchant_id AND request->>'refundPlanId'=refund_plan_id AND request->>'merchantId'=merchant_id
   AND request->>'actorUserId'=actor_user_id AND request->>'customerId'=customer_id AND request->>'environment'=environment
   AND request->>'accountFingerprint'=account_fingerprint AND request->>'requestHash'=request_hash AND request->>'reference' ~ '^mcollect_[a-f0-9]{64}$'
   AND request->>'planHash' ~ '^[a-f0-9]{64}$' AND (request->>'grossAmountCents')::numeric BETWEEN 1 AND 2147483647
   AND trunc((request->>'grossAmountCents')::numeric)=(request->>'grossAmountCents')::numeric
   AND (request->>'maximumCreditCents')::numeric BETWEEN 1 AND 2147483647
   AND trunc((request->>'maximumCreditCents')::numeric)=(request->>'maximumCreditCents')::numeric,false)),
 CHECK(status IN ('approved','expired') AND submitted_at IS NULL AND version=0 OR status<>'approved' AND submitted_at IS NOT NULL AND version=1),
 CHECK(status NOT IN ('open','paid','credited','expired') OR session_id IS NOT NULL AND observation IS NOT NULL OR
   status='expired' AND submitted_at IS NULL AND observation->>'reason'='unsubmitted_approval_cancelled'),
 CHECK(status NOT IN ('paid','credited') OR payment_intent_id IS NOT NULL)
);
CREATE UNIQUE INDEX marketplace_contribution_checkout_one_open ON marketplace_contribution_checkouts(funding_plan_id) WHERE status NOT IN ('credited','expired');
CREATE INDEX marketplace_contribution_checkout_recovery ON marketplace_contribution_checkouts(status,updated_at,id);
CREATE INDEX marketplace_contribution_checkout_seller ON marketplace_contribution_checkouts(merchant_id,id);
CREATE TABLE marketplace_contribution_excess_liabilities (
 contribution_id text PRIMARY KEY REFERENCES marketplace_refund_contribution_credits(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 amount_cents integer NOT NULL CHECK(amount_cents>0),certificate_hash text NOT NULL CHECK(certificate_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'held' CHECK(status IN ('held','unknown','pending','failed','returned')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),request jsonb,request_hash text UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 provider_refund_id text UNIQUE CHECK(provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),proof jsonb,returned_cents integer NOT NULL DEFAULT 0,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,submitted_at timestamptz(3),returned_at timestamptz(3),
 CHECK(status='held' AND version=0 AND request IS NULL AND request_hash IS NULL AND submitted_at IS NULL OR
   status<>'held' AND version=1 AND request IS NOT NULL AND request_hash IS NOT NULL AND submitted_at IS NOT NULL),
 CHECK(status='returned' AND returned_cents=amount_cents AND returned_at IS NOT NULL AND proof IS NOT NULL AND provider_refund_id IS NOT NULL
   OR status<>'returned' AND returned_cents=0 AND returned_at IS NULL AND proof IS NULL)
);
CREATE INDEX marketplace_contribution_excess_recovery ON marketplace_contribution_excess_liabilities(status,created_at,contribution_id);

CREATE FUNCTION marketplace_contribution_checkout_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE f RECORD; rp RECORD; actor RECORD; mapping RECORD; outstanding bigint; s jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_contribution_checkout_immutable'; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=NEW.funding_plan_id;
 IF f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_contribution_checkout_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 IF TG_OP='UPDATE' THEN
   IF OLD.status IN ('credited','expired') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_contribution_checkout_immutable'; END IF;
   IF (to_jsonb(NEW)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at']) THEN RAISE EXCEPTION 'marketplace_contribution_checkout_approval_immutable'; END IF;
   IF OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id OR
     OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id OR
     OLD.status='paid' AND NEW.status NOT IN ('paid','credited') OR NEW.status='approved' OR
     OLD.status='approved' AND NOT (NEW.status='creating' AND NEW.version=1 AND NEW.submitted_at IS NOT NULL OR
       NEW.status='expired' AND NEW.version=0 AND NEW.submitted_at IS NULL AND NEW.session_id IS NULL AND NEW.payment_intent_id IS NULL
         AND NEW.observation=jsonb_build_object('reason','unsubmitted_approval_cancelled','requestHash',NEW.request_hash)) OR
     OLD.status<>'approved' AND (NEW.version<>OLD.version OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
     THEN RAISE EXCEPTION 'marketplace_contribution_checkout_first_submission_only'; END IF;
   IF NEW.status IN ('open','paid','expired') AND NEW.submitted_at IS NOT NULL THEN
     s:=NEW.observation->'session';
     IF NEW.observation->>'requestHash' IS DISTINCT FROM NEW.request_hash OR NEW.observation->>'state' IS DISTINCT FROM NEW.status
       OR s->>'id' IS DISTINCT FROM NEW.session_id OR s->>'object' IS DISTINCT FROM 'checkout.session' OR s->>'mode' IS DISTINCT FROM 'payment'
       OR s->>'customer' IS DISTINCT FROM NEW.customer_id OR s->>'currency' IS DISTINCT FROM 'brl' OR s->'amount_total' IS DISTINCT FROM NEW.request->'grossAmountCents'
       OR s->'amount_subtotal' IS DISTINCT FROM NEW.request->'grossAmountCents' OR s->'payment_method_types' IS DISTINCT FROM '["card"]'::jsonb
       OR s->'livemode' IS DISTINCT FROM to_jsonb(NEW.environment='live') OR s->>'client_reference_id' IS DISTINCT FROM NEW.request->>'reference'
       OR s->'expires_at' IS DISTINCT FROM NEW.request->'expiresAt' OR s#>'{total_details,amount_discount}' IS DISTINCT FROM '0'::jsonb
       OR s#>'{total_details,amount_shipping}' IS DISTINCT FROM '0'::jsonb OR s#>'{total_details,amount_tax}' IS DISTINCT FROM '0'::jsonb
       OR s->'metadata' IS DISTINCT FROM jsonb_build_object('reason','refund_processing_fee_contribution','contributionId',NEW.id,
         'fundingPlanId',NEW.funding_plan_id,'refundPlanId',NEW.refund_plan_id,'merchantId',NEW.merchant_id,'requestHash',NEW.request_hash,'reference',NEW.request->>'reference')
       OR NEW.status='paid' AND (s->>'status' IS DISTINCT FROM 'complete' OR s->>'payment_status' IS DISTINCT FROM 'paid' OR s->>'payment_intent' IS DISTINCT FROM NEW.payment_intent_id)
       OR NEW.status='open' AND (s->>'status' IS DISTINCT FROM 'open' OR s->>'payment_status' IS DISTINCT FROM 'unpaid' OR NEW.checkout_url IS DISTINCT FROM s->>'url'
         OR NEW.checkout_url !~ '^https://checkout[.]stripe[.]com/')
       OR NEW.status='expired' AND (s->>'status' IS DISTINCT FROM 'expired' OR s->>'payment_status' IS DISTINCT FROM 'unpaid')
       OR EXISTS(SELECT 1 FROM payment_intents WHERE provider_payment_id=NEW.payment_intent_id)
       OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE provider_payment_intent_id=NEW.payment_intent_id AND id<>NEW.id)
       THEN RAISE EXCEPTION 'marketplace_contribution_checkout_receipt_unproven'; END IF;
   END IF;
   IF NEW.status='credited' AND NOT EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits c WHERE c.id=NEW.id
     AND c.certificate#>>'{request,collection,requestHash}'=NEW.request_hash AND c.provider_payment_intent_id=NEW.payment_intent_id)
     THEN RAISE EXCEPTION 'marketplace_contribution_checkout_credit_unproven'; END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO rp FROM marketplace_refund_plans WHERE id=NEW.refund_plan_id;
 SELECT * INTO actor FROM merchant_users WHERE id=NEW.actor_user_id;
 SELECT * INTO mapping FROM marketplace_refund_contribution_customers WHERE merchant_id=NEW.merchant_id AND environment=NEW.environment AND account_fingerprint=NEW.account_fingerprint;
 SELECT (value->>'amountCents')::bigint-COALESCE((SELECT sum(credit_cents) FROM marketplace_refund_contribution_credits WHERE funding_plan_id=f.payment_intent_id AND merchant_id=NEW.merchant_id),0)
   INTO outstanding FROM jsonb_array_elements(rp.allocation->'requiredContributions') WHERE value->>'merchantId'=NEW.merchant_id;
 IF f.provider IS DISTINCT FROM 'stripe' OR f.status IS DISTINCT FROM 'held' OR f.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id OR
   f.environment IS DISTINCT FROM NEW.environment OR f.account_fingerprint IS DISTINCT FROM NEW.account_fingerprint OR rp.funding_plan_id IS DISTINCT FROM f.payment_intent_id OR
   rp.status IS DISTINCT FROM 'blocked' OR rp.block_reason IS DISTINCT FROM 'marketplace_refund_seller_contribution_required' OR
   (rp.allocation->>'cumulativeRefundCents')::bigint IS DISTINCT FROM f.amount_cents::bigint OR
   actor.merchant_id IS DISTINCT FROM NEW.merchant_id OR actor.role NOT IN ('owner','admin') OR actor.disabled_at IS NOT NULL OR
   mapping.customer_id IS DISTINCT FROM NEW.customer_id OR NEW.status<>'approved' OR NEW.version<>0 OR
   NEW.request_hash IS DISTINCT FROM marketplace_contribution_hash(NEW.request-'requestHash') OR
   NEW.request->>'originalPaymentIntentId' IS DISTINCT FROM f.provider_payment_id OR NEW.request->>'originalChargeId' IS DISTINCT FROM f.budget#>>'{capture,sourceId}' OR
   NEW.request->'originalAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents) OR outstanding IS NULL OR outstanding<=0 OR NEW.request->'maximumCreditCents' IS DISTINCT FROM to_jsonb(outstanding) OR
   NEW.customer_proof->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR NEW.customer_proof->>'customerId' IS DISTINCT FROM NEW.customer_id OR
   NEW.customer_proof->>'environment' IS DISTINCT FROM NEW.environment OR NEW.customer_proof->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint OR
   NEW.customer_proof->>'observedAt' IS NULL OR (NEW.customer_proof->>'observedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds' OR
   NOT EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id AND beneficiary_merchant_id=NEW.merchant_id AND status='planned' AND claimed_at IS NULL AND provider_transfer_id IS NULL) OR
   EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=f.payment_intent_id AND status<>'credited')
   THEN RAISE EXCEPTION 'marketplace_contribution_checkout_approval_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_checkout_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_contribution_checkouts FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_checkout_guard();

CREATE FUNCTION marketplace_contribution_collection_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD;
BEGIN
 IF NEW.request ? 'collection' THEN
   SELECT * INTO c FROM marketplace_contribution_checkouts WHERE id=NEW.id;
   IF c.status IS DISTINCT FROM 'paid' OR c.payment_intent_id IS DISTINCT FROM NEW.provider_payment_intent_id OR c.merchant_id IS DISTINCT FROM NEW.merchant_id OR
     c.actor_user_id IS DISTINCT FROM NEW.actor_user_id OR c.refund_plan_id IS DISTINCT FROM NEW.refund_plan_id OR c.funding_plan_id IS DISTINCT FROM NEW.funding_plan_id OR
     c.customer_id IS DISTINCT FROM NEW.customer_id OR c.request->'grossAmountCents' IS DISTINCT FROM NEW.request->'grossAmountCents' OR
     c.request->'maximumCreditCents' IS DISTINCT FROM NEW.request->'maximumCreditCents' OR c.request->>'planHash' IS DISTINCT FROM NEW.request->>'planHash' OR
     NEW.request->'collection' IS DISTINCT FROM jsonb_build_object('journalId',c.id,'requestHash',c.request_hash,'reference',c.request->>'reference')
     THEN RAISE EXCEPTION 'marketplace_contribution_collection_unproven'; END IF;
 ELSIF EXISTS(SELECT 1 FROM marketplace_contribution_checkouts WHERE funding_plan_id=NEW.funding_plan_id AND status NOT IN ('credited','expired')) THEN
   RAISE EXCEPTION 'marketplace_contribution_pending_checkout';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_collection_binding BEFORE INSERT ON marketplace_refund_contribution_journals FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_collection_binding();

CREATE FUNCTION marketplace_contribution_excess_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; r RECORD; p RECORD; ledger RECORD; s jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_contribution_excess_immutable'; END IF;
 SELECT * INTO c FROM marketplace_refund_contribution_credits WHERE id=NEW.contribution_id;
 SELECT * INTO r FROM marketplace_contribution_checkouts WHERE id=NEW.contribution_id;
 IF c.id IS NULL OR c.certificate_hash IS DISTINCT FROM NEW.certificate_hash OR c.funding_plan_id IS DISTINCT FROM NEW.funding_plan_id OR
   c.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id OR c.merchant_id IS DISTINCT FROM NEW.merchant_id OR
   c.certificate->'excessLiabilityCents' IS DISTINCT FROM to_jsonb(NEW.amount_cents) OR c.certificate#>>'{request,collection,journalId}' IS DISTINCT FROM r.id
   THEN RAISE EXCEPTION 'marketplace_contribution_excess_unproven'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.status<>'held' OR NEW.returned_cents<>0 THEN RAISE EXCEPTION 'marketplace_contribution_excess_initial_hold_required'; END IF;
   RETURN NEW;
 END IF;
 IF OLD.status='returned' AND NEW IS DISTINCT FROM OLD OR (to_jsonb(NEW)-ARRAY['status','version','request','request_hash','provider_refund_id','proof','returned_cents','submitted_at','returned_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['status','version','request','request_hash','provider_refund_id','proof','returned_cents','submitted_at','returned_at']) THEN RAISE EXCEPTION 'marketplace_contribution_excess_immutable'; END IF;
 IF OLD.request IS NOT NULL AND (OLD.request IS DISTINCT FROM NEW.request OR OLD.request_hash IS DISTINCT FROM NEW.request_hash OR OLD.version<>NEW.version OR OLD.submitted_at IS DISTINCT FROM NEW.submitted_at) OR
   OLD.provider_refund_id IS NOT NULL AND OLD.provider_refund_id IS DISTINCT FROM NEW.provider_refund_id OR NEW.status='held' OR
   OLD.status='held' AND (NEW.status<>'unknown' OR NEW.version<>1) THEN RAISE EXCEPTION 'marketplace_contribution_excess_first_submission_only'; END IF;
 IF OLD.status='held' THEN
   SELECT * INTO p FROM payment_intents WHERE id=NEW.funding_plan_id AND merchant_id=NEW.host_merchant_id;
   SELECT * INTO ledger FROM marketplace_order_ledgers WHERE host_merchant_id=NEW.host_merchant_id AND order_id=p.provider_payment_id;
   IF p.status IS DISTINCT FROM 'refunded' OR p.provider_payment_id IS DISTINCT FROM r.request->>'originalPaymentIntentId' OR ledger.purchased_at IS NULL OR ledger.chargeback_at IS NOT NULL OR
     NOT EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE id=r.refund_plan_id AND status='confirmed' AND (allocation->>'cumulativeRefundCents')::bigint=p.amount_cents::bigint) OR
     EXISTS(SELECT 1 FROM marketplace_refund_plans rp LEFT JOIN marketplace_refund_operations op ON op.refund_plan_id=rp.id WHERE rp.funding_plan_id=NEW.funding_plan_id
       AND (rp.status<>'confirmed' OR op.status IS DISTINCT FROM 'confirmed' OR op.provider_operation_id IS NULL OR op.reconciled_at IS NULL)) OR
     EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=NEW.funding_plan_id AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL)) OR
     NEW.request_hash IS DISTINCT FROM marketplace_contribution_hash(NEW.request-'requestHash') OR NEW.request->'certificate' IS DISTINCT FROM c.certificate OR
     NEW.request->>'contributionId' IS DISTINCT FROM NEW.contribution_id OR NEW.request->>'hostMerchantId' IS DISTINCT FROM NEW.host_merchant_id OR
     NEW.request->>'fundingPlanId' IS DISTINCT FROM NEW.funding_plan_id OR NEW.request->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR
     NEW.request->'amountCents' IS DISTINCT FROM to_jsonb(NEW.amount_cents) OR NEW.request->'originalAmountCents' IS DISTINCT FROM to_jsonb(p.amount_cents) OR
     NEW.request->>'accountFingerprint' IS DISTINCT FROM c.account_fingerprint OR NEW.request->>'environment' IS DISTINCT FROM c.environment OR
     NEW.request->>'reference' !~ '^mexcess_[a-f0-9]{64}$' THEN RAISE EXCEPTION 'marketplace_contribution_excess_refund_unavailable'; END IF;
 END IF;
 IF NEW.status='returned' THEN
   s:=NEW.proof;
   IF s->>'requestHash' IS DISTINCT FROM NEW.request_hash OR s->>'accountFingerprint' IS DISTINCT FROM c.account_fingerprint OR
     s#>>'{refund,id}' IS DISTINCT FROM NEW.provider_refund_id OR s#>>'{refund,status}' IS DISTINCT FROM 'succeeded' OR
     s#>'{refund,amount}' IS DISTINCT FROM to_jsonb(NEW.amount_cents) OR s#>>'{refund,charge}' IS DISTINCT FROM c.provider_charge_id OR
     s#>>'{refund,payment_intent}' IS DISTINCT FROM c.provider_payment_intent_id OR s#>>'{refund,currency}' IS DISTINCT FROM 'brl' OR
     s#>>'{refund,metadata,requestHash}' IS DISTINCT FROM NEW.request_hash OR s#>>'{balance,id}' IS DISTINCT FROM s#>>'{refund,balance_transaction}' OR
     s#>>'{balance,source}' IS DISTINCT FROM NEW.provider_refund_id OR s#>>'{balance,type}' IS DISTINCT FROM 'refund' OR s#>>'{balance,currency}' IS DISTINCT FROM 'brl' OR
     s#>>'{balance,status}' IS DISTINCT FROM 'available' OR s#>'{balance,amount}' IS DISTINCT FROM to_jsonb(-NEW.amount_cents) OR
     s#>'{balance,fee}' IS DISTINCT FROM '0'::jsonb OR s#>'{balance,net}' IS DISTINCT FROM to_jsonb(-NEW.amount_cents) OR
     s->>'observedAt' IS NULL OR (s->>'observedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
     THEN RAISE EXCEPTION 'marketplace_contribution_excess_receipt_unproven'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_contribution_excess_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_contribution_excess_liabilities FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_excess_guard();

CREATE FUNCTION marketplace_contribution_checkout_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; l RECORD; contribution_id_value text;
BEGIN
 -- Resolve only the field owned by the triggering table. A SQL CASE still
 -- prepares both NEW record accesses and fails for the other table's field.
 IF TG_TABLE_NAME='marketplace_contribution_checkouts' THEN contribution_id_value:=NEW.id;
 ELSE contribution_id_value:=NEW.contribution_id; END IF;
 SELECT * INTO c FROM marketplace_contribution_checkouts WHERE id=contribution_id_value;
 SELECT * INTO l FROM marketplace_contribution_excess_liabilities WHERE contribution_id=c.id;
 IF c.id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_contribution_checkout_approved_'||c.id
     AND event_type='marketplace.contribution_checkout_approved' AND merchant_id=c.merchant_id AND payload->>'request_hash'=c.request_hash) OR
   c.submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_contribution_checkout_submitted_'||c.id
     AND event_type='marketplace.contribution_checkout_submitted' AND merchant_id=c.merchant_id AND payload->>'request_hash'=c.request_hash) OR
   c.status IN ('paid','credited') AND NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_contribution_checkout_paid_'||c.id
     AND event_type='marketplace.contribution_checkout_paid' AND merchant_id=c.merchant_id AND payload->>'request_hash'=c.request_hash) OR
   c.status='expired' AND NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_contribution_checkout_expired_'||c.id
     AND event_type='marketplace.contribution_checkout_expired' AND merchant_id=c.merchant_id AND payload->>'request_hash'=c.request_hash) OR
   l.status='returned' AND NOT EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_contribution_checkout_excess_returned_'||c.id
     AND event_type='marketplace.contribution_excess_returned' AND merchant_id=c.merchant_id AND payload->>'refund_request_hash'=l.request_hash
     AND payload->'returned_excess_cents'=to_jsonb(l.amount_cents)) THEN RAISE EXCEPTION 'marketplace_contribution_checkout_commit_incomplete'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_contribution_checkout_commit AFTER INSERT OR UPDATE ON marketplace_contribution_checkouts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_checkout_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_contribution_excess_commit AFTER INSERT OR UPDATE ON marketplace_contribution_excess_liabilities DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_checkout_commit_guard();

-- Phase40 bounded legacy certificate extension. Old approvals and historical credit rows are preserved.
DO $$
DECLARE names text[];
BEGIN
 SELECT array_agg(conname) INTO names FROM pg_constraint WHERE conrelid='marketplace_refund_contribution_credits'::regclass
   AND contype='c' AND position('refund_processing_fee_contribution_credit' in pg_get_constraintdef(oid))>0;
 IF cardinality(names) IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'marketplace_contribution_legacy_constraint_unproven'; END IF;
 EXECUTE format('ALTER TABLE marketplace_refund_contribution_credits DROP CONSTRAINT %I',names[1]);
END $$;
ALTER TABLE marketplace_refund_contribution_credits ADD CONSTRAINT marketplace_contribution_credit_net_and_liability CHECK(COALESCE(certificate->'version'='1'::jsonb AND certificate->>'reason'='refund_processing_fee_contribution_credit'
   AND certificate->>'certificateHash'=certificate_hash AND certificate#>>'{request,requestHash}'=request_hash
   AND certificate->'creditCents'=to_jsonb(credit_cents) AND certificate->'processingFeeCents'=to_jsonb(processing_fee_cents)
   AND certificate#>>'{proof,paymentIntent,id}'=provider_payment_intent_id
   AND certificate#>>'{proof,charge,id}'=provider_charge_id AND certificate#>>'{proof,balance,id}'=provider_balance_transaction_id
   AND certificate#>>'{proof,balance,sourceId}'=provider_charge_id AND certificate#>>'{proof,balance,type}'='charge'
   AND certificate#>>'{proof,balance,status}'='available' AND certificate#>>'{proof,balance,currency}'='BRL'
   AND certificate#>'{proof,balance,netCents}'=to_jsonb(credit_cents::bigint+COALESCE((certificate->>'excessLiabilityCents')::bigint,0)) AND certificate#>'{proof,balance,feeCents}'=to_jsonb(processing_fee_cents)
   AND (certificate#>>'{proof,balance,amountCents}')::bigint=credit_cents::bigint+processing_fee_cents+COALESCE((certificate->>'excessLiabilityCents')::bigint,0)
   AND certificate#>>'{proof,paymentIntent,status}'='succeeded' AND certificate#>>'{proof,charge,status}'='succeeded'
   AND certificate#>'{proof,charge,paid}'='true'::jsonb AND certificate#>'{proof,charge,captured}'='true'::jsonb
   AND certificate#>'{proof,charge,disputed}'='false'::jsonb AND certificate#>'{proof,charge,refundedAmountCents}'='0'::jsonb
   AND certificate#>'{proof,charge,refundsComplete}'='true'::jsonb AND certificate#>'{proof,charge,refundIds}'='[]'::jsonb
   AND (NOT (certificate#>'{request}' ? 'collection') AND NOT (certificate ? 'excessLiabilityCents') OR
     certificate#>'{request}' ? 'collection' AND jsonb_typeof(certificate->'excessLiabilityCents')='number'
     AND (certificate->>'excessLiabilityCents')::numeric BETWEEN 0 AND 2147483647
     AND trunc((certificate->>'excessLiabilityCents')::numeric)=(certificate->>'excessLiabilityCents')::numeric),false));

CREATE OR REPLACE FUNCTION marketplace_contribution_credit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
   'fundingPlanId',j.funding_plan_id,'refundPlanId',j.refund_plan_id,'merchantId',j.merchant_id,'requestHash',COALESCE(j.request#>>'{collection,requestHash}',j.request_hash),'reference',COALESCE(j.request#>>'{collection,reference}',j.request->>'reference'))
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

CREATE OR REPLACE FUNCTION marketplace_contribution_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF c.id IS NOT NULL AND (COALESCE((c.certificate->>'excessLiabilityCents')::bigint,0)>0) IS DISTINCT FROM EXISTS(
   SELECT 1 FROM marketplace_contribution_excess_liabilities l WHERE l.contribution_id=c.id AND l.funding_plan_id=c.funding_plan_id
    AND l.host_merchant_id=c.host_merchant_id AND l.merchant_id=c.merchant_id AND l.certificate_hash=c.certificate_hash
    AND l.amount_cents=(c.certificate->>'excessLiabilityCents')::bigint) THEN RAISE EXCEPTION 'marketplace_contribution_excess_commit_incomplete'; END IF;
 RETURN NEW;
END $$;
