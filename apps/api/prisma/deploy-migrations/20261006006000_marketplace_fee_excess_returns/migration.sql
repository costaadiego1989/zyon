-- F01/F02: single-use excess return inside the existing collection journals.
-- Original requests, incoming credits, fees, principal and funding remain immutable.
-- Existing migrations are unchanged; no new table or synthetic money is introduced.

ALTER TABLE marketplace_seller_fee_collections
 ADD COLUMN excess_return_status text NOT NULL DEFAULT 'held' CHECK(excess_return_status IN ('held','unknown','pending','returned','failed')),
 ADD COLUMN excess_return_request jsonb,
 ADD COLUMN excess_return_request_hash text UNIQUE CHECK(excess_return_request_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN excess_return_submitted_at timestamptz(3),
 ADD COLUMN excess_return_observation jsonb,
 ADD COLUMN excess_return_certificate jsonb,
 ADD COLUMN excess_return_certificate_hash text UNIQUE CHECK(excess_return_certificate_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN excess_return_provider_refund_id text UNIQUE CHECK(excess_return_provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),
 ADD COLUMN excess_return_balance_transaction_id text UNIQUE CHECK(excess_return_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
 ADD COLUMN returned_excess_cents integer NOT NULL DEFAULT 0 CHECK(returned_excess_cents>=0),
 ADD COLUMN excess_returned_at timestamptz(3),
 ADD CONSTRAINT marketplace_seller_fee_excess_claim_shape CHECK(
  (excess_return_status='held' AND excess_return_request IS NULL AND excess_return_request_hash IS NULL AND excess_return_submitted_at IS NULL
   AND excess_return_provider_refund_id IS NULL AND excess_return_observation IS NULL)
  OR (status='credited' AND excess_return_status<>'held' AND excess_return_request IS NOT NULL AND excess_return_request_hash IS NOT NULL AND excess_return_submitted_at IS NOT NULL)),
 ADD CONSTRAINT marketplace_seller_fee_excess_receipt_shape CHECK(
  (excess_return_status='returned' AND returned_excess_cents>0 AND excess_return_certificate IS NOT NULL AND excess_return_certificate_hash IS NOT NULL
   AND excess_return_provider_refund_id IS NOT NULL AND excess_return_balance_transaction_id IS NOT NULL AND excess_returned_at IS NOT NULL)
  OR (excess_return_status<>'returned' AND returned_excess_cents=0 AND excess_return_certificate IS NULL AND excess_return_certificate_hash IS NULL
   AND excess_return_balance_transaction_id IS NULL AND excess_returned_at IS NULL));
CREATE INDEX marketplace_seller_fee_excess_recovery ON marketplace_seller_fee_collections(excess_return_status,updated_at,id)
 WHERE status='credited' AND excess_return_status IN ('unknown','pending');

ALTER TABLE marketplace_host_fee_collections
 ADD COLUMN excess_return_status text NOT NULL DEFAULT 'held' CHECK(excess_return_status IN ('held','unknown','pending','returned','failed')),
 ADD COLUMN excess_return_request jsonb,
 ADD COLUMN excess_return_request_hash text UNIQUE CHECK(excess_return_request_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN excess_return_submitted_at timestamptz(3),
 ADD COLUMN excess_return_observation jsonb,
 ADD COLUMN excess_return_certificate jsonb,
 ADD COLUMN excess_return_certificate_hash text UNIQUE CHECK(excess_return_certificate_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN excess_return_provider_refund_id text UNIQUE CHECK(excess_return_provider_refund_id ~ '^re_[A-Za-z0-9_]+$'),
 ADD COLUMN excess_return_balance_transaction_id text UNIQUE CHECK(excess_return_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
 ADD COLUMN returned_excess_cents integer NOT NULL DEFAULT 0 CHECK(returned_excess_cents>=0),
 ADD COLUMN excess_returned_at timestamptz(3),
 ADD CONSTRAINT marketplace_host_fee_excess_claim_shape CHECK(
  (excess_return_status='held' AND excess_return_request IS NULL AND excess_return_request_hash IS NULL AND excess_return_submitted_at IS NULL
   AND excess_return_provider_refund_id IS NULL AND excess_return_observation IS NULL)
  OR (status='credited' AND excess_return_status<>'held' AND excess_return_request IS NOT NULL AND excess_return_request_hash IS NOT NULL AND excess_return_submitted_at IS NOT NULL)),
 ADD CONSTRAINT marketplace_host_fee_excess_receipt_shape CHECK(
  (excess_return_status='returned' AND returned_excess_cents>0 AND excess_return_certificate IS NOT NULL AND excess_return_certificate_hash IS NOT NULL
   AND excess_return_provider_refund_id IS NOT NULL AND excess_return_balance_transaction_id IS NOT NULL AND excess_returned_at IS NOT NULL)
  OR (excess_return_status<>'returned' AND returned_excess_cents=0 AND excess_return_certificate IS NULL AND excess_return_certificate_hash IS NULL
   AND excess_return_balance_transaction_id IS NULL AND excess_returned_at IS NULL));
CREATE INDEX marketplace_host_fee_excess_recovery ON marketplace_host_fee_collections(excess_return_status,updated_at,id)
 WHERE status='credited' AND excess_return_status IN ('unknown','pending');

CREATE FUNCTION marketplace_fee_excess_request_valid(r jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE c jsonb; collection_id text; raw jsonb; bound jsonb; valid boolean;
BEGIN
 c:=r->'credit';collection_id:=c#>>'{request,collectionId}';
 IF r->>'family'='seller' THEN
  SELECT certificate,marketplace_seller_fee_credit_valid(id) INTO bound,valid FROM marketplace_seller_fee_credits WHERE id=collection_id;
 ELSIF r->>'family'='host' THEN
  SELECT certificate,marketplace_host_fee_credit_valid(id) INTO bound,valid FROM marketplace_host_fee_credits WHERE id=collection_id;
 ELSE RETURN false; END IF;
 IF valid IS NOT TRUE OR c IS DISTINCT FROM bound OR (c->>'excessLiabilityCents')::bigint NOT BETWEEN 1 AND 2147483647
   OR r->'amountCents' IS DISTINCT FROM c->'excessLiabilityCents'
   OR COALESCE(r->>'actorUserId' ~ '^[A-Za-z0-9_-]{1,200}$',false) IS NOT TRUE
   OR r->>'authorisedAt' IS NULL OR NOT isfinite((r->>'authorisedAt')::timestamptz)
   OR (r->>'authorisedAt')::timestamptz<(c#>>'{proof,observedAt}')::timestamptz THEN RETURN false; END IF;
 raw:=jsonb_build_object('family',r->'family','credit',c,'amountCents',c->'excessLiabilityCents','actorUserId',r->'actorUserId',
  'authorisedAt',r->'authorisedAt','reference','mfee_excess_'||marketplace_contribution_hash(jsonb_build_array(r->'family',collection_id,c->'certificateHash',c->'excessLiabilityCents')));
 RETURN r IS NOT DISTINCT FROM raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_fee_excess_metadata(r jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('reason','marketplace_fee_excess_return','family',r->'family','collectionId',r#>'{credit,request,collectionId}',
  'feeCertificateId',r#>'{credit,request,feeCertificateId}','fundingPlanId',r#>'{credit,request,fundingPlanId}',
  'merchantId',r#>'{credit,request,merchantId}','creditHash',r#>'{credit,certificateHash}','requestHash',r->'requestHash','reference',r->'reference')
$$;

CREATE FUNCTION marketplace_fee_excess_evidence_valid(c jsonb) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE r jsonb; p jsonb; f jsonb; b jsonb; amount bigint; time timestamptz;
BEGIN
 r:=c->'request';p:=c->'proof';f:=p->'refund';b:=p->'balance';amount:=(r->>'amountCents')::bigint;time:=(p->>'observedAt')::timestamptz;
 IF marketplace_fee_excess_request_valid(r) IS NOT TRUE OR p->>'requestHash' IS DISTINCT FROM r->>'requestHash'
   OR p->>'accountFingerprint' IS DISTINCT FROM r#>>'{credit,request,accountFingerprint}' OR time IS NULL OR NOT isfinite(time)
   OR time<(r->>'authorisedAt')::timestamptz OR f->>'object' IS DISTINCT FROM 'refund'
   OR COALESCE(f->>'id' ~ '^re_[A-Za-z0-9_]+$',false) IS NOT TRUE OR f->>'status' IS DISTINCT FROM 'succeeded'
   OR f->'amount' IS DISTINCT FROM to_jsonb(amount) OR f->>'currency' IS DISTINCT FROM 'brl'
   OR f->>'created' IS NULL OR (f->>'created')::numeric<=0 OR (f->>'created')::numeric>9007199254740991
   OR trunc((f->>'created')::numeric)<>(f->>'created')::numeric
   OR to_timestamp((f->>'created')::double precision)<date_trunc('second',(r->>'authorisedAt')::timestamptz)
   OR to_timestamp((f->>'created')::double precision)>time+interval '60 seconds'
   OR f->>'charge' IS DISTINCT FROM r#>>'{credit,proof,charge,id}' OR f->>'payment_intent' IS DISTINCT FROM r#>>'{credit,proof,paymentIntent,id}'
   OR f->'metadata' IS DISTINCT FROM marketplace_fee_excess_metadata(r) OR b->>'object' IS DISTINCT FROM 'balance_transaction'
   OR COALESCE(b->>'id' ~ '^txn_[A-Za-z0-9_]+$',false) IS NOT TRUE OR b->>'id' IS DISTINCT FROM f->>'balance_transaction'
   OR b->>'id'=r#>>'{credit,proof,balance,id}' OR b->>'id'=r#>>'{credit,request,disputeRequest,captureBalanceTransactionId}'
   OR b->>'source' IS DISTINCT FROM f->>'id' OR b->>'type' IS DISTINCT FROM 'refund' OR b->>'status' IS DISTINCT FROM 'available'
   OR b->>'currency' IS DISTINCT FROM 'brl' OR b->'amount' IS DISTINCT FROM to_jsonb(-amount) OR b->'fee' IS DISTINCT FROM '0'::jsonb
   OR b->'net' IS DISTINCT FROM to_jsonb(-amount) OR b->'exchange_rate' IS DISTINCT FROM 'null'::jsonb
   OR b->>'available_on' IS NULL OR (b->>'available_on')::numeric<=0 OR (b->>'available_on')::numeric>9007199254740991
   OR trunc((b->>'available_on')::numeric)<>(b->>'available_on')::numeric
   OR to_timestamp((b->>'available_on')::double precision)>time+interval '60 seconds' THEN RETURN false; END IF;
 RETURN c IS NOT DISTINCT FROM jsonb_build_object('request',r,'proof',p,'certificateHash',marketplace_contribution_hash(jsonb_build_object('request',r,'proof',p)));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_fee_excess_payload(r jsonb,c jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('family',r->'family','collection_id',r#>'{credit,request,collectionId}','debt_id',r#>'{credit,request,debtId}',
  'fee_certificate_id',r#>'{credit,request,feeCertificateId}','funding_plan_id',r#>'{credit,request,fundingPlanId}',
  'merchant_id',r#>'{credit,request,merchantId}','request_hash',r->'requestHash','credit_certificate_hash',r#>'{credit,certificateHash}','amount_cents',r->'amountCents')
 ||CASE WHEN c IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('provider_refund_id',c#>'{proof,refund,id}',
  'returned_excess_cents',r->'amountCents','certificate_hash',c->'certificateHash') END
$$;

CREATE FUNCTION marketplace_fee_excess_return_valid(family text,collection_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE j jsonb; r jsonb; c jsonb;
BEGIN
 IF family='seller' THEN SELECT to_jsonb(journal_row) INTO j FROM marketplace_seller_fee_collections journal_row WHERE id=collection_id;
 ELSIF family='host' THEN SELECT to_jsonb(journal_row) INTO j FROM marketplace_host_fee_collections journal_row WHERE id=collection_id;
 ELSE RETURN false;END IF;
 r:=j->'excess_return_request';c:=j->'excess_return_certificate';
 IF j->>'status' IS DISTINCT FROM 'credited' OR j->>'excess_return_status' IS DISTINCT FROM 'returned'
  OR r->>'family' IS DISTINCT FROM family OR r#>>'{credit,request,collectionId}' IS DISTINCT FROM collection_id
  OR marketplace_fee_excess_evidence_valid(c) IS NOT TRUE OR c->'request' IS DISTINCT FROM r
  OR r->>'requestHash' IS DISTINCT FROM j->>'excess_return_request_hash'
  OR c->>'certificateHash' IS DISTINCT FROM j->>'excess_return_certificate_hash'
  OR j->'returned_excess_cents' IS DISTINCT FROM r->'amountCents' OR j->>'excess_returned_at' IS NULL
  OR j->>'excess_return_submitted_at' IS NULL OR j->>'excess_return_provider_refund_id' IS DISTINCT FROM c#>>'{proof,refund,id}'
  OR j->>'excess_return_balance_transaction_id' IS DISTINCT FROM c#>>'{proof,balance,id}'
  OR j#>>'{excess_return_observation,state}' IS DISTINCT FROM 'confirmed'
  OR j#>'{excess_return_observation,proof}' IS DISTINCT FROM c->'proof'
  OR j#>>'{excess_return_observation,providerRefundId}' IS DISTINCT FROM c#>>'{proof,refund,id}' THEN RETURN false;END IF;
 RETURN EXISTS(SELECT 1 FROM outbox_messages e
  WHERE e.event_id='mfee_excess_returned_'||marketplace_contribution_hash(jsonb_build_array(family,collection_id,r->'requestHash'))
  AND e.event_type='marketplace.'||family||'_fee_excess_returned' AND e.merchant_id=j->>'merchant_id'
  AND e.correlation_id=j->>'funding_plan_id' AND e.causation_id=collection_id AND e.producer='marketplace' AND e.schema_version=1
  AND e.payload=marketplace_fee_excess_payload(r,c));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_fee_excess_outstanding(family text,collection_id text) RETURNS integer LANGUAGE plpgsql STABLE AS $$
DECLARE excess integer;
BEGIN
 IF family='seller' THEN SELECT excess_liability_cents INTO excess FROM marketplace_seller_fee_credits WHERE id=collection_id;
 ELSIF family='host' THEN SELECT excess_liability_cents INTO excess FROM marketplace_host_fee_credits WHERE id=collection_id;
 ELSE RETURN NULL;END IF;
 IF excess>0 AND marketplace_fee_excess_return_valid(family,collection_id) IS TRUE THEN RETURN 0;END IF;
 RETURN COALESCE(excess,0);
END $$;

CREATE FUNCTION marketplace_fee_excess_hashes(family text,certificate_id text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE hashes jsonb;
BEGIN
 IF family='seller' THEN SELECT jsonb_agg(j.excess_return_certificate_hash ORDER BY c.credit_sequence) INTO hashes
  FROM marketplace_seller_fee_collections j JOIN marketplace_seller_fee_credits c ON c.id=j.id
  WHERE c.fee_certificate_id=certificate_id AND j.excess_return_status='returned' AND marketplace_fee_excess_return_valid(family,j.id);
 ELSIF family='host' THEN SELECT jsonb_agg(j.excess_return_certificate_hash ORDER BY c.credit_sequence) INTO hashes
  FROM marketplace_host_fee_collections j JOIN marketplace_host_fee_credits c ON c.id=j.id
  WHERE c.fee_certificate_id=certificate_id AND j.excess_return_status='returned' AND marketplace_fee_excess_return_valid(family,j.id);
 ELSE RETURN NULL;END IF;
 RETURN CASE WHEN hashes IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('excessReturnHashes',hashes) END;
END $$;

CREATE FUNCTION marketplace_fee_excess_receipt_unused(family text,collection_id text,refund_id text,balance_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
 RETURN NOT EXISTS(SELECT 1 FROM marketplace_seller_fee_collections WHERE NOT(family='seller' AND id=collection_id)
  AND (excess_return_provider_refund_id=refund_id OR excess_return_balance_transaction_id=balance_id))
 AND NOT EXISTS(SELECT 1 FROM marketplace_host_fee_collections WHERE NOT(family='host' AND id=collection_id)
  AND (excess_return_provider_refund_id=refund_id OR excess_return_balance_transaction_id=balance_id))
 AND NOT EXISTS(SELECT 1 FROM marketplace_contribution_excess_liabilities
  WHERE provider_refund_id=refund_id OR proof#>>'{snapshot,balance,id}'=balance_id OR proof#>>'{balance,id}'=balance_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_refund_operations WHERE provider_operation_id=refund_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_seller_fee_credits WHERE provider_balance_transaction_id=balance_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_host_fee_credits WHERE provider_balance_transaction_id=balance_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_refund_contribution_credits WHERE provider_balance_transaction_id=balance_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_dispute_ledger_entries WHERE provider_balance_transaction_id=balance_id)
 AND NOT EXISTS(SELECT 1 FROM marketplace_funding_plans WHERE budget#>>'{capture,balanceTransactionId}'=balance_id);
END $$;

CREATE FUNCTION marketplace_fee_excess_transition_guard(family text,old_row jsonb,new_row jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r jsonb; c jsonb; receipt text; amount bigint;
BEGIN
 IF old_row->>'excess_return_status'='returned' THEN
  IF new_row IS DISTINCT FROM old_row THEN RAISE EXCEPTION 'marketplace_fee_excess_return_immutable';END IF;RETURN;
 END IF;
 r:=new_row->'excess_return_request';amount:=(r->>'amountCents')::bigint;
 IF (r IS NULL OR r='null'::jsonb) AND new_row IS NOT DISTINCT FROM old_row THEN RETURN;END IF;
 IF marketplace_fee_excess_request_valid(r) IS NOT TRUE OR r->>'family' IS DISTINCT FROM family
  OR r#>>'{credit,request,collectionId}' IS DISTINCT FROM new_row->>'id'
  OR r#>>'{credit,request,merchantId}' IS DISTINCT FROM new_row->>'merchant_id'
  OR r->>'requestHash' IS DISTINCT FROM new_row->>'excess_return_request_hash' OR new_row->>'excess_return_status'='held'
  OR new_row->>'excess_return_submitted_at' IS NULL THEN RAISE EXCEPTION 'marketplace_fee_excess_return_unproven';END IF;
 IF old_row->>'excess_return_status'='held' THEN
  IF new_row->>'excess_return_status' IS DISTINCT FROM 'unknown' OR new_row->'excess_return_observation' IS DISTINCT FROM 'null'::jsonb
   OR new_row->'excess_return_provider_refund_id' IS DISTINCT FROM 'null'::jsonb
   OR (r->>'authorisedAt')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR (new_row->>'excess_return_submitted_at')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR NOT EXISTS(SELECT 1 FROM merchant_users WHERE id=r->>'actorUserId' AND merchant_id=new_row->>'merchant_id' AND disabled_at IS NULL AND role IN ('owner','admin'))
   THEN RAISE EXCEPTION 'marketplace_fee_excess_claim_unproven';END IF;
 ELSE
  IF r IS DISTINCT FROM old_row->'excess_return_request' OR new_row->'excess_return_submitted_at' IS DISTINCT FROM old_row->'excess_return_submitted_at'
   OR new_row->'excess_return_request_hash' IS DISTINCT FROM old_row->'excess_return_request_hash'
   OR old_row->>'excess_return_provider_refund_id' IS NOT NULL AND new_row->'excess_return_provider_refund_id' IS DISTINCT FROM old_row->'excess_return_provider_refund_id'
   THEN RAISE EXCEPTION 'marketplace_fee_excess_claim_consumed';END IF;
 END IF;
 FOR receipt IN SELECT value FROM (VALUES(new_row->>'excess_return_provider_refund_id'),(new_row->>'excess_return_balance_transaction_id')) receipt(value)
  WHERE value IS NOT NULL ORDER BY value COLLATE "C" LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('marketplace-fee-excess-receipt:'||receipt,0));
 END LOOP;
 IF marketplace_fee_excess_receipt_unused(family,new_row->>'id',new_row->>'excess_return_provider_refund_id',new_row->>'excess_return_balance_transaction_id') IS NOT TRUE
  THEN RAISE EXCEPTION 'marketplace_fee_excess_receipt_reused';END IF;
 IF new_row->>'excess_return_status'='returned' THEN
  c:=new_row->'excess_return_certificate';
  IF marketplace_fee_excess_evidence_valid(c) IS NOT TRUE OR c->'request' IS DISTINCT FROM r
   OR c->>'certificateHash' IS DISTINCT FROM new_row->>'excess_return_certificate_hash' OR new_row->'returned_excess_cents' IS DISTINCT FROM to_jsonb(amount)
   OR new_row->>'excess_return_provider_refund_id' IS DISTINCT FROM c#>>'{proof,refund,id}'
   OR new_row->>'excess_return_balance_transaction_id' IS DISTINCT FROM c#>>'{proof,balance,id}'
   OR (c#>>'{proof,observedAt}')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   OR new_row#>>'{excess_return_observation,state}' IS DISTINCT FROM 'confirmed'
   OR new_row#>'{excess_return_observation,proof}' IS DISTINCT FROM c->'proof'
   OR new_row#>>'{excess_return_observation,providerRefundId}' IS DISTINCT FROM c#>>'{proof,refund,id}'
   OR (new_row->>'excess_returned_at')::timestamptz NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
   THEN RAISE EXCEPTION 'marketplace_fee_excess_native_return_unproven';END IF;
 END IF;
END $$;

CREATE FUNCTION marketplace_fee_excess_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE family text; target text; journal jsonb; event_name text;
BEGIN
 IF TG_TABLE_NAME='outbox_messages' THEN
  event_name:=CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN OLD.event_id ELSE NEW.event_id END;
  SELECT 'seller',id INTO family,target FROM marketplace_seller_fee_collections
   WHERE 'mfee_excess_returned_'||marketplace_contribution_hash(jsonb_build_array('seller',id,excess_return_request_hash))=event_name;
  IF target IS NULL THEN SELECT 'host',id INTO family,target FROM marketplace_host_fee_collections
   WHERE 'mfee_excess_returned_'||marketplace_contribution_hash(jsonb_build_array('host',id,excess_return_request_hash))=event_name;END IF;
  IF target IS NULL THEN RETURN NULL;END IF;
  IF TG_OP='UPDATE' AND (to_jsonb(NEW)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','attempts','last_error','next_attempt_at','delivered_at','published_at','lease_token','lease_expires_at'])
    THEN RAISE EXCEPTION 'marketplace_fee_excess_outbox_immutable';END IF;
 ELSE family:=CASE WHEN TG_TABLE_NAME='marketplace_seller_fee_collections' THEN 'seller' ELSE 'host' END;target:=NEW.id;END IF;
 IF family='seller' THEN SELECT to_jsonb(journal_row) INTO journal FROM marketplace_seller_fee_collections journal_row WHERE id=target;
 ELSE SELECT to_jsonb(journal_row) INTO journal FROM marketplace_host_fee_collections journal_row WHERE id=target;END IF;
 IF journal->>'excess_return_status'='returned' AND marketplace_fee_excess_return_valid(family,target) IS NOT TRUE
  OR TG_TABLE_NAME='outbox_messages' AND journal->>'excess_return_status' IS DISTINCT FROM 'returned'
  THEN RAISE EXCEPTION 'marketplace_fee_excess_return_commit_incomplete';END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_fee_excess_seller_commit AFTER INSERT OR UPDATE ON marketplace_seller_fee_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_fee_excess_host_commit AFTER INSERT OR UPDATE ON marketplace_host_fee_collections
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_fee_excess_outbox_commit AFTER INSERT OR UPDATE OR DELETE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_commit_guard();

CREATE OR REPLACE FUNCTION marketplace_seller_fee_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; expected_approval jsonb; credit_count integer; observation_state text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status='credited' AND OLD.status='credited'
  AND (to_jsonb(NEW)-ARRAY['excess_return_status','excess_return_request','excess_return_request_hash','excess_return_submitted_at','excess_return_observation','excess_return_certificate','excess_return_certificate_hash','excess_return_provider_refund_id','excess_return_balance_transaction_id','returned_excess_cents','excess_returned_at','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['excess_return_status','excess_return_request','excess_return_request_hash','excess_return_submitted_at','excess_return_observation','excess_return_certificate','excess_return_certificate_hash','excess_return_provider_refund_id','excess_return_balance_transaction_id','returned_excess_cents','excess_returned_at','updated_at']) THEN
  PERFORM marketplace_fee_excess_transition_guard('seller',to_jsonb(OLD),to_jsonb(NEW));RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_seller_fee_collection_immutable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(
   jsonb_build_array('marketplace-seller-dispute-fee',NEW.fee_certificate_id)),0));
 IF TG_OP='UPDATE' THEN
   IF OLD.status IN ('credited','expired') THEN
     IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_seller_fee_collection_terminal'; END IF;
     RETURN NEW;
   END IF;
   IF (to_jsonb(NEW)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at'])
       IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','session_id','payment_intent_id','checkout_url','observation','submitted_at','updated_at'])
     OR OLD.session_id IS NOT NULL AND NEW.session_id IS DISTINCT FROM OLD.session_id
     OR OLD.payment_intent_id IS NOT NULL AND NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
     OR OLD.status='paid' AND NEW.status NOT IN ('paid','credited')
     OR NEW.status='approved'
     THEN RAISE EXCEPTION 'marketplace_seller_fee_collection_changed'; END IF;
   IF OLD.status='approved' THEN
     IF NEW.status='expired' THEN
       IF NEW.version<>0 OR NEW.submitted_at IS NOT NULL OR NEW.session_id IS NOT NULL OR NEW.payment_intent_id IS NOT NULL
         OR NEW.checkout_url IS NOT NULL OR NEW.observation IS DISTINCT FROM
           jsonb_build_object('reason','unsubmitted_approval_cancelled','requestHash',NEW.request_hash)
         THEN RAISE EXCEPTION 'marketplace_seller_fee_cancellation_unproven'; END IF;
       RETURN NEW;
     END IF;
     IF NEW.status IS DISTINCT FROM 'creating' OR NEW.version<>1 OR NEW.submitted_at IS NULL
       OR NEW.session_id IS NOT NULL OR NEW.payment_intent_id IS NOT NULL OR NEW.checkout_url IS NOT NULL OR NEW.observation IS NOT NULL
       OR NEW.submitted_at NOT BETWEEN clock_timestamp()-interval '300 seconds' AND clock_timestamp()+interval '60 seconds'
       OR to_timestamp((NEW.request->>'expiresAt')::double precision)<clock_timestamp()+interval '1801 seconds'
       OR marketplace_seller_fee_request_valid(NEW.request) IS NOT TRUE
       OR NOT EXISTS(SELECT 1 FROM merchant_users WHERE id=NEW.actor_user_id AND merchant_id=NEW.merchant_id
         AND role IN ('owner','admin') AND disabled_at IS NULL)
       THEN RAISE EXCEPTION 'marketplace_seller_fee_claim_unproven'; END IF;
     SELECT count(*) INTO credit_count FROM marketplace_seller_fee_credits WHERE fee_certificate_id=NEW.fee_certificate_id;
     IF credit_count<>jsonb_array_length(NEW.request->'priorCreditHashes') THEN
       RAISE EXCEPTION 'marketplace_seller_fee_obligation_changed'; END IF;
   ELSE
     IF NEW.version<>1 OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.status NOT IN ('open','paid','unproven','credited','expired')
       THEN RAISE EXCEPTION 'marketplace_seller_fee_submission_consumed'; END IF;
     IF NEW.status IN ('open','paid','expired') THEN
       IF marketplace_seller_fee_session_valid(NEW.request,NEW.observation,NEW.status) IS NOT TRUE
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
         THEN RAISE EXCEPTION 'marketplace_seller_fee_session_unproven'; END IF;
     ELSIF NEW.status='unproven' AND
       (NEW.session_id IS DISTINCT FROM OLD.session_id OR NEW.payment_intent_id IS DISTINCT FROM OLD.payment_intent_id
         OR NEW.checkout_url IS DISTINCT FROM OLD.checkout_url OR NEW.observation IS DISTINCT FROM OLD.observation) THEN
       RAISE EXCEPTION 'marketplace_seller_fee_unknown_receipt_changed';
     ELSIF NEW.status='credited' AND
       (OLD.status IS DISTINCT FROM 'paid' OR NEW.observation IS DISTINCT FROM OLD.observation
         OR NEW.checkout_url IS DISTINCT FROM OLD.checkout_url) THEN
       RAISE EXCEPTION 'marketplace_seller_fee_paid_receipt_required';
     END IF;
   END IF;
   RETURN NEW;
 END IF;
 SELECT * INTO c FROM marketplace_debt_principal_extinctions WHERE id=NEW.fee_certificate_id;
 expected_approval:=jsonb_build_object('actor',jsonb_build_object('merchantId',NEW.merchant_id,'userId',NEW.actor_user_id),
   'input',jsonb_build_object('debtId',NEW.debt_id,'collectionId',NEW.id,'customerId',NEW.customer_id,
     'grossAmountCents',NEW.request->'grossAmountCents','confirmed',true));
 SELECT count(*) INTO credit_count FROM marketplace_seller_fee_credits WHERE fee_certificate_id=NEW.fee_certificate_id;
 IF c.id IS NULL OR marketplace_seller_fee_request_valid(NEW.request) IS NOT TRUE
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
   THEN RAISE EXCEPTION 'marketplace_seller_fee_approval_unproven'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION marketplace_host_fee_collection_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c RECORD; expected_approval jsonb; credit_count integer; observation_state text;
BEGIN
 IF TG_OP='UPDATE' AND NEW.status='credited' AND OLD.status='credited'
  AND (to_jsonb(NEW)-ARRAY['excess_return_status','excess_return_request','excess_return_request_hash','excess_return_submitted_at','excess_return_observation','excess_return_certificate','excess_return_certificate_hash','excess_return_provider_refund_id','excess_return_balance_transaction_id','returned_excess_cents','excess_returned_at','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['excess_return_status','excess_return_request','excess_return_request_hash','excess_return_submitted_at','excess_return_observation','excess_return_certificate','excess_return_certificate_hash','excess_return_provider_refund_id','excess_return_balance_transaction_id','returned_excess_cents','excess_returned_at','updated_at']) THEN
  PERFORM marketplace_fee_excess_transition_guard('host',to_jsonb(OLD),to_jsonb(NEW));RETURN NEW;
 END IF;
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

CREATE OR REPLACE FUNCTION marketplace_seller_positive_fee_dispute_obligation_evidence(target_debt_id text)
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
     OR credit.account_fingerprint IS DISTINCT FROM f.account_fingerprint OR marketplace_fee_excess_outstanding('seller',credit.id)<>0
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
   'fundingHoldReleased',false,'payoutReauthorized',false)||marketplace_fee_excess_hashes('seller',c.id);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION marketplace_seller_positive_fee_dispute_obligation_valid(debt_id text)
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
   'excess_liability_cents',0,'funding_hold_released',false,'payout_reauthorized',false)||CASE WHEN expected?'excessReturnHashes' THEN jsonb_build_object('excess_return_hashes',expected->'excessReturnHashes') ELSE '{}'::jsonb END;
 RETURN EXISTS(SELECT 1 FROM outbox_messages WHERE event_id=obligation.id AND event_type='marketplace.seller_dispute_obligation_closed'
   AND merchant_id=obligation.seller_merchant_id AND correlation_id=obligation.funding_plan_id AND causation_id=obligation.debt_id
   AND producer='marketplace' AND schema_version=1 AND payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_host_dispute_obligation_evidence(target_payout text) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
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
     OR credit.account_fingerprint IS DISTINCT FROM c.evidence->>'accountFingerprint' OR marketplace_fee_excess_outstanding('host',credit.id)<>0
     THEN RETURN NULL; END IF;
   collected:=collected+credit.credit_cents;processing:=processing+credit.processing_fee_cents;
   hashes:=hashes||jsonb_build_array(credit.certificate_hash);
 END LOOP;
 IF n=0 OR collected<>due OR processing NOT BETWEEN 0 AND 2147483647 THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('version',1,'reason','stripe_host_dispute_obligation_closed','debtId',c.payout_id,'payoutId',c.payout_id,
   'feeCertificateId',c.id,'feeCertificateHash',c.evidence_hash,'hostMerchantId',c.host_merchant_id,'fundingPlanId',c.funding_plan_id,
   'providerDisputeId',c.provider_dispute_id,'closureSnapshotId',c.closure_snapshot_id,'provider','stripe','environment',c.evidence->'environment',
   'accountFingerprint',c.evidence->'accountFingerprint','principalAmountCents',c.amount_cents,'disputeFeeCents',due,
   'collectedFeeCents',collected,'processingFeeCents',processing,'excessLiabilityCents',0,'creditHashes',hashes,'fundingHoldReleased',false,'payoutReauthorized',false)||marketplace_fee_excess_hashes('host',c.id);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION marketplace_host_dispute_obligation_valid(target_payout text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
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
   'excess_liability_cents',0,'funding_hold_released',false,'payout_reauthorized',false)||CASE WHEN expected?'excessReturnHashes' THEN jsonb_build_object('excess_return_hashes',expected->'excessReturnHashes') ELSE '{}'::jsonb END;
 RETURN EXISTS(SELECT 1 FROM outbox_messages financial_event WHERE financial_event.event_id=o.id AND financial_event.event_type='marketplace.host_dispute_obligation_closed'
   AND financial_event.merchant_id=o.host_merchant_id AND financial_event.correlation_id=o.funding_plan_id AND financial_event.causation_id=o.payout_id
   AND financial_event.producer='marketplace' AND financial_event.schema_version=1 AND financial_event.payload=event_payload);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Fence future incoming, dispute and unrelated refund journals from borrowing
-- an already claimed refund or its outgoing native balance receipt.
CREATE FUNCTION marketplace_fee_excess_receipt_fence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE row_body jsonb; receipt text; balance_id text; refund_id text;
BEGIN
 row_body:=to_jsonb(NEW);
 balance_id:=COALESCE(row_body->>'provider_balance_transaction_id',row_body#>>'{budget,capture,balanceTransactionId}',
   row_body#>>'{proof,snapshot,balance,id}',row_body#>>'{proof,balance,id}');
 refund_id:=COALESCE(row_body->>'provider_refund_id',CASE WHEN TG_TABLE_NAME='marketplace_refund_operations' THEN row_body->>'provider_operation_id' END);
 FOR receipt IN SELECT value FROM (VALUES(balance_id),(refund_id)) receipt(value) WHERE value IS NOT NULL ORDER BY value COLLATE "C" LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended('marketplace-fee-excess-receipt:'||receipt,0));
 END LOOP;
 IF EXISTS(SELECT 1 FROM marketplace_seller_fee_collections WHERE excess_return_provider_refund_id=refund_id OR excess_return_balance_transaction_id=balance_id)
  OR EXISTS(SELECT 1 FROM marketplace_host_fee_collections WHERE excess_return_provider_refund_id=refund_id OR excess_return_balance_transaction_id=balance_id)
  THEN RAISE EXCEPTION 'marketplace_fee_excess_receipt_reused';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_fee_excess_seller_incoming_fence BEFORE INSERT OR UPDATE OF provider_balance_transaction_id ON marketplace_seller_fee_credits FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_host_incoming_fence BEFORE INSERT OR UPDATE OF provider_balance_transaction_id ON marketplace_host_fee_credits FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_contribution_incoming_fence BEFORE INSERT OR UPDATE OF provider_balance_transaction_id ON marketplace_refund_contribution_credits FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_dispute_fence BEFORE INSERT OR UPDATE OF provider_balance_transaction_id ON marketplace_dispute_ledger_entries FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_funding_fence BEFORE INSERT OR UPDATE OF budget ON marketplace_funding_plans FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_refund_fence BEFORE INSERT OR UPDATE OF provider_operation_id ON marketplace_refund_operations FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
CREATE TRIGGER marketplace_fee_excess_contribution_return_fence BEFORE INSERT OR UPDATE OF provider_refund_id,proof ON marketplace_contribution_excess_liabilities FOR EACH ROW EXECUTE FUNCTION marketplace_fee_excess_receipt_fence();
