-- A seller-authorized new wallet return is distinct from an Asaas native
-- reversal, buyer refund, processing-fee contribution, debt or chargeback credit.
CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_hash(value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(marketplace_recovery_canonical(value),'UTF8')),'hex')
$$;

CREATE TABLE IF NOT EXISTS marketplace_asaas_wallet_returns (
 id text PRIMARY KEY CHECK(id ~ '^awreturn_[a-f0-9]{64}$'),
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 seller_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 actor_id text NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 refund_plan_id text NOT NULL REFERENCES marketplace_refund_plans(id) ON DELETE RESTRICT,
 payout_id text NOT NULL UNIQUE REFERENCES marketplace_payouts(id) ON DELETE RESTRICT,
 environment text NOT NULL CHECK(environment IN ('test','live')),
 host_account_fingerprint text NOT NULL CHECK(host_account_fingerprint ~ '^[a-f0-9]{64}$'),
 seller_account_fingerprint text NOT NULL CHECK(seller_account_fingerprint ~ '^[a-f0-9]{64}$'),
 original_provider_transfer_id text NOT NULL CHECK(original_provider_transfer_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 provider_return_transfer_id text CHECK(provider_return_transfer_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 amount_cents integer NOT NULL CHECK(amount_cents>0),
 request jsonb NOT NULL,
 request_hash text NOT NULL UNIQUE CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 reference text NOT NULL UNIQUE CHECK(reference='mwreturn_'||request_hash),
 status text NOT NULL DEFAULT 'claimed' CHECK(status IN ('claimed','unknown','pending','returned','failed')),
 version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 submitted_at timestamptz(3),
 observed_at timestamptz(3),
 proof jsonb,
 certificate_hash text CHECK(certificate_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz(3) NOT NULL DEFAULT now(),
 CHECK(host_merchant_id<>seller_merchant_id),
 CHECK(host_account_fingerprint<>seller_account_fingerprint),
 CHECK(provider_return_transfer_id IS NULL OR provider_return_transfer_id<>original_provider_transfer_id),
 CHECK((status='claimed' AND submitted_at IS NULL AND provider_return_transfer_id IS NULL AND observed_at IS NULL)
   OR (status<>'claimed' AND submitted_at IS NOT NULL)),
 CHECK((status='returned' AND proof IS NOT NULL AND certificate_hash IS NOT NULL AND provider_return_transfer_id IS NOT NULL AND observed_at IS NOT NULL)
   OR (status<>'returned' AND proof IS NULL AND certificate_hash IS NULL)),
 CHECK(status NOT IN ('pending','failed') OR (provider_return_transfer_id IS NOT NULL AND observed_at IS NOT NULL)),
 UNIQUE(environment,host_account_fingerprint,original_provider_transfer_id),
 UNIQUE(environment,seller_account_fingerprint,provider_return_transfer_id)
);
CREATE INDEX IF NOT EXISTS marketplace_asaas_wallet_returns_recovery ON marketplace_asaas_wallet_returns(status,created_at,id);
CREATE INDEX IF NOT EXISTS marketplace_asaas_wallet_returns_refund ON marketplace_asaas_wallet_returns(host_merchant_id,funding_plan_id,refund_plan_id);

CREATE TABLE IF NOT EXISTS marketplace_asaas_wallet_return_receipts (
 receipt_id text PRIMARY KEY CHECK(receipt_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 journal_id text NOT NULL REFERENCES marketplace_asaas_wallet_returns(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('original_host_debit','original_seller_credit','seller_return_debit','host_return_credit')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 transfer_id text NOT NULL CHECK(transfer_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 amount_cents integer NOT NULL CHECK(amount_cents<>0),
 date date NOT NULL,
 UNIQUE(journal_id,kind)
);

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_request_valid(j marketplace_asaas_wallet_returns)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(
  jsonb_typeof(j.request)='object' AND j.request->>'version'='1' AND j.request->>'kind'='authorized_wallet_return'
  AND j.request->>'provider'='asaas' AND j.request->>'currency'='BRL' AND j.request->>'environment'=j.environment
  AND j.request->>'paymentMethod' IN ('pix','card') AND j.request->>'requestHash'=j.request_hash AND j.request->>'reference'=j.reference
  AND marketplace_asaas_wallet_return_hash(j.request-'requestHash'-'reference')=j.request_hash
  AND j.request->>'fundingPlanId'=j.funding_plan_id AND j.request->>'refundPlanId'=j.refund_plan_id
  AND j.request->'host'->>'merchantId'=j.host_merchant_id AND j.request->'seller'->>'merchantId'=j.seller_merchant_id
  AND j.request->'host'->>'accountFingerprint'=j.host_account_fingerprint AND j.request->'seller'->>'accountFingerprint'=j.seller_account_fingerprint
  AND j.request->'host'->>'walletId'<>j.request->'seller'->>'walletId'
  AND j.request->'authorization'->>'actorId'=j.actor_id AND j.request->'authorization'->>'sellerMerchantId'=j.seller_merchant_id
  AND j.request->'originalPayout'->>'id'=j.payout_id AND j.request->'originalPayout'->>'providerTransferId'=j.original_provider_transfer_id
  AND (j.request->>'amountCents')::integer=j.amount_cents AND (j.request->'originalPayout'->>'amountCents')::integer=j.amount_cents
  AND EXISTS (SELECT 1 FROM marketplace_funding_plans f JOIN payment_intents pi ON pi.id=f.payment_intent_id AND pi.merchant_id=f.host_merchant_id
    JOIN marketplace_refund_plans r ON r.funding_plan_id=f.payment_intent_id AND r.host_merchant_id=f.host_merchant_id
    JOIN marketplace_payouts p ON p.funding_plan_id=f.payment_intent_id
    WHERE f.payment_intent_id=j.funding_plan_id AND f.host_merchant_id=j.host_merchant_id AND f.provider='asaas' AND f.environment=j.environment
      AND f.account_fingerprint=j.host_account_fingerprint AND f.instructions_hash=j.request->>'instructionsHash'
      AND f.budget->'capture'=j.request->'capture' AND pi.method=j.request->>'paymentMethod'
      AND r.id=j.refund_plan_id AND r.return_id=j.request->>'returnId' AND r.allocation_hash=j.request->>'allocationHash'
      AND p.id=j.payout_id AND p.provider='asaas' AND p.account_fingerprint=j.host_account_fingerprint AND p.amount_cents=j.amount_cents
      AND p.beneficiary_merchant_id=j.seller_merchant_id AND p.destination=j.request->'seller'->>'walletId'
      AND p.provider_transfer_id=j.original_provider_transfer_id AND p.reference=j.request->'originalPayout'->>'reference'),false)
$$;

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_proof_valid(j marketplace_asaas_wallet_returns)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(
  jsonb_typeof(j.proof)='object' AND j.proof->>'version'='1' AND j.proof->>'kind'='authorized_wallet_return'
  AND j.proof->>'association'='local_immutable_authorization' AND j.proof->>'requestHash'=j.request_hash
  AND j.proof->>'authorizationId'=j.request->'authorization'->>'id' AND j.proof->>'reference'=j.reference
  AND j.proof->>'originalProviderTransferId'=j.original_provider_transfer_id AND j.proof->>'providerTransferId'=j.provider_return_transfer_id
  AND j.proof->>'hostAccountFingerprint'=j.host_account_fingerprint AND j.proof->>'sellerAccountFingerprint'=j.seller_account_fingerprint
  AND j.proof->>'hostWalletId'=j.request->'host'->>'walletId' AND j.proof->>'sellerWalletId'=j.request->'seller'->>'walletId'
  AND (j.proof->>'amountCents')::integer=j.amount_cents AND (j.proof->>'observedAt')::timestamptz(3)=j.observed_at
  AND j.certificate_hash=marketplace_asaas_wallet_return_hash(jsonb_build_object('request',j.request,'proof',j.proof))
  AND (SELECT count(DISTINCT j.proof->entry.key->>'id')=4 FROM (VALUES ('originalHostDebit'),('originalSellerCredit'),('sellerReturnDebit'),('hostReturnCredit')) entry(key))
  AND NOT EXISTS (SELECT 1 FROM (VALUES
    ('originalHostDebit','INTERNAL_TRANSFER_DEBIT',j.original_provider_transfer_id,-j.amount_cents),
    ('originalSellerCredit','INTERNAL_TRANSFER_CREDIT',j.original_provider_transfer_id,j.amount_cents),
    ('sellerReturnDebit','INTERNAL_TRANSFER_DEBIT',j.provider_return_transfer_id,-j.amount_cents),
    ('hostReturnCredit','INTERNAL_TRANSFER_CREDIT',j.provider_return_transfer_id,j.amount_cents)) entry(key,type,transfer_id,amount)
    WHERE NOT COALESCE(jsonb_typeof(j.proof->entry.key)='object' AND j.proof->entry.key->>'id' ~ '^[A-Za-z0-9_-]{1,100}$'
      AND j.proof->entry.key->>'type'=entry.type AND j.proof->entry.key->>'transferId'=entry.transfer_id
      AND (j.proof->entry.key->>'amountCents')::integer=entry.amount AND j.proof->entry.key->>'date' ~ '^\d{4}-\d{2}-\d{2}$',false)),false)
$$;

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_immutable'; END IF;
 IF NOT marketplace_asaas_wallet_return_request_valid(NEW) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_request_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'claimed' OR NEW.version<>0 OR NEW.proof IS NOT NULL OR NEW.submitted_at IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM merchant_users u WHERE u.id=NEW.actor_id AND u.merchant_id=NEW.seller_merchant_id AND u.role IN ('owner','admin') AND u.disabled_at IS NULL)
    OR NOT EXISTS (SELECT 1 FROM marketplace_payouts p WHERE p.id=NEW.payout_id AND p.status='confirmed' AND p.claimed_at IS NOT NULL AND p.reconciled_at IS NOT NULL)
    OR NOT EXISTS (SELECT 1 FROM marketplace_refund_plans r WHERE r.id=NEW.refund_plan_id AND r.status='blocked' AND r.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable') THEN
    RAISE EXCEPTION 'marketplace_asaas_wallet_return_initial_state_invalid';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','submitted_at','observed_at','proof','certificate_hash','provider_return_transfer_id']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','submitted_at','observed_at','proof','certificate_hash','provider_return_transfer_id']) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_identity_immutable'; END IF;
  IF OLD.status IN ('returned','failed') THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_terminal'; END IF;
  IF NEW.version<>OLD.version+1 OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
    OR (OLD.provider_return_transfer_id IS NOT NULL AND NEW.provider_return_transfer_id IS DISTINCT FROM OLD.provider_return_transfer_id) THEN
    RAISE EXCEPTION 'marketplace_asaas_wallet_return_claim_invalid';
  END IF;
  IF NOT ((OLD.status='claimed' AND NEW.status='unknown' AND NEW.submitted_at IS NOT NULL AND NEW.provider_return_transfer_id IS NULL)
    OR (OLD.status IN ('unknown','pending') AND NEW.status IN ('unknown','pending','returned','failed'))) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_transition_invalid'; END IF;
 END IF;
 IF NEW.status='returned' AND NOT marketplace_asaas_wallet_return_proof_valid(NEW) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_proof_invalid'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_guard ON marketplace_asaas_wallet_returns;
CREATE TRIGGER marketplace_asaas_wallet_return_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_asaas_wallet_returns FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j marketplace_asaas_wallet_returns; entry jsonb; expected_account text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_receipt_immutable'; END IF;
 SELECT * INTO j FROM marketplace_asaas_wallet_returns WHERE id=NEW.journal_id;
 IF j.status<>'returned' OR NOT marketplace_asaas_wallet_return_proof_valid(j) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_receipt_parent_invalid'; END IF;
 entry:=j.proof->CASE NEW.kind WHEN 'original_host_debit' THEN 'originalHostDebit' WHEN 'original_seller_credit' THEN 'originalSellerCredit' WHEN 'seller_return_debit' THEN 'sellerReturnDebit' ELSE 'hostReturnCredit' END;
 expected_account:=CASE WHEN NEW.kind IN ('original_host_debit','host_return_credit') THEN j.host_account_fingerprint ELSE j.seller_account_fingerprint END;
 IF NEW.receipt_id IS DISTINCT FROM entry->>'id' OR NEW.account_fingerprint IS DISTINCT FROM expected_account OR NEW.transfer_id IS DISTINCT FROM entry->>'transferId'
   OR NEW.amount_cents IS DISTINCT FROM (entry->>'amountCents')::integer OR NEW.date IS DISTINCT FROM (entry->>'date')::date THEN
   RAISE EXCEPTION 'marketplace_asaas_wallet_return_receipt_mismatch';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_receipt_guard ON marketplace_asaas_wallet_return_receipts;
CREATE TRIGGER marketplace_asaas_wallet_return_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_asaas_wallet_return_receipts FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_receipt_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.event_type='marketplace.asaas_wallet_return.returned' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_outbox_immutable'; END IF;
  IF ROW(NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,
    NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload) IS DISTINCT FROM
    ROW(OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,
    OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload) THEN
   RAISE EXCEPTION 'marketplace_asaas_wallet_return_outbox_immutable';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_outbox_guard ON outbox_messages;
CREATE TRIGGER marketplace_asaas_wallet_return_outbox_guard BEFORE UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_outbox_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_wallet_return_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_id text; j marketplace_asaas_wallet_returns; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='marketplace_asaas_wallet_returns' THEN journal_id:=NEW.id;
 ELSIF TG_TABLE_NAME='marketplace_asaas_wallet_return_receipts' THEN journal_id:=NEW.journal_id;
 ELSE
  IF NEW.event_type<>'marketplace.asaas_wallet_return.returned' THEN RETURN NEW; END IF;
  journal_id:=NEW.payload->>'journal_id';
 END IF;
 SELECT * INTO j FROM marketplace_asaas_wallet_returns WHERE id=journal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_orphan_evidence'; END IF;
 IF j.status='returned' THEN
  expected:=jsonb_build_object('journal_id',j.id,'funding_plan_id',j.funding_plan_id,'refund_plan_id',j.refund_plan_id,'payout_id',j.payout_id,'amount_cents',j.amount_cents,'certificate_hash',j.certificate_hash);
  IF NOT marketplace_asaas_wallet_return_proof_valid(j) OR (SELECT count(*) FROM marketplace_asaas_wallet_return_receipts r WHERE r.journal_id=j.id)<>4
    OR NOT EXISTS (SELECT 1 FROM outbox_messages o WHERE o.event_id='marketplace_asaas_wallet_return_'||j.id AND o.event_type='marketplace.asaas_wallet_return.returned'
      AND o.schema_version=1 AND o.merchant_id=j.host_merchant_id AND o.producer='marketplace' AND o.correlation_id=j.funding_plan_id AND o.causation_id=j.id
      AND o.occurred_at=(j.observed_at AT TIME ZONE 'UTC') AND o.payload=expected) THEN RAISE EXCEPTION 'marketplace_asaas_wallet_return_evidence_incomplete'; END IF;
 ELSIF EXISTS (SELECT 1 FROM marketplace_asaas_wallet_return_receipts r WHERE r.journal_id=j.id)
   OR EXISTS (SELECT 1 FROM outbox_messages o WHERE o.event_type='marketplace.asaas_wallet_return.returned' AND o.payload->>'journal_id'=j.id) THEN
  RAISE EXCEPTION 'marketplace_asaas_wallet_return_unconfirmed_evidence';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_complete_guard ON marketplace_asaas_wallet_returns;
CREATE CONSTRAINT TRIGGER marketplace_asaas_wallet_return_complete_guard AFTER INSERT OR UPDATE ON marketplace_asaas_wallet_returns
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_complete_guard();
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_receipt_complete_guard ON marketplace_asaas_wallet_return_receipts;
CREATE CONSTRAINT TRIGGER marketplace_asaas_wallet_return_receipt_complete_guard AFTER INSERT ON marketplace_asaas_wallet_return_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_complete_guard();
DROP TRIGGER IF EXISTS marketplace_asaas_wallet_return_outbox_complete_guard ON outbox_messages;
CREATE CONSTRAINT TRIGGER marketplace_asaas_wallet_return_outbox_complete_guard AFTER INSERT OR UPDATE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_wallet_return_complete_guard();
