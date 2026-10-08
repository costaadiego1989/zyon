-- Positive host fee: a separately authorised Stripe card receipt for a host's certified
-- positive dispute fee. Historical principal certificates, funding, payouts
-- and holds are never changed by this journal or its append-only credits.
CREATE TABLE marketplace_host_fee_collections (
 id text PRIMARY KEY CHECK(id ~ '^[A-Za-z0-9_-]{1,200}$'),
 fee_certificate_id text NOT NULL REFERENCES marketplace_host_principal_extinctions(id) ON DELETE RESTRICT,
 debt_id text NOT NULL REFERENCES marketplace_host_debts(payout_id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 actor_user_id text NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
 approval_hash text NOT NULL CHECK(approval_hash ~ '^[a-f0-9]{64}$'),
 customer_id text NOT NULL CHECK(customer_id ~ '^cus_[A-Za-z0-9_]+$'),
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 request jsonb NOT NULL, request_hash text NOT NULL UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 customer_proof jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('approved','creating','open','paid','unproven','credited','expired')),
 version integer NOT NULL DEFAULT 0 CHECK(version IN (0,1)),
 session_id text UNIQUE CHECK(session_id ~ '^cs_(test_|live_)?[A-Za-z0-9_]+$'),
 payment_intent_id text UNIQUE CHECK(payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 checkout_url text, observation jsonb,
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 submitted_at timestamptz(3), updated_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(merchant_id,environment,account_fingerprint)
   REFERENCES marketplace_refund_contribution_customers(merchant_id,environment,account_fingerprint) ON DELETE RESTRICT,
 CHECK((status IN ('approved','expired') AND version=0 AND submitted_at IS NULL)
   OR (status<>'approved' AND version=1 AND submitted_at IS NOT NULL)),
 CHECK(status NOT IN ('open','paid','credited','expired') OR (session_id IS NOT NULL AND observation IS NOT NULL)
   OR (status='expired' AND version=0 AND observation->>'reason'='unsubmitted_approval_cancelled')),
 CHECK(status NOT IN ('paid','credited') OR payment_intent_id IS NOT NULL)
);
CREATE UNIQUE INDEX marketplace_host_fee_collection_one_unresolved
 ON marketplace_host_fee_collections(fee_certificate_id) WHERE status NOT IN ('credited','expired');
CREATE INDEX marketplace_host_fee_collection_recovery ON marketplace_host_fee_collections(status,updated_at,id);
CREATE INDEX marketplace_host_fee_collection_host ON marketplace_host_fee_collections(merchant_id,debt_id,id);

CREATE TABLE marketplace_host_fee_credits (
 id text PRIMARY KEY REFERENCES marketplace_host_fee_collections(id) ON DELETE RESTRICT,
 fee_certificate_id text NOT NULL REFERENCES marketplace_host_principal_extinctions(id) ON DELETE RESTRICT,
 merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 credit_sequence integer NOT NULL CHECK(credit_sequence BETWEEN 1 AND 2000),
 provider_payment_intent_id text NOT NULL UNIQUE CHECK(provider_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'),
 provider_charge_id text NOT NULL UNIQUE CHECK(provider_charge_id ~ '^ch_[A-Za-z0-9_]+$'),
 provider_balance_transaction_id text NOT NULL UNIQUE CHECK(provider_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
 credit_cents integer NOT NULL CHECK(credit_cents>0),
 processing_fee_cents integer NOT NULL CHECK(processing_fee_cents>=0),
 excess_liability_cents integer NOT NULL CHECK(excess_liability_cents>=0),
 certificate jsonb NOT NULL, certificate_hash text NOT NULL UNIQUE CHECK(certificate_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(fee_certificate_id,credit_sequence)
);
CREATE INDEX marketplace_host_fee_credit_host ON marketplace_host_fee_credits(merchant_id,funding_plan_id);

CREATE TABLE marketplace_host_fee_excess_liabilities (
 collection_id text PRIMARY KEY REFERENCES marketplace_host_fee_credits(id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 amount_cents integer NOT NULL CHECK(amount_cents>0), status text NOT NULL DEFAULT 'held' CHECK(status='held'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER marketplace_host_fee_excess_immutable BEFORE UPDATE OR DELETE ON marketplace_host_fee_excess_liabilities
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();
CREATE TABLE marketplace_host_dispute_obligations (
 id text PRIMARY KEY CHECK(id ~ '^mhost_obligation_[a-f0-9]{64}$'),
 payout_id text NOT NULL UNIQUE REFERENCES marketplace_host_debts(payout_id) ON DELETE RESTRICT,
 fee_certificate_id text NOT NULL UNIQUE REFERENCES marketplace_host_principal_extinctions(id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 evidence jsonb NOT NULL,evidence_hash text NOT NULL UNIQUE CHECK(evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Historical validation uses the immutable V2 extinction certificate and its
-- closure snapshot. It does not reinterpret an old proof as a fresh provider GET.
CREATE FUNCTION marketplace_host_fee_request_valid(r jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; s RECORD; f RECORD; prefix jsonb; prior_count integer; prior_sum bigint; due bigint; expected jsonb;
BEGIN
 IF jsonb_typeof(r) IS DISTINCT FROM 'object' OR jsonb_typeof(r->'priorCreditHashes') IS DISTINCT FROM 'array'
   OR jsonb_array_length(r->'priorCreditHashes')>2000
   OR COALESCE(r->>'collectionId' ~ '^[A-Za-z0-9_-]{1,200}$',false) IS NOT TRUE
   OR COALESCE(r->>'actorUserId' ~ '^[A-Za-z0-9_-]{1,200}$',false) IS NOT TRUE
   OR COALESCE(r->>'customerId' ~ '^cus_[A-Za-z0-9_]+$',false) IS NOT TRUE
   THEN RETURN false; END IF;
 SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE id=r->>'feeCertificateId';
 IF NOT FOUND OR marketplace_host_principal_extinction_valid(c.payout_id) IS NOT TRUE THEN RETURN false; END IF;
 SELECT * INTO s FROM marketplace_dispute_closure_snapshots WHERE id=c.closure_snapshot_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=c.funding_plan_id;
 IF NOT FOUND OR r->>'debtId' IS DISTINCT FROM c.payout_id OR r->>'merchantId' IS DISTINCT FROM c.host_merchant_id
   OR r->>'hostMerchantId' IS DISTINCT FROM c.host_merchant_id OR r->>'fundingPlanId' IS DISTINCT FROM c.funding_plan_id
   OR r->>'feeCertificateHash' IS DISTINCT FROM c.evidence_hash OR r->'feeEvidence' IS DISTINCT FROM c.evidence
   OR r->'disputeRequest' IS DISTINCT FROM s.request OR c.evidence->'hostDisputeFeeCents' IS DISTINCT FROM
     (SELECT value->'feeCents' FROM jsonb_array_elements(s.fee_allocation) WHERE value->>'sellerMerchantId'=c.host_merchant_id)
   OR (r->>'grossAmountCents')::numeric NOT BETWEEN 50 AND 2147483647
   OR (r->>'grossAmountCents')::numeric IS DISTINCT FROM trunc((r->>'grossAmountCents')::numeric)
   OR (r->>'maximumCreditCents')::numeric NOT BETWEEN 1 AND 2147483647
   OR (r->>'maximumCreditCents')::numeric IS DISTINCT FROM trunc((r->>'maximumCreditCents')::numeric)
   OR (r->>'expiresAt')::numeric NOT BETWEEN 1 AND 2147483647
   OR (r->>'expiresAt')::numeric IS DISTINCT FROM trunc((r->>'expiresAt')::numeric)
   OR to_timestamp((r->>'expiresAt')::double precision)<=(r->>'authorisedAt')::timestamptz
   THEN RETURN false; END IF;
 due:=(c.evidence->>'hostDisputeFeeCents')::bigint; IF due NOT BETWEEN 1 AND 2147483647 THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(to_jsonb(certificate_hash) ORDER BY credit_sequence),'[]'::jsonb),count(*),COALESCE(sum(credit_cents),0)
   INTO prefix,prior_count,prior_sum FROM marketplace_host_fee_credits WHERE fee_certificate_id=c.id AND credit_sequence<=jsonb_array_length(r->'priorCreditHashes');
 IF prior_count<>jsonb_array_length(r->'priorCreditHashes') OR prefix IS DISTINCT FROM r->'priorCreditHashes'
   OR (r->>'maximumCreditCents')::bigint IS DISTINCT FROM due-prior_sum THEN RETURN false; END IF;
 expected:=jsonb_build_object('version',1,'reason','marketplace_host_dispute_fee_collection','provider','stripe','method','card','currency','BRL',
   'environment',f.environment,'accountFingerprint',f.account_fingerprint,'collectionId',r->>'collectionId','debtId',c.payout_id,'feeCertificateId',c.id,
   'feeCertificateHash',c.evidence_hash,'hostMerchantId',c.host_merchant_id,'fundingPlanId',c.funding_plan_id,'merchantId',c.host_merchant_id,
   'actorUserId',r->>'actorUserId','customerId',r->>'customerId','feeEvidence',c.evidence,'disputeRequest',s.request,
   'grossAmountCents',r->'grossAmountCents','maximumCreditCents',to_jsonb(due-prior_sum),'priorCreditHashes',prefix,
   'authorisedAt',r->>'authorisedAt','expiresAt',r->'expiresAt','reference','mhostfeecollect_'||marketplace_contribution_hash(jsonb_build_array(c.id,r->>'collectionId',c.host_merchant_id)));
 RETURN r=expected||jsonb_build_object('requestHash',marketplace_contribution_hash(expected));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION marketplace_host_fee_collection_request_valid(r jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT marketplace_host_fee_request_valid(r)
$$;

CREATE FUNCTION marketplace_host_fee_metadata(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('reason','marketplace_host_dispute_fee_collection','collectionId',r->>'collectionId',
   'feeCertificateId',r->>'feeCertificateId','fundingPlanId',r->>'fundingPlanId','merchantId',r->>'merchantId',
   'requestHash',r->>'requestHash','reference',r->>'reference')
$$;

CREATE FUNCTION marketplace_host_fee_session_valid(r jsonb,o jsonb,state text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s jsonb; customer text; pi text;
BEGIN
 s:=o->'session';
 customer:=CASE WHEN jsonb_typeof(s->'customer')='string' THEN s->>'customer' ELSE s#>>'{customer,id}' END;
 pi:=CASE WHEN jsonb_typeof(s->'payment_intent')='string' THEN s->>'payment_intent' ELSE s#>>'{payment_intent,id}' END;
 IF jsonb_typeof(o) IS DISTINCT FROM 'object' OR jsonb_typeof(s) IS DISTINCT FROM 'object'
   OR o->>'state' IS DISTINCT FROM state OR o->>'requestHash' IS DISTINCT FROM r->>'requestHash'
   OR COALESCE(s->>'id' ~ '^cs_(test_|live_)?[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR o->>'sessionId' IS DISTINCT FROM s->>'id' OR s->>'object' IS DISTINCT FROM 'checkout.session'
   OR s->>'mode' IS DISTINCT FROM 'payment' OR s->'livemode' IS DISTINCT FROM to_jsonb(r->>'environment'='live')
   OR customer IS DISTINCT FROM r->>'customerId' OR s->>'currency' IS DISTINCT FROM 'brl'
   OR s->'amount_total' IS DISTINCT FROM r->'grossAmountCents' OR s->'amount_subtotal' IS DISTINCT FROM r->'grossAmountCents'
   OR s->>'client_reference_id' IS DISTINCT FROM r->>'reference'
   OR s->'metadata' IS DISTINCT FROM marketplace_host_fee_metadata(r)
   OR s->'payment_method_types' IS DISTINCT FROM '["card"]'::jsonb
   OR COALESCE(s->'subscription','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
   OR COALESCE(s->'setup_intent','null'::jsonb) IS DISTINCT FROM 'null'::jsonb
   OR s#>'{total_details,amount_discount}' IS DISTINCT FROM '0'::jsonb
   OR s#>'{total_details,amount_shipping}' IS DISTINCT FROM '0'::jsonb
   OR s#>'{total_details,amount_tax}' IS DISTINCT FROM '0'::jsonb
   OR s->'expires_at' IS DISTINCT FROM r->'expiresAt' OR o->>'observedAt' IS NULL
   THEN RETURN false; END IF;
 IF state='paid' THEN
   RETURN s->>'status'='complete' AND s->>'payment_status'='paid'
     AND COALESCE(pi ~ '^pi_[A-Za-z0-9_]+$',false) AND o->>'paymentIntentId'=pi;
 ELSIF state='expired' THEN
   RETURN s->>'status'='expired' AND s->>'payment_status'='unpaid' AND pi IS NULL
     AND NOT o?'paymentIntentId' AND NOT o?'checkoutUrl';
 ELSIF state='open' THEN
   RETURN s->>'status'='open' AND s->>'payment_status'='unpaid' AND pi IS NULL
     AND NOT o?'paymentIntentId' AND o->>'checkoutUrl'=s->>'url'
     AND COALESCE(s->>'url' ~ '^https://checkout[.]stripe[.]com([/?#]|$)',false);
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Available net is applied only to this host's outstanding dispute fee.
-- Processor fees stay host-owned; any positive excess stays a held liability.
CREATE FUNCTION marketplace_host_fee_credit_evidence_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r jsonb; p jsonb; pi jsonb; ch jsonb; b jsonb; gross bigint; net bigint; fee bigint; maximum bigint; expected jsonb;
BEGIN
 r:=c->'request'; p:=c->'proof'; pi:=p->'paymentIntent'; ch:=p->'charge'; b:=p->'balance';
 IF marketplace_host_fee_request_valid(r) IS NOT TRUE OR jsonb_typeof(p) IS DISTINCT FROM 'object'
   OR jsonb_typeof(pi) IS DISTINCT FROM 'object' OR jsonb_typeof(ch) IS DISTINCT FROM 'object'
   OR jsonb_typeof(b) IS DISTINCT FROM 'object'
   THEN RETURN false; END IF;
 gross:=(r->>'grossAmountCents')::bigint; maximum:=(r->>'maximumCreditCents')::bigint;
 net:=(b->>'netCents')::bigint; fee:=(b->>'feeCents')::bigint;
 IF COALESCE(pi->>'id' ~ '^pi_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(ch->>'id' ~ '^ch_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(b->>'id' ~ '^txn_[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR COALESCE(p->>'sessionId' ~ '^cs_(test_|live_)?[A-Za-z0-9_]+$',false) IS NOT TRUE
   OR p->>'provider' IS DISTINCT FROM 'stripe' OR p->>'requestHash' IS DISTINCT FROM r->>'requestHash'
   OR p->>'accountFingerprint' IS DISTINCT FROM r->>'accountFingerprint'
   OR p->>'observedAt' IS NULL OR (p->>'observedAt')::timestamptz<(r->>'authorisedAt')::timestamptz
   OR pi->>'id' IS NOT DISTINCT FROM r#>>'{disputeRequest,providerPaymentId}'
   OR ch->>'id' IS NOT DISTINCT FROM r#>>'{disputeRequest,sourceId}'
   OR b->>'id' IS NOT DISTINCT FROM r#>>'{disputeRequest,captureBalanceTransactionId}'
   OR pi->>'status' IS DISTINCT FROM 'succeeded' OR pi->'amountCents' IS DISTINCT FROM to_jsonb(gross)
   OR pi->'receivedAmountCents' IS DISTINCT FROM to_jsonb(gross)
   OR pi->>'customerId' IS DISTINCT FROM r->>'customerId' OR pi->>'currency' IS DISTINCT FROM 'BRL'
   OR pi->>'environment' IS DISTINCT FROM r->>'environment' OR pi->>'latestChargeId' IS DISTINCT FROM ch->>'id'
   OR pi->'applicationFeeCents' IS DISTINCT FROM 'null'::jsonb OR pi->'onBehalfOf' IS DISTINCT FROM 'null'::jsonb
   OR pi->'transferDestination' IS DISTINCT FROM 'null'::jsonb OR pi->'metadata' IS DISTINCT FROM marketplace_host_fee_metadata(r)
   OR ch->>'paymentIntentId' IS DISTINCT FROM pi->>'id' OR ch->>'customerId' IS DISTINCT FROM r->>'customerId'
   OR ch->'amountCents' IS DISTINCT FROM to_jsonb(gross) OR ch->>'paymentMethodType' IS DISTINCT FROM 'card'
   OR ch->>'currency' IS DISTINCT FROM 'BRL' OR ch->>'environment' IS DISTINCT FROM r->>'environment'
   OR ch->>'status' IS DISTINCT FROM 'succeeded' OR ch->'paid' IS DISTINCT FROM 'true'::jsonb
   OR ch->'captured' IS DISTINCT FROM 'true'::jsonb OR ch->'disputed' IS DISTINCT FROM 'false'::jsonb
   OR ch->'refundedAmountCents' IS DISTINCT FROM '0'::jsonb OR ch->'refundsComplete' IS DISTINCT FROM 'true'::jsonb
   OR ch->'refundIds' IS DISTINCT FROM '[]'::jsonb OR ch->>'balanceTransactionId' IS DISTINCT FROM b->>'id'
   OR ch->'transferId' IS DISTINCT FROM 'null'::jsonb OR ch->'applicationFeeCents' IS DISTINCT FROM 'null'::jsonb
   OR b->>'sourceId' IS DISTINCT FROM ch->>'id' OR b->>'type' IS DISTINCT FROM 'charge'
   OR b->>'status' IS DISTINCT FROM 'available' OR b->>'currency' IS DISTINCT FROM 'BRL'
   OR b->'amountCents' IS DISTINCT FROM to_jsonb(gross) OR fee NOT BETWEEN 0 AND 2147483647
   OR net NOT BETWEEN 1 AND 2147483647 OR gross-fee IS DISTINCT FROM net
   OR b->'netCents' IS DISTINCT FROM to_jsonb(net) OR b->'feeCents' IS DISTINCT FROM to_jsonb(fee)
   THEN RETURN false; END IF;
 expected:=jsonb_build_object('version',1,'reason','marketplace_host_dispute_fee_credit','request',r,'proof',p,
   'creditCents',LEAST(net,maximum),'processingFeeCents',fee,'excessLiabilityCents',GREATEST(0,net-maximum));
 RETURN c=expected||jsonb_build_object('certificateHash',marketplace_contribution_hash(expected));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- All purposes acquire the same incoming native PI lock before examining the
-- other journals. Legacy checkout -> contribution journal -> credit stays valid.
-- Every incoming family acquires the same PI/charge/balance locks before
-- checking other purposes. Native receipt IDs are never accepted twice.
CREATE FUNCTION marketplace_host_fee_incoming_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_body jsonb; pi text; charge_id text; balance_id text; native_session text; own_host boolean;
BEGIN
 row_body:=to_jsonb(NEW);own_host:=TG_TABLE_NAME IN ('marketplace_host_fee_collections','marketplace_host_fee_credits');
 pi:=CASE WHEN TG_TABLE_NAME IN ('marketplace_host_fee_collections','marketplace_seller_fee_collections','marketplace_contribution_checkouts') THEN row_body->>'payment_intent_id'
   WHEN TG_TABLE_NAME IN ('payment_intents','marketplace_funding_plans') THEN row_body->>'provider_payment_id' ELSE row_body->>'provider_payment_intent_id' END;
 charge_id:=CASE WHEN TG_TABLE_NAME='marketplace_funding_plans' THEN row_body#>>'{budget,capture,sourceId}' ELSE row_body->>'provider_charge_id' END;
 balance_id:=CASE WHEN TG_TABLE_NAME='marketplace_funding_plans' THEN row_body#>>'{budget,capture,balanceTransactionId}' ELSE row_body->>'provider_balance_transaction_id' END;
 native_session:=row_body->>'session_id';
 IF pi ~ '^pi_[A-Za-z0-9_]+$' THEN PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-incoming-stripe-payment',pi)),0)); END IF;
 IF charge_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-incoming-stripe-charge',charge_id)),0)); END IF;
 IF balance_id IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-incoming-stripe-balance',balance_id)),0)); END IF;
 IF native_session IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-incoming-stripe-session',native_session)),0)); END IF;
 IF own_host THEN
   IF EXISTS(SELECT 1 FROM marketplace_seller_fee_collections WHERE payment_intent_id=pi OR session_id=native_session)
     OR EXISTS(SELECT 1 FROM marketplace_seller_fee_credits WHERE provider_payment_intent_id=pi OR provider_charge_id=charge_id OR provider_balance_transaction_id=balance_id)
     OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE provider_payment_intent_id=pi)
     OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits WHERE provider_payment_intent_id=pi OR provider_charge_id=charge_id OR provider_balance_transaction_id=balance_id)
     OR EXISTS(SELECT 1 FROM marketplace_contribution_checkouts WHERE payment_intent_id=pi OR session_id=native_session)
     OR EXISTS(SELECT 1 FROM payment_intents WHERE provider_payment_id=pi)
     OR EXISTS(SELECT 1 FROM marketplace_funding_plans WHERE provider='stripe' AND (provider_payment_id=pi OR budget#>>'{capture,sourceId}'=charge_id OR budget#>>'{capture,balanceTransactionId}'=balance_id))
     OR EXISTS(SELECT 1 FROM marketplace_dispute_ledger_entries WHERE provider_balance_transaction_id=balance_id)
     OR EXISTS(SELECT 1 FROM marketplace_host_fee_collections j WHERE j.id<>NEW.id AND (j.payment_intent_id=pi OR j.session_id=native_session))
     OR EXISTS(SELECT 1 FROM marketplace_host_fee_credits c WHERE c.id<>NEW.id AND (c.provider_payment_intent_id=pi OR c.provider_charge_id=charge_id OR c.provider_balance_transaction_id=balance_id))
     THEN RAISE EXCEPTION 'marketplace_host_fee_incoming_receipt_reused'; END IF;
 ELSE
   IF EXISTS(SELECT 1 FROM marketplace_host_fee_collections j WHERE j.payment_intent_id=pi OR j.session_id=native_session)
     OR EXISTS(SELECT 1 FROM marketplace_host_fee_credits c WHERE c.provider_payment_intent_id=pi OR c.provider_charge_id=charge_id OR c.provider_balance_transaction_id=balance_id)
     THEN RAISE EXCEPTION 'marketplace_host_fee_incoming_receipt_reused'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_host_fee_collection_00_incoming BEFORE INSERT OR UPDATE OF payment_intent_id,session_id ON marketplace_host_fee_collections FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_credit_00_incoming BEFORE INSERT ON marketplace_host_fee_credits FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_seller_collection_incoming BEFORE INSERT OR UPDATE OF payment_intent_id,session_id ON marketplace_seller_fee_collections FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_seller_credit_incoming BEFORE INSERT ON marketplace_seller_fee_credits FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_contribution_journal_incoming BEFORE INSERT OR UPDATE OF provider_payment_intent_id ON marketplace_refund_contribution_journals FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_contribution_credit_incoming BEFORE INSERT ON marketplace_refund_contribution_credits FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_contribution_checkout_incoming BEFORE INSERT OR UPDATE OF payment_intent_id,session_id ON marketplace_contribution_checkouts FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_payment_intent_incoming BEFORE INSERT OR UPDATE OF provider_payment_id ON payment_intents FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_funding_capture_incoming BEFORE INSERT OR UPDATE OF provider_payment_id,budget ON marketplace_funding_plans FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();
CREATE TRIGGER marketplace_host_fee_dispute_ledger_incoming BEFORE INSERT ON marketplace_dispute_ledger_entries FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_incoming_guard();

CREATE FUNCTION marketplace_host_fee_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; expected_approval jsonb; credit_count integer; observation_state text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_host_fee_collection_immutable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(
   jsonb_build_array('marketplace-host-dispute-fee',NEW.fee_certificate_id)),0));
 IF TG_OP='UPDATE' THEN
   IF OLD.status IN ('credited','expired') THEN
     IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_host_fee_collection_terminal'; END IF;
     RETURN NEW;
   END IF;
   IF (to_jsonb(NEW)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at'])
     OR OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id
     OR OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
     OR OLD.status='paid' AND NEW.status NOT IN ('paid','credited')
     OR NEW.status='approved'
     THEN RAISE EXCEPTION 'marketplace_host_fee_collection_changed'; END IF;
   IF OLD.status='approved' THEN
     IF NEW.status='expired' THEN
       IF NEW.version<>0 OR NEW.submitted_at IS NOT NULL OR NEW.session_id IS NOT NULL OR NEW.payment_intent_id IS NOT NULL
         OR NEW.checkout_url IS NOT NULL OR NEW.observation IS DISTINCT FROM
           jsonb_build_object('reason','unsubmitted_approval_cancelled','requestHash',NEW.request_hash)
         THEN RAISE EXCEPTION 'marketplace_host_fee_cancellation_unproven'; END IF;
       RETURN NEW;
     END IF;
     IF NEW.status IS DISTINCT FROM 'creating' OR NEW.version<>1 OR NEW.submitted_at IS NULL
       OR NEW.session_id IS NOT NULL OR NEW.payment_intent_id IS NOT NULL OR NEW.checkout_url IS NOT NULL OR NEW.observation IS NOT NULL
       OR NEW.submitted_at NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
       OR to_timestamp((NEW.request->>'expiresAt')::double precision)<clock_timestamp()+interval '1801 seconds'
       OR marketplace_host_fee_request_valid(NEW.request) IS NOT TRUE
       OR NOT EXISTS(SELECT 1 FROM merchant_users WHERE id=NEW.actor_user_id AND merchant_id=NEW.merchant_id
         AND role IN ('owner','admin') AND disabled_at IS NULL)
       THEN RAISE EXCEPTION 'marketplace_host_fee_claim_unproven'; END IF;
     SELECT count(*) INTO credit_count FROM marketplace_host_fee_credits WHERE fee_certificate_id=NEW.fee_certificate_id;
     IF credit_count<>jsonb_array_length(NEW.request->'priorCreditHashes') THEN
       RAISE EXCEPTION 'marketplace_host_fee_obligation_changed'; END IF;
   ELSE
     IF NEW.version<>1 OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.status NOT IN ('open','paid','unproven','credited','expired')
       THEN RAISE EXCEPTION 'marketplace_host_fee_submission_consumed'; END IF;
     IF NEW.status IN ('open','paid','expired') THEN
       IF marketplace_host_fee_session_valid(NEW.request,NEW.observation,NEW.status) IS NOT TRUE
         OR NEW.session_id IS DISTINCT FROM NEW.observation->>'sessionId'
         OR NEW.payment_intent_id IS DISTINCT FROM NEW.observation->>'paymentIntentId'
         OR NEW.checkout_url IS DISTINCT FROM NEW.observation->>'checkoutUrl'
         -- GET recovery may rotate a paid journal in the work queue while
         -- retaining its exact historical receipt. Only updated_at may change;
         -- replacing any receipt/status field still requires a fresh observation.
         OR NOT (OLD.status='paid' AND NEW.status='paid'
           AND (to_jsonb(NEW)-'updated_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'updated_at'))
           AND (NEW.observation->>'observedAt')::timestamptz NOT BETWEEN
             clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
         OR (NEW.observation->>'observedAt')::timestamptz<(NEW.request->>'authorisedAt')::timestamptz
         THEN RAISE EXCEPTION 'marketplace_host_fee_session_unproven'; END IF;
     ELSIF NEW.status='unproven' AND
       (NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
         OR NEW.checkout_url IS DISTINCT FROM OLD.checkout_url OR NEW.observation IS DISTINCT FROM OLD.observation) THEN
       RAISE EXCEPTION 'marketplace_host_fee_unknown_receipt_changed';
     ELSIF NEW.status='credited' AND
       (OLD.status IS DISTINCT FROM 'paid' OR NEW.observation IS DISTINCT FROM OLD.observation
         OR NEW.checkout_url IS DISTINCT FROM OLD.checkout_url) THEN
       RAISE EXCEPTION 'marketplace_host_fee_paid_receipt_required';
     END IF;
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE id=NEW.fee_certificate_id;
 expected_approval:=jsonb_build_object('actor',jsonb_build_object('merchantId',NEW.merchant_id,'userId',NEW.actor_user_id),
   'input',jsonb_build_object('debtId',NEW.debt_id,'collectionId',NEW.id,'customerId',NEW.customer_id,
     'grossAmountCents',NEW.request->'grossAmountCents','confirmed',true));
 SELECT count(*) INTO credit_count FROM marketplace_host_fee_credits WHERE fee_certificate_id=NEW.fee_certificate_id;
 IF c.id IS NULL OR marketplace_host_fee_request_valid(NEW.request) IS NOT TRUE
   OR NEW.id IS DISTINCT FROM NEW.request->>'collectionId' OR NEW.fee_certificate_id IS DISTINCT FROM NEW.request->>'feeCertificateId'
   OR NEW.debt_id IS DISTINCT FROM NEW.request->>'debtId' OR NEW.funding_plan_id IS DISTINCT FROM NEW.request->>'fundingPlanId'
   OR NEW.host_merchant_id IS DISTINCT FROM NEW.request->>'hostMerchantId' OR NEW.merchant_id IS DISTINCT FROM NEW.request->>'merchantId'
   OR NEW.actor_user_id IS DISTINCT FROM NEW.request->>'actorUserId' OR NEW.customer_id IS DISTINCT FROM NEW.request->>'customerId'
   OR NEW.environment IS DISTINCT FROM NEW.request->>'environment' OR NEW.account_fingerprint IS DISTINCT FROM NEW.request->>'accountFingerprint'
   OR NEW.request_hash IS DISTINCT FROM NEW.request->>'requestHash' OR NEW.approval_hash IS DISTINCT FROM marketplace_contribution_hash(expected_approval)
   OR NEW.status IS DISTINCT FROM 'approved' OR NEW.version<>0 OR NEW.submitted_at IS NOT NULL
   OR NEW.session_id IS NOT NULL OR NEW.payment_intent_id IS NOT NULL OR NEW.checkout_url IS NOT NULL OR NEW.observation IS NOT NULL
   OR credit_count<>jsonb_array_length(NEW.request->'priorCreditHashes')
   OR NOT EXISTS(SELECT 1 FROM merchant_users WHERE id=NEW.actor_user_id AND merchant_id=NEW.merchant_id
     AND role IN ('owner','admin') AND disabled_at IS NULL)
   OR NOT EXISTS(SELECT 1 FROM marketplace_refund_contribution_customers WHERE merchant_id=NEW.merchant_id
     AND environment=NEW.environment AND account_fingerprint=NEW.account_fingerprint AND customer_id=NEW.customer_id)
   OR NEW.customer_proof->>'merchantId' IS DISTINCT FROM NEW.merchant_id OR NEW.customer_proof->>'customerId' IS DISTINCT FROM NEW.customer_id
   OR NEW.customer_proof->>'environment' IS DISTINCT FROM NEW.environment
   OR NEW.customer_proof->>'accountFingerprint' IS DISTINCT FROM NEW.account_fingerprint
   OR NEW.customer_proof->>'observedAt' IS NULL
   OR (NEW.customer_proof->>'observedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR (NEW.request->>'authorisedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR to_timestamp((NEW.request->>'expiresAt')::double precision)>clock_timestamp()+interval '86400 seconds'
   THEN RAISE EXCEPTION 'marketplace_host_fee_approval_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_host_fee_collection_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_host_fee_collections
 FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_collection_guard();

CREATE FUNCTION marketplace_host_fee_credit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j RECORD; prior_count integer;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(
   jsonb_build_array('marketplace-host-dispute-fee',NEW.fee_certificate_id)),0));
 SELECT * INTO j FROM marketplace_host_fee_collections WHERE id=NEW.id FOR UPDATE;
 SELECT count(*) INTO prior_count FROM marketplace_host_fee_credits WHERE fee_certificate_id=NEW.fee_certificate_id;
 IF j.id IS NULL OR j.status IS DISTINCT FROM 'paid' OR j.version<>1 OR j.submitted_at IS NULL
   OR marketplace_host_fee_credit_evidence_valid(NEW.certificate) IS NOT TRUE
   OR NEW.fee_certificate_id IS DISTINCT FROM j.fee_certificate_id OR NEW.merchant_id IS DISTINCT FROM j.merchant_id
   OR NEW.funding_plan_id IS DISTINCT FROM j.funding_plan_id OR NEW.host_merchant_id IS DISTINCT FROM j.host_merchant_id
   OR NEW.environment IS DISTINCT FROM j.environment OR NEW.account_fingerprint IS DISTINCT FROM j.account_fingerprint
   OR NEW.request_hash IS DISTINCT FROM j.request_hash OR NEW.certificate->'request' IS DISTINCT FROM j.request
   OR NEW.credit_sequence<>prior_count+1 OR prior_count<>jsonb_array_length(j.request->'priorCreditHashes')
   OR NEW.provider_payment_intent_id IS DISTINCT FROM j.payment_intent_id
   OR NEW.provider_payment_intent_id IS DISTINCT FROM NEW.certificate#>>'{proof,paymentIntent,id}'
   OR NEW.provider_charge_id IS DISTINCT FROM NEW.certificate#>>'{proof,charge,id}'
   OR NEW.provider_balance_transaction_id IS DISTINCT FROM NEW.certificate#>>'{proof,balance,id}'
   OR j.session_id IS DISTINCT FROM NEW.certificate#>>'{proof,sessionId}'
   OR NEW.credit_cents IS DISTINCT FROM (NEW.certificate->>'creditCents')::integer
   OR NEW.processing_fee_cents IS DISTINCT FROM (NEW.certificate->>'processingFeeCents')::integer
   OR NEW.excess_liability_cents IS DISTINCT FROM (NEW.certificate->>'excessLiabilityCents')::integer
   OR NEW.certificate_hash IS DISTINCT FROM NEW.certificate->>'certificateHash'
   OR (NEW.certificate#>>'{proof,observedAt}')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR EXISTS(SELECT 1 FROM marketplace_funding_plans WHERE provider='stripe' AND
     (provider_payment_id=NEW.provider_payment_intent_id OR budget#>>'{capture,sourceId}'=NEW.provider_charge_id
       OR budget#>>'{capture,balanceTransactionId}'=NEW.provider_balance_transaction_id))
   THEN RAISE EXCEPTION 'marketplace_host_fee_credit_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_host_fee_credit_guard BEFORE INSERT ON marketplace_host_fee_credits
 FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_credit_guard();
CREATE TRIGGER marketplace_host_fee_credit_immutable BEFORE UPDATE OR DELETE ON marketplace_host_fee_credits
 FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();

CREATE FUNCTION marketplace_host_fee_credit_valid(collection_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE j RECORD; c RECORD; event_payload jsonb;
BEGIN
 SELECT * INTO j FROM marketplace_host_fee_collections WHERE id=collection_id;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT * INTO c FROM marketplace_host_fee_credits WHERE id=collection_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF j.status IS DISTINCT FROM 'credited' OR j.version<>1 OR j.submitted_at IS NULL
   OR marketplace_host_fee_credit_evidence_valid(c.certificate) IS NOT TRUE
   OR c.certificate->'request' IS DISTINCT FROM j.request OR c.request_hash IS DISTINCT FROM j.request_hash
   OR c.fee_certificate_id IS DISTINCT FROM j.fee_certificate_id OR c.merchant_id IS DISTINCT FROM j.merchant_id
   OR c.funding_plan_id IS DISTINCT FROM j.funding_plan_id OR c.host_merchant_id IS DISTINCT FROM j.host_merchant_id
   OR c.environment IS DISTINCT FROM j.environment OR c.account_fingerprint IS DISTINCT FROM j.account_fingerprint
   OR c.credit_sequence<>jsonb_array_length(j.request->'priorCreditHashes')+1
   OR c.provider_payment_intent_id IS DISTINCT FROM j.payment_intent_id
   OR c.provider_payment_intent_id IS DISTINCT FROM c.certificate#>>'{proof,paymentIntent,id}'
   OR c.provider_charge_id IS DISTINCT FROM c.certificate#>>'{proof,charge,id}'
   OR c.provider_balance_transaction_id IS DISTINCT FROM c.certificate#>>'{proof,balance,id}'
   OR j.session_id IS DISTINCT FROM c.certificate#>>'{proof,sessionId}'
   OR c.credit_cents IS DISTINCT FROM (c.certificate->>'creditCents')::integer
   OR c.processing_fee_cents IS DISTINCT FROM (c.certificate->>'processingFeeCents')::integer
   OR c.excess_liability_cents IS DISTINCT FROM (c.certificate->>'excessLiabilityCents')::integer
   OR c.certificate_hash IS DISTINCT FROM c.certificate->>'certificateHash'
   OR marketplace_host_fee_session_valid(j.request,j.observation,'paid') IS NOT TRUE
   OR j.observation->>'sessionId' IS DISTINCT FROM j.session_id
   OR j.observation->>'paymentIntentId' IS DISTINCT FROM j.payment_intent_id
   THEN RETURN false; END IF;
 IF c.excess_liability_cents>0 AND NOT EXISTS(SELECT 1 FROM marketplace_host_fee_excess_liabilities liability
     WHERE liability.collection_id=c.id AND liability.host_merchant_id=c.host_merchant_id AND liability.amount_cents=c.excess_liability_cents AND liability.status='held')
   OR c.excess_liability_cents=0 AND EXISTS(SELECT 1 FROM marketplace_host_fee_excess_liabilities liability WHERE liability.collection_id=c.id)
   THEN RETURN false; END IF;
 event_payload:=jsonb_build_object('collection_id',j.id,'debt_id',j.debt_id,'fee_certificate_id',j.fee_certificate_id,
   'funding_plan_id',j.funding_plan_id,'host_merchant_id',j.merchant_id,'request_hash',j.request_hash,
   'credit_cents',c.credit_cents,'processing_fee_cents',c.processing_fee_cents,
   'excess_liability_cents',c.excess_liability_cents,'certificate_hash',c.certificate_hash);
 RETURN EXISTS(SELECT 1 FROM outbox_messages
   WHERE event_id='mhostfee_collection_credited_'||marketplace_contribution_hash(jsonb_build_array(j.id,j.request_hash))
     AND event_type='marketplace.host_fee_collection_credited' AND merchant_id=j.merchant_id
     AND correlation_id=j.funding_plan_id AND causation_id=j.debt_id AND producer='marketplace'
     AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_host_fee_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE collection_id text; j RECORD; credit_exists boolean;
BEGIN
 IF TG_TABLE_NAME='outbox_messages' THEN
   -- Preserve only this journal's financial event. Dispatcher leases, attempts,
   -- publication and delivery status are not part of the immutable receipt.
   SELECT id INTO collection_id FROM marketplace_host_fee_collections
     WHERE 'mhostfee_collection_credited_'||marketplace_contribution_hash(jsonb_build_array(id,request_hash))=
       CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.event_id ELSE NEW.event_id END;
   IF collection_id IS NULL AND TG_OP='UPDATE' THEN
     SELECT id INTO collection_id FROM marketplace_host_fee_collections
       WHERE 'mhostfee_collection_credited_'||marketplace_contribution_hash(jsonb_build_array(id,request_hash))=NEW.event_id;
   END IF;
   IF collection_id IS NULL THEN
     IF TG_OP<>'DELETE' AND NEW.event_type='marketplace.host_fee_collection_credited' THEN RAISE EXCEPTION 'marketplace_host_fee_credit_commit_incomplete'; END IF;
     RETURN NULL;
   END IF;
   IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
     IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
     THEN RAISE EXCEPTION 'marketplace_host_fee_credit_outbox_immutable'; END IF;
 ELSE collection_id:=NEW.id;
 END IF;
 SELECT * INTO j FROM marketplace_host_fee_collections WHERE id=collection_id;
 SELECT EXISTS(SELECT 1 FROM marketplace_host_fee_credits WHERE id=collection_id) INTO credit_exists;
 IF (j.status='credited') IS DISTINCT FROM credit_exists
   OR TG_TABLE_NAME='outbox_messages' AND NOT credit_exists
   OR credit_exists AND marketplace_host_fee_credit_valid(collection_id) IS NOT TRUE
   THEN RAISE EXCEPTION 'marketplace_host_fee_credit_commit_incomplete'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_host_fee_collection_commit AFTER INSERT OR UPDATE ON marketplace_host_fee_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_host_fee_credit_commit AFTER INSERT ON marketplace_host_fee_credits
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_host_fee_outbox_commit AFTER INSERT OR UPDATE OR DELETE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_commit_guard();

CREATE FUNCTION marketplace_host_fee_excess_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM marketplace_host_fee_credits WHERE id=NEW.collection_id
   AND host_merchant_id=NEW.host_merchant_id AND excess_liability_cents=NEW.amount_cents)
   OR marketplace_host_fee_credit_valid(NEW.collection_id) IS NOT TRUE
   THEN RAISE EXCEPTION 'marketplace_host_fee_excess_unproven'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_host_fee_excess_commit AFTER INSERT ON marketplace_host_fee_excess_liabilities
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_fee_excess_commit_guard();

CREATE FUNCTION marketplace_host_dispute_obligation_evidence(target_payout text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE c RECORD; credit RECORD; hashes jsonb:='[]'::jsonb; collected bigint:=0; processing bigint:=0; n integer:=0; due bigint;
BEGIN
 SELECT * INTO c FROM marketplace_host_principal_extinctions WHERE payout_id=target_payout;
 IF NOT FOUND OR marketplace_host_principal_extinction_valid(target_payout) IS NOT TRUE THEN RETURN NULL; END IF;
 due:=(c.evidence->>'hostDisputeFeeCents')::bigint;
 IF due NOT BETWEEN 1 AND 2147483647 OR EXISTS(SELECT 1 FROM marketplace_host_fee_collections
   WHERE fee_certificate_id=c.id AND status NOT IN ('credited','expired'))
   THEN RETURN NULL; END IF;
 FOR credit IN SELECT * FROM marketplace_host_fee_credits WHERE fee_certificate_id=c.id ORDER BY credit_sequence LOOP
   n:=n+1;
   IF n>2000 OR credit.credit_sequence<>n OR marketplace_host_fee_credit_valid(credit.id) IS NOT TRUE
     OR credit.merchant_id IS DISTINCT FROM c.host_merchant_id OR credit.host_merchant_id IS DISTINCT FROM c.host_merchant_id
     OR credit.funding_plan_id IS DISTINCT FROM c.funding_plan_id OR credit.environment IS DISTINCT FROM c.evidence->>'environment'
     OR credit.account_fingerprint IS DISTINCT FROM c.evidence->>'accountFingerprint' OR credit.excess_liability_cents<>0
     THEN RETURN NULL; END IF;
   collected:=collected+credit.credit_cents;processing:=processing+credit.processing_fee_cents;
   hashes:=hashes||jsonb_build_array(credit.certificate_hash);
 END LOOP;
 IF n=0 OR collected<>due OR processing NOT BETWEEN 0 AND 2147483647 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'reason','stripe_host_dispute_obligation_closed','debtId',c.payout_id,'payoutId',c.payout_id,
   'feeCertificateId',c.id,'feeCertificateHash',c.evidence_hash,'hostMerchantId',c.host_merchant_id,'fundingPlanId',c.funding_plan_id,
   'providerDisputeId',c.provider_dispute_id,'closureSnapshotId',c.closure_snapshot_id,'provider','stripe','environment',c.evidence->'environment',
   'accountFingerprint',c.evidence->'accountFingerprint','principalAmountCents',c.amount_cents,'disputeFeeCents',due,
   'collectedFeeCents',collected,'processingFeeCents',processing,'excessLiabilityCents',0,'creditHashes',hashes,'fundingHoldReleased',false,'payoutReauthorized',false);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;
CREATE FUNCTION marketplace_host_dispute_obligation_valid(target_payout text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o RECORD; expected jsonb; event_payload jsonb;
BEGIN
 SELECT * INTO o FROM marketplace_host_dispute_obligations WHERE payout_id=target_payout;IF NOT FOUND THEN RETURN false;END IF;
 expected:=marketplace_host_dispute_obligation_evidence(target_payout);
 IF expected IS NULL OR o.evidence IS DISTINCT FROM expected OR o.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR o.id IS DISTINCT FROM 'mhost_obligation_'||marketplace_contribution_hash(jsonb_build_array(o.host_merchant_id,o.funding_plan_id,o.payout_id))
   OR o.fee_certificate_id IS DISTINCT FROM expected->>'feeCertificateId' OR o.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId'
   OR o.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId' THEN RETURN false;END IF;
 event_payload:=jsonb_build_object('obligation_id',o.id,'debt_id',o.payout_id,'payout_id',o.payout_id,'fee_certificate_id',o.fee_certificate_id,
   'funding_plan_id',o.funding_plan_id,'host_merchant_id',o.host_merchant_id,'evidence_hash',o.evidence_hash,
   'principal_amount_cents',expected->'principalAmountCents','dispute_fee_cents',expected->'disputeFeeCents',
   'collected_fee_cents',expected->'collectedFeeCents','processing_fee_cents',expected->'processingFeeCents',
   'excess_liability_cents',0,'funding_hold_released',false,'payout_reauthorized',false);
 RETURN EXISTS(SELECT 1 FROM outbox_messages financial_event WHERE financial_event.event_id=o.id AND financial_event.event_type='marketplace.host_dispute_obligation_closed'
   AND financial_event.merchant_id=o.host_merchant_id AND financial_event.correlation_id=o.funding_plan_id AND financial_event.causation_id=o.payout_id
   AND financial_event.producer='marketplace' AND financial_event.schema_version=1 AND financial_event.payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION marketplace_host_dispute_obligation_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-host-dispute-fee',NEW.fee_certificate_id)),0));
 expected:=marketplace_host_dispute_obligation_evidence(NEW.payout_id);
 IF expected IS NULL OR NEW.evidence IS DISTINCT FROM expected OR NEW.evidence_hash IS DISTINCT FROM marketplace_contribution_hash(expected)
   OR NEW.id IS DISTINCT FROM 'mhost_obligation_'||marketplace_contribution_hash(jsonb_build_array(NEW.host_merchant_id,NEW.funding_plan_id,NEW.payout_id))
   OR NEW.payout_id IS DISTINCT FROM expected->>'payoutId' OR NEW.fee_certificate_id IS DISTINCT FROM expected->>'feeCertificateId'
   OR NEW.host_merchant_id IS DISTINCT FROM expected->>'hostMerchantId' OR NEW.funding_plan_id IS DISTINCT FROM expected->>'fundingPlanId'
   THEN RAISE EXCEPTION 'marketplace_host_dispute_obligation_unproven';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_host_dispute_obligation_insert BEFORE INSERT ON marketplace_host_dispute_obligations FOR EACH ROW EXECUTE FUNCTION marketplace_host_dispute_obligation_insert_guard();
CREATE TRIGGER marketplace_host_dispute_obligation_immutable BEFORE UPDATE OR DELETE ON marketplace_host_dispute_obligations FOR EACH ROW EXECUTE FUNCTION marketplace_contribution_immutable();
CREATE FUNCTION marketplace_host_dispute_obligation_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target text; oid text;
BEGIN
 IF TG_TABLE_NAME='outbox_messages' THEN
   SELECT id,payout_id INTO oid,target FROM marketplace_host_dispute_obligations WHERE id=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.event_id ELSE NEW.event_id END;
   IF oid IS NULL AND TG_OP='UPDATE' THEN SELECT id,payout_id INTO oid,target FROM marketplace_host_dispute_obligations WHERE id=NEW.event_id; END IF;
   IF oid IS NOT NULL AND TG_OP='UPDATE' AND
     (to_jsonb(NEW)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
     THEN RAISE EXCEPTION 'marketplace_host_dispute_obligation_outbox_immutable';END IF;
   IF oid IS NULL THEN
     IF TG_OP='DELETE' OR NEW.event_type IS DISTINCT FROM 'marketplace.host_dispute_obligation_closed' THEN RETURN NULL; END IF;
     RAISE EXCEPTION 'marketplace_host_dispute_obligation_commit_incomplete';
   END IF;
 ELSE target:=NEW.payout_id;
 END IF;
 IF marketplace_host_dispute_obligation_valid(target) IS NOT TRUE THEN RAISE EXCEPTION 'marketplace_host_dispute_obligation_commit_incomplete';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_host_dispute_obligation_commit AFTER INSERT ON marketplace_host_dispute_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_dispute_obligation_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_host_dispute_obligation_outbox_commit AFTER INSERT OR UPDATE OR DELETE ON outbox_messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_host_dispute_obligation_commit_guard();

-- V1 canonical reconstruction remains byte-for-byte unchanged. The original
-- immutable tables, observation guard and causal commit trigger are reused.
CREATE FUNCTION marketplace_order_dispute_closure_v1_evidence(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
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

CREATE OR REPLACE FUNCTION marketplace_order_dispute_closure_evidence(target_funding text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
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

CREATE OR REPLACE FUNCTION marketplace_order_dispute_closure_valid(target_funding text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
