-- V2: one whole seller-authorized return of one completed initial V5/V7 outbound.
-- Host accounting retention is never a native transfer or a new funding source.
-- A separate journal fences one POST and leaves excess principal held.
CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_hash(value jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(marketplace_recovery_canonical(value),'UTF8')),'hex')
$$;

CREATE TABLE IF NOT EXISTS marketplace_asaas_residual_wallet_returns (
 id text PRIMARY KEY CHECK(id ~ '^awresreturn_[a-f0-9]{64}$'),
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 seller_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 actor_id text NOT NULL REFERENCES merchant_users(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 refund_plan_id text NOT NULL REFERENCES marketplace_refund_plans(id) ON DELETE RESTRICT,
 residual_plan_id text NOT NULL REFERENCES marketplace_residual_plans(id) ON DELETE RESTRICT,
 residual_operation_id text NOT NULL UNIQUE REFERENCES marketplace_residual_operations(id) ON DELETE RESTRICT,
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
CREATE INDEX IF NOT EXISTS marketplace_asaas_residual_wallet_returns_recovery ON marketplace_asaas_residual_wallet_returns(status,created_at,id);
CREATE INDEX IF NOT EXISTS marketplace_asaas_residual_wallet_returns_refund ON marketplace_asaas_residual_wallet_returns(host_merchant_id,funding_plan_id,refund_plan_id);

CREATE TABLE IF NOT EXISTS marketplace_asaas_residual_wallet_return_receipts (
 receipt_id text PRIMARY KEY CHECK(receipt_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 journal_id text NOT NULL REFERENCES marketplace_asaas_residual_wallet_returns(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('original_host_debit','original_seller_credit','seller_return_debit','host_return_credit')),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 transfer_id text NOT NULL CHECK(transfer_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 amount_cents integer NOT NULL CHECK(amount_cents<>0),
 date date NOT NULL,
 UNIQUE(journal_id,kind)
);

CREATE FUNCTION marketplace_asaas_residual_wallet_return_request_valid(j marketplace_asaas_residual_wallet_returns)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE f marketplace_funding_plans; r marketplace_refund_plans; p marketplace_residual_plans; o marketplace_residual_operations; prefix jsonb;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=j.funding_plan_id AND host_merchant_id=j.host_merchant_id;
 SELECT * INTO r FROM marketplace_refund_plans WHERE id=j.refund_plan_id AND funding_plan_id=f.payment_intent_id AND host_merchant_id=f.host_merchant_id;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=j.residual_plan_id AND funding_plan_id=f.payment_intent_id AND host_merchant_id=f.host_merchant_id;
 SELECT * INTO o FROM marketplace_residual_operations WHERE id=j.residual_operation_id AND residual_plan_id=p.id AND beneficiary_merchant_id=j.seller_merchant_id;
 SELECT jsonb_agg(jsonb_build_object('providerOperationId',e.value->'providerOperationId','amountCents',e.value->'amountCents') ORDER BY e.ordinality)
   INTO prefix FROM jsonb_array_elements(p.basis->'refunds') WITH ORDINALITY e;
 RETURN COALESCE(f.provider='asaas' AND f.environment=j.environment AND f.account_fingerprint=j.host_account_fingerprint
   AND p.generation=1 AND p.status='completed' AND p.held_reason IS NULL AND p.basis->>'version' IN ('5','7')
   AND p.basis_hash=marketplace_asaas_residual_wallet_return_hash(p.basis) AND p.allocation_hash=marketplace_asaas_residual_wallet_return_hash(p.allocation)
   AND o.provider='asaas' AND o.status='confirmed' AND o.claimed_at IS NOT NULL AND o.reconciled_at IS NOT NULL
   AND o.account_fingerprint=j.host_account_fingerprint AND o.provider_transfer_id=j.original_provider_transfer_id AND o.amount_cents=j.amount_cents
   AND o.request->>'version'=p.basis->>'version' AND o.request->>'destination'=j.request#>>'{seller,walletId}'
   AND j.id='awresreturn_'||marketplace_asaas_residual_wallet_return_hash(jsonb_build_array(j.refund_plan_id,j.residual_operation_id))
   AND jsonb_typeof(j.request)='object' AND j.request->>'version'='2' AND j.request->>'kind'='authorized_wallet_return'
   AND j.request->>'provider'='asaas' AND j.request->>'currency'='BRL' AND j.request->>'environment'=j.environment
   AND j.request->>'requestHash'=j.request_hash AND j.request->>'reference'=j.reference
   AND marketplace_asaas_residual_wallet_return_hash(j.request-'requestHash'-'reference')=j.request_hash
   AND j.request->>'fundingPlanId'=j.funding_plan_id AND j.request->>'refundPlanId'=j.refund_plan_id AND j.request->>'returnId'=r.return_id
   AND j.request->>'instructionsHash'=f.instructions_hash AND j.request->>'allocationHash'=r.allocation_hash AND j.request->'capture'=f.budget->'capture'
   AND j.request->'host'=p.basis#>'{asaasFunding,host}' AND j.request#>>'{host,merchantId}'=j.host_merchant_id
   AND j.request#>>'{host,accountFingerprint}'=j.host_account_fingerprint AND j.request#>>'{seller,merchantId}'=j.seller_merchant_id
   AND j.request#>>'{seller,accountFingerprint}'=j.seller_account_fingerprint AND j.request#>>'{seller,walletId}'<>j.request#>>'{host,walletId}'
   AND j.request#>>'{authorization,actorId}'=j.actor_id AND j.request#>>'{authorization,sellerMerchantId}'=j.seller_merchant_id
   AND j.request#>>'{originalPayout,id}'=j.residual_operation_id AND j.request#>>'{originalPayout,providerTransferId}'=j.original_provider_transfer_id
   AND j.request#>>'{originalPayout,reference}'=o.reference AND j.request#>'{originalPayout,amountCents}'=to_jsonb(j.amount_cents)
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocation->'merchantDebits') d WHERE d->>'merchantId'=j.seller_merchant_id AND (d->>'amountCents')::bigint>0)
   AND j.request->'amountCents'=to_jsonb(j.amount_cents) AND j.request->'residual'=jsonb_build_object(
     'planId',p.id,'operationId',o.id,'generation',1,'version',p.basis->'version','basisHash',p.basis_hash,'allocationHash',p.allocation_hash,
     'outboundRequestHash',o.request_hash,'previousRefunds',prefix,'hostRetainedCents',CASE WHEN p.basis->>'version'='7' THEN p.allocation->'hostRetainedCents' ELSE '0'::jsonb END,
     'platformRetainedCents',p.allocation->'platformRetainedCents','refundedCents',p.allocation->'refundedCents')
   AND EXISTS(SELECT 1 FROM payment_intents pi WHERE pi.id=f.payment_intent_id AND pi.merchant_id=f.host_merchant_id AND pi.method=j.request->>'paymentMethod')
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') a
     WHERE a->>'merchantId'=j.seller_merchant_id AND a->>'walletId'=j.request#>>'{seller,walletId}' AND a->>'accountFingerprint'=j.seller_account_fingerprint),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- Only the V2 certificate may activate the single reserved successor. The
-- existing V1/Stripe activation body is preserved verbatim below this dispatch.
CREATE FUNCTION marketplace_asaas_residual_wallet_return_activation_valid(r marketplace_refund_plans,o marketplace_refund_operations)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE f marketplace_funding_plans; pi payment_intents; j marketplace_asaas_residual_wallet_returns; entry jsonb;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id AND host_merchant_id=r.host_merchant_id;
 SELECT * INTO pi FROM payment_intents WHERE id=f.payment_intent_id AND merchant_id=f.host_merchant_id;
 IF r.status<>'blocked' OR r.block_reason<>'marketplace_refund_asaas_transfer_recovery_unavailable'
   OR f.payment_intent_id IS NULL OR pi.id IS NULL OR f.provider<>'asaas' OR f.status<>'held' OR pi.status<>'approved'
   OR pi.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR pi.amount_cents<>f.amount_cents OR pi.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR o.refund_plan_id IS DISTINCT FROM r.id OR o.status<>'planned' OR o.provider<>f.provider OR o.account_fingerprint<>f.account_fingerprint
   OR o.request->>'kind' IS DISTINCT FROM 'refund' OR o.request->>'provider' IS DISTINCT FROM f.provider
   OR o.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id OR o.request->>'sourceId' IS DISTINCT FROM f.provider_payment_id
   OR o.request->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint OR o.request->>'environment' IS DISTINCT FROM f.environment
   OR o.request->>'currency' IS DISTINCT FROM 'BRL' OR o.request->'amountCents' IS DISTINCT FROM to_jsonb(r.amount_cents)
   OR o.request->'paymentAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents) OR o.request->'asaasCapture' IS DISTINCT FROM f.budget->'capture'
   OR o.request->>'requestHash' IS DISTINCT FROM o.request_hash OR o.request->>'reference' IS DISTINCT FROM o.reference
   OR o.reference IS DISTINCT FROM 'mrefund_'||marketplace_asaas_residual_wallet_return_hash(jsonb_build_array(r.host_merchant_id,r.return_id))
   OR marketplace_asaas_residual_wallet_return_hash(o.request-'requestHash') IS DISTINCT FROM o.request_hash
   OR o.request ? 'asaasWalletReturns' OR o.request ? 'fundingContributions' OR o.request ? 'transfer'
   OR o.request ? 'stripeSourceFunding' OR o.request ? 'stripeSourceRefund'
   OR jsonb_typeof(o.request->'asaasResidualWalletReturns') IS DISTINCT FROM 'array'
   OR jsonb_array_length(o.request->'asaasResidualWalletReturns')<>1
   OR NOT marketplace_asaas_post_residual_refund_admission_valid(r.id) THEN RETURN false; END IF;
 entry:=o.request#>'{asaasResidualWalletReturns,0}';
 SELECT * INTO j FROM marketplace_asaas_residual_wallet_returns WHERE id=entry->>'id'
   AND refund_plan_id=r.id AND funding_plan_id=r.funding_plan_id AND host_merchant_id=r.host_merchant_id AND status='returned';
 RETURN COALESCE(j.id IS NOT NULL AND marketplace_asaas_residual_wallet_return_certificate_valid(j.id)
   AND o.request->'previousRefunds'=j.request#>'{residual,previousRefunds}'
   AND o.request->'asaasResidualWalletReturns'=jsonb_build_array(jsonb_build_object('id',j.id,'residualPlanId',j.residual_plan_id,
     'residualOperationId',j.residual_operation_id,'certificateHash',j.certificate_hash,'request',j.request,'proof',j.proof)),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
DO $$ DECLARE definition text; insertion text; location integer; BEGIN
 definition:=pg_get_functiondef('marketplace_refund_funding_activation_valid(marketplace_refund_plans,marketplace_refund_operations)'::regprocedure);
 insertion:=$branch$
 IF o.request ? 'asaasResidualWalletReturns' THEN
   RETURN marketplace_asaas_residual_wallet_return_activation_valid(r,o);
 END IF;
$branch$;
 location:=strpos(definition,'BEGIN');IF location=0 THEN RAISE EXCEPTION 'asaas_refund_activation_guard_missing';END IF;
 definition:=substring(definition FROM 1 FOR location+4)||insertion||substring(definition FROM location+5);EXECUTE definition;
END $$;

CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_proof_valid(j marketplace_asaas_residual_wallet_returns)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT COALESCE(
  EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_residual_confirmed_'||j.residual_operation_id
    AND e.event_type='marketplace.residual.confirmed' AND e.merchant_id=j.host_merchant_id AND e.causation_id=j.residual_operation_id
    AND e.payload#>'{asaas_proof,hostDebit}'=j.proof->'originalHostDebit' AND e.payload#>'{asaas_proof,sellerCredit}'=j.proof->'originalSellerCredit')
  AND jsonb_typeof(j.proof)='object' AND j.proof->>'version'='1' AND j.proof->>'kind'='authorized_wallet_return'
  AND j.proof->>'association'='local_immutable_authorization' AND j.proof->>'requestHash'=j.request_hash
  AND j.proof->>'authorizationId'=j.request->'authorization'->>'id' AND j.proof->>'reference'=j.reference
  AND j.proof->>'originalProviderTransferId'=j.original_provider_transfer_id AND j.proof->>'providerTransferId'=j.provider_return_transfer_id
  AND j.proof->>'hostAccountFingerprint'=j.host_account_fingerprint AND j.proof->>'sellerAccountFingerprint'=j.seller_account_fingerprint
  AND j.proof->>'hostWalletId'=j.request->'host'->>'walletId' AND j.proof->>'sellerWalletId'=j.request->'seller'->>'walletId'
  AND (j.proof->>'amountCents')::integer=j.amount_cents AND (j.proof->>'observedAt')::timestamptz(3)=j.observed_at
  AND j.certificate_hash=marketplace_asaas_residual_wallet_return_hash(jsonb_build_object('request',j.request,'proof',j.proof))
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

CREATE FUNCTION marketplace_asaas_post_residual_refund_admission_valid(refund_id text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE f marketplace_funding_plans; r marketplace_refund_plans; p marketplace_residual_plans; pi payment_intents; prefix jsonb;
 b jsonb; d jsonb; remaining jsonb; account jsonb; seller_count integer:=0; merchant_total bigint:=0; platform_debit bigint; retained bigint;
BEGIN
 SELECT * INTO r FROM marketplace_refund_plans WHERE id=refund_id;SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id AND host_merchant_id=r.host_merchant_id;
 SELECT * INTO pi FROM payment_intents WHERE id=f.payment_intent_id AND merchant_id=f.host_merchant_id;
 SELECT * INTO p FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id;
 IF f.provider<>'asaas' OR f.status<>'held' OR pi.status<>'approved' OR pi.method NOT IN ('pix','card') OR pi.provider_payment_id<>f.provider_payment_id
   OR p.id IS NULL OR p.status<>'completed' OR p.generation<>1 OR p.held_reason IS NOT NULL OR p.basis->>'version' NOT IN ('5','7')
   OR (SELECT count(*) FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id)<>1
   OR NOT marketplace_asaas_residual_evidence_valid(p.id)
   OR r.status NOT IN ('blocked','prepared','submitted','confirmed') OR r.block_reason<>'marketplace_refund_asaas_transfer_recovery_unavailable'
   OR marketplace_asaas_residual_wallet_return_hash(r.allocation)<>r.allocation_hash
   OR r.allocation->'amountCents'<>to_jsonb(r.amount_cents) OR jsonb_array_length(r.allocation->'requiredContributions')<>0
   OR (r.allocation->>'cumulativeRefundCents')::bigint<>(p.allocation->>'refundedCents')::bigint+r.amount_cents
   OR (r.allocation->>'cumulativeRefundCents')::bigint>f.net_amount_cents
   OR NOT EXISTS(SELECT 1 FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id AND purchased_at IS NOT NULL AND chargeback_at IS NULL)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals v JOIN marketplace_refund_plans rr ON rr.id=v.refund_plan_id WHERE rr.funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND (status<>'confirmed' OR claimed_at IS NULL OR reconciled_at IS NULL OR provider_transfer_id IS NULL))
   THEN RETURN false;END IF;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',rf.id,'returnId',rf.return_id,'allocationHash',rf.allocation_hash,
   'requestHash',o.request_hash,'providerOperationId',o.provider_operation_id,'amountCents',rf.amount_cents) ORDER BY (rf.allocation->>'cumulativeRefundCents')::bigint)
   INTO prefix FROM marketplace_refund_plans rf JOIN marketplace_refund_operations o ON o.refund_plan_id=rf.id
   WHERE rf.funding_plan_id=f.payment_intent_id AND rf.id<>r.id AND rf.status='confirmed' AND o.status='confirmed';
 IF prefix IS DISTINCT FROM p.basis->'refunds' OR (SELECT count(*) FROM marketplace_refund_plans WHERE funding_plan_id=f.payment_intent_id)<>jsonb_array_length(prefix)+1
   OR EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE funding_plan_id=f.payment_intent_id AND id<>r.id AND status<>'confirmed') THEN RETURN false;END IF;
 IF EXISTS(SELECT 1 FROM returns rt WHERE rt.merchant_id=f.host_merchant_id
   AND (rt.order_id IN(f.provider_payment_id,pi.commerce_order_id) OR rt.order_id IN(SELECT id FROM completed_orders WHERE merchant_id=f.host_merchant_id AND external_order_id IN(f.provider_payment_id,pi.commerce_order_id)))
   AND rt.status NOT IN('REJECTED','CANCELLED') AND rt.id<>r.return_id AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prefix) z WHERE z->>'returnId'=rt.id)) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM returns rt WHERE rt.id=r.return_id AND rt.merchant_id=f.host_merchant_id
   AND (r.status IN('blocked','prepared') AND rt.status='INSPECTED_PASS' OR r.status='submitted' AND rt.status='REFUND_PROCESSING' OR r.status='confirmed' AND rt.status='REFUND_COMPLETED')) THEN RETURN false;END IF;
 platform_debit:=(r.allocation->>'platformDebitCents')::bigint;
 retained:=CASE WHEN p.basis->>'version'='7' THEN (p.allocation->>'hostRetainedCents')::bigint ELSE 0 END;
 IF platform_debit<0 OR platform_debit>(p.allocation->>'platformRetainedCents')::bigint OR
   (r.allocation->>'platformRemainingCents')::bigint<>(p.allocation->>'platformRetainedCents')::bigint-platform_debit
   OR jsonb_array_length(r.allocation->'merchantDebits')<>jsonb_array_length(p.allocation->'beneficiaries')
   OR (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(r.allocation->'merchantDebits'))<>jsonb_array_length(p.allocation->'beneficiaries')
   OR jsonb_array_length(r.allocation->'remainingBeneficiaries')<>jsonb_array_length(p.allocation->'beneficiaries') THEN RETURN false;END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   SELECT value INTO d FROM jsonb_array_elements(r.allocation->'merchantDebits') WHERE value->>'merchantId'=b->>'merchantId';
   SELECT value INTO remaining FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') WHERE value->>'merchantId'=b->>'merchantId';
   IF d IS NULL OR remaining IS NULL OR (d->>'amountCents')::bigint<0 OR (d->>'amountCents')::bigint>(b->>'amountCents')::bigint
     OR (remaining->>'amountCents')::bigint<>(b->>'amountCents')::bigint-(d->>'amountCents')::bigint
     OR remaining->'providerFeeCents' IS DISTINCT FROM b->'providerFeeCents' THEN RETURN false;END IF;
   merchant_total:=merchant_total+(d->>'amountCents')::bigint;
   IF (d->>'amountCents')::bigint>0 THEN
     IF b->>'merchantId'=f.host_merchant_id AND b->>'destination'=p.basis#>>'{asaasFunding,host,walletId}' AND p.basis->>'version'='7' THEN
       IF (d->>'amountCents')::bigint>retained THEN RETURN false;END IF;
     ELSE
       seller_count:=seller_count+1;
       IF b->>'merchantId'=f.host_merchant_id OR NOT EXISTS(SELECT 1 FROM marketplace_residual_operations o
         WHERE o.residual_plan_id=p.id AND o.beneficiary_merchant_id=b->>'merchantId' AND o.provider='asaas' AND o.status='confirmed'
           AND o.request->>'destination'=b->>'destination' AND o.amount_cents=(b->>'amountCents')::bigint) THEN RETURN false;END IF;
     END IF;
   END IF;
   IF EXISTS(SELECT 1 FROM marketplace_seller_debts WHERE seller_merchant_id=b->>'merchantId' AND status IN('outstanding','deducted'))
     OR EXISTS(SELECT 1 FROM marketplace_host_debts WHERE host_merchant_id=b->>'merchantId' AND status IN('outstanding','deducted')) THEN RETURN false;END IF;
 END LOOP;
 FOR account IN SELECT value FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') LOOP
   IF NOT EXISTS(SELECT 1 FROM merchant_payment_connections c WHERE c.merchant_id=account->>'merchantId' AND c.provider='asaas' AND c.environment=f.environment
     AND c.wallet_id=account->>'walletId' AND c.status='active' AND c.payouts_enabled AND c.secret_cipher IS NOT NULL
     AND marketplace_contribution_hash(to_jsonb(c.secret_cipher))=account->>'secretCipherHash') THEN RETURN false;END IF;
 END LOOP;
 RETURN seller_count=1 AND merchant_total=(r.allocation->>'merchantDebitCents')::bigint AND merchant_total+platform_debit=r.amount_cents;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_immutable'; END IF;
 IF NOT marketplace_asaas_residual_wallet_return_request_valid(NEW) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_request_invalid'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'claimed' OR NEW.version<>0 OR NEW.proof IS NOT NULL OR NEW.submitted_at IS NOT NULL
    OR NOT EXISTS (SELECT 1 FROM merchant_users u WHERE u.id=NEW.actor_id AND u.merchant_id=NEW.seller_merchant_id AND u.role IN ('owner','admin') AND u.disabled_at IS NULL)
    OR NOT marketplace_asaas_post_residual_refund_admission_valid(NEW.refund_plan_id)
    OR NOT EXISTS (SELECT 1 FROM marketplace_refund_plans r WHERE r.id=NEW.refund_plan_id AND r.status='blocked' AND r.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable') THEN
    RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_initial_state_invalid';
  END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['status','version','submitted_at','observed_at','proof','certificate_hash','provider_return_transfer_id']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','submitted_at','observed_at','proof','certificate_hash','provider_return_transfer_id']) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_identity_immutable'; END IF;
  IF OLD.status IN ('returned','failed') THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_terminal'; END IF;
  IF OLD.status='claimed' AND (NOT marketplace_asaas_post_residual_refund_admission_valid(NEW.refund_plan_id)
    OR NOT EXISTS(SELECT 1 FROM merchant_users u WHERE u.id=NEW.actor_id AND u.merchant_id=NEW.seller_merchant_id AND u.role IN ('owner','admin') AND u.disabled_at IS NULL)) THEN
    RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_admission_changed'; END IF;
  IF NEW.version<>OLD.version+1 OR (OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at)
    OR (OLD.provider_return_transfer_id IS NOT NULL AND NEW.provider_return_transfer_id IS DISTINCT FROM OLD.provider_return_transfer_id) THEN
    RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_claim_invalid';
  END IF;
  IF NOT ((OLD.status='claimed' AND NEW.status='unknown' AND NEW.submitted_at IS NOT NULL AND NEW.provider_return_transfer_id IS NULL)
    OR (OLD.status IN ('unknown','pending') AND NEW.status IN ('unknown','pending','returned','failed'))) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_transition_invalid'; END IF;
 END IF;
 IF NEW.status='returned' AND NOT marketplace_asaas_residual_wallet_return_proof_valid(NEW) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_proof_invalid'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_guard ON marketplace_asaas_residual_wallet_returns;
CREATE TRIGGER marketplace_asaas_residual_wallet_return_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_asaas_residual_wallet_returns FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_receipt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j marketplace_asaas_residual_wallet_returns; entry jsonb; expected_account text;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_receipt_immutable'; END IF;
 SELECT * INTO j FROM marketplace_asaas_residual_wallet_returns WHERE id=NEW.journal_id;
 IF j.status<>'returned' OR NOT marketplace_asaas_residual_wallet_return_proof_valid(j) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_receipt_parent_invalid'; END IF;
 entry:=j.proof->CASE NEW.kind WHEN 'original_host_debit' THEN 'originalHostDebit' WHEN 'original_seller_credit' THEN 'originalSellerCredit' WHEN 'seller_return_debit' THEN 'sellerReturnDebit' ELSE 'hostReturnCredit' END;
 expected_account:=CASE WHEN NEW.kind IN ('original_host_debit','host_return_credit') THEN j.host_account_fingerprint ELSE j.seller_account_fingerprint END;
 IF NEW.receipt_id IS DISTINCT FROM entry->>'id' OR NEW.account_fingerprint IS DISTINCT FROM expected_account OR NEW.transfer_id IS DISTINCT FROM entry->>'transferId'
   OR NEW.amount_cents IS DISTINCT FROM (entry->>'amountCents')::integer OR NEW.date IS DISTINCT FROM (entry->>'date')::date THEN
   RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_receipt_mismatch';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_receipt_guard ON marketplace_asaas_residual_wallet_return_receipts;
CREATE TRIGGER marketplace_asaas_residual_wallet_return_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_asaas_residual_wallet_return_receipts FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_receipt_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.event_type='marketplace.asaas_residual_wallet_return.returned' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_outbox_immutable'; END IF;
  IF ROW(NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,
    NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload) IS DISTINCT FROM
    ROW(OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,
    OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload) THEN
   RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_outbox_immutable';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_outbox_guard ON outbox_messages;
CREATE TRIGGER marketplace_asaas_residual_wallet_return_outbox_guard BEFORE UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_outbox_guard();

CREATE OR REPLACE FUNCTION marketplace_asaas_residual_wallet_return_complete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE journal_id text; j marketplace_asaas_residual_wallet_returns; expected jsonb;
BEGIN
 IF TG_TABLE_NAME='marketplace_asaas_residual_wallet_returns' THEN journal_id:=NEW.id;
 ELSIF TG_TABLE_NAME='marketplace_asaas_residual_wallet_return_receipts' THEN journal_id:=NEW.journal_id;
 ELSE
  IF NEW.event_type<>'marketplace.asaas_residual_wallet_return.returned' THEN RETURN NEW; END IF;
  journal_id:=NEW.payload->>'journal_id';
 END IF;
 SELECT * INTO j FROM marketplace_asaas_residual_wallet_returns WHERE id=journal_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_orphan_evidence'; END IF;
 IF j.status='returned' THEN
  expected:=jsonb_build_object('journal_id',j.id,'funding_plan_id',j.funding_plan_id,'refund_plan_id',j.refund_plan_id,'residual_plan_id',j.residual_plan_id,'residual_operation_id',j.residual_operation_id,'amount_cents',j.amount_cents,'certificate_hash',j.certificate_hash);
  IF NOT marketplace_asaas_residual_wallet_return_proof_valid(j) OR (SELECT count(*) FROM marketplace_asaas_residual_wallet_return_receipts r WHERE r.journal_id=j.id)<>4
    OR NOT EXISTS (SELECT 1 FROM outbox_messages o WHERE o.event_id='marketplace_asaas_residual_wallet_return_'||j.id AND o.event_type='marketplace.asaas_residual_wallet_return.returned'
      AND o.schema_version=1 AND o.merchant_id=j.host_merchant_id AND o.producer='marketplace' AND o.correlation_id=j.funding_plan_id AND o.causation_id=j.id
      AND o.occurred_at=(j.observed_at AT TIME ZONE 'UTC') AND o.payload=expected) THEN RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_evidence_incomplete'; END IF;
 ELSIF EXISTS (SELECT 1 FROM marketplace_asaas_residual_wallet_return_receipts r WHERE r.journal_id=j.id)
   OR EXISTS (SELECT 1 FROM outbox_messages o WHERE o.event_type='marketplace.asaas_residual_wallet_return.returned' AND o.payload->>'journal_id'=j.id) THEN
  RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_unconfirmed_evidence';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_complete_guard ON marketplace_asaas_residual_wallet_returns;
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_wallet_return_complete_guard AFTER INSERT OR UPDATE ON marketplace_asaas_residual_wallet_returns
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_complete_guard();
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_receipt_complete_guard ON marketplace_asaas_residual_wallet_return_receipts;
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_wallet_return_receipt_complete_guard AFTER INSERT ON marketplace_asaas_residual_wallet_return_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_complete_guard();
DROP TRIGGER IF EXISTS marketplace_asaas_residual_wallet_return_outbox_complete_guard ON outbox_messages;
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_wallet_return_outbox_complete_guard AFTER INSERT OR UPDATE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_complete_guard();

CREATE FUNCTION marketplace_asaas_residual_wallet_return_certificate_valid(journal_id text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE j marketplace_asaas_residual_wallet_returns; expected jsonb;
BEGIN
 SELECT * INTO j FROM marketplace_asaas_residual_wallet_returns WHERE id=journal_id;
 IF j.id IS NULL OR j.status<>'returned' OR NOT marketplace_asaas_post_residual_refund_allocation_valid(j.refund_plan_id) OR NOT marketplace_asaas_residual_wallet_return_request_valid(j) OR NOT marketplace_asaas_residual_wallet_return_proof_valid(j) THEN RETURN false;END IF;
 expected:=jsonb_build_object('journal_id',j.id,'funding_plan_id',j.funding_plan_id,'refund_plan_id',j.refund_plan_id,
   'residual_plan_id',j.residual_plan_id,'residual_operation_id',j.residual_operation_id,'amount_cents',j.amount_cents,'certificate_hash',j.certificate_hash);
 RETURN (SELECT count(*) FROM marketplace_asaas_residual_wallet_return_receipts rr WHERE rr.journal_id=j.id)=4
   AND EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_asaas_residual_wallet_return_'||j.id
     AND e.event_type='marketplace.asaas_residual_wallet_return.returned' AND e.schema_version=1 AND e.merchant_id=j.host_merchant_id
     AND e.correlation_id=j.funding_plan_id AND e.causation_id=j.id AND e.producer='marketplace'
     AND e.occurred_at=(j.observed_at AT TIME ZONE 'UTC') AND e.payload=expected);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION marketplace_asaas_residual_wallet_return_generation_fence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.generation>1 AND EXISTS(SELECT 1 FROM marketplace_residual_plans p JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id
   WHERE p.funding_plan_id=NEW.funding_plan_id AND f.provider='asaas' AND p.generation=1 AND p.basis->>'version' IN('5','7')) THEN
   RAISE EXCEPTION 'marketplace_asaas_post_residual_next_generation_unavailable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_residual_wallet_return_generation_fence BEFORE INSERT OR UPDATE ON marketplace_residual_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_generation_fence();

-- Reserve new native transfer/receipt identities globally. The two original
-- debit/credit identities keep their immutable residual owner; only the NEW
-- return can acquire the new owner, so this is never source replenishment.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE conrelid='marketplace_asaas_residual_native_identity_claims'::regclass AND contype='c' LOOP
   IF c.definition LIKE '%owner_kind%' THEN EXECUTE format('ALTER TABLE marketplace_asaas_residual_native_identity_claims DROP CONSTRAINT %I',c.conname);END IF;
 END LOOP;
 ALTER TABLE marketplace_asaas_residual_native_identity_claims ADD CONSTRAINT marketplace_asaas_native_owner_phase45_valid
   CHECK(owner_kind IN('payout','wallet_return','residual','host_retention','residual_wallet_return'));
 ALTER TABLE marketplace_asaas_residual_native_identity_claims ADD CONSTRAINT marketplace_asaas_native_event_phase45_valid
   CHECK((owner_kind IN('residual','host_retention','residual_wallet_return') AND event_id IS NOT NULL) OR(owner_kind IN('payout','wallet_return') AND event_id IS NULL));
END $$;
DO $$ DECLARE definition text; insertion text; location integer; BEGIN
 definition:=pg_get_functiondef('marketplace_asaas_residual_native_claim_guard()'::regprocedure);
 insertion:=$branch$
 IF NEW.owner_kind='residual_wallet_return' THEN
   IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM marketplace_asaas_residual_wallet_returns j JOIN outbox_messages e ON e.event_id=NEW.event_id
     WHERE j.id=NEW.owner_id AND j.status='returned' AND e.event_type='marketplace.asaas_residual_wallet_return.returned'
       AND e.event_id='marketplace_asaas_residual_wallet_return_'||j.id AND e.causation_id=j.id
       AND marketplace_asaas_residual_wallet_return_certificate_valid(j.id)
       AND (NEW.kind='transfer' AND NEW.native_id=j.provider_return_transfer_id AND NEW.account_fingerprint IN(j.host_account_fingerprint,j.seller_account_fingerprint)
         OR NEW.kind='receipt' AND EXISTS(SELECT 1 FROM marketplace_asaas_residual_wallet_return_receipts rr WHERE rr.journal_id=j.id
           AND rr.kind IN('seller_return_debit','host_return_credit') AND rr.receipt_id=NEW.native_id AND rr.account_fingerprint=NEW.account_fingerprint))) THEN
     RAISE EXCEPTION 'marketplace_asaas_residual_wallet_return_native_identity_unbound';END IF;
   RETURN NEW;
 END IF;
$branch$;
 location:=strpos(definition,'BEGIN');IF location=0 THEN RAISE EXCEPTION 'asaas_native_guard_missing';END IF;
 definition:=substring(definition FROM 1 FOR location+4)||insertion||substring(definition FROM location+5);EXECUTE definition;
END $$;
CREATE FUNCTION marketplace_asaas_residual_wallet_return_capture_native_identities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j marketplace_asaas_residual_wallet_returns; receipt jsonb;
BEGIN
 IF NEW.event_type<>'marketplace.asaas_residual_wallet_return.returned' THEN RETURN NEW;END IF;
 SELECT * INTO j FROM marketplace_asaas_residual_wallet_returns WHERE id=NEW.causation_id;
 PERFORM marketplace_asaas_residual_native_claim('transfer',j.provider_return_transfer_id,j.host_account_fingerprint,'residual_wallet_return',j.id,NEW.event_id);
 PERFORM marketplace_asaas_residual_native_claim('transfer',j.provider_return_transfer_id,j.seller_account_fingerprint,'residual_wallet_return',j.id,NEW.event_id);
 PERFORM marketplace_asaas_residual_native_claim('receipt',j.proof#>>'{sellerReturnDebit,id}',j.seller_account_fingerprint,'residual_wallet_return',j.id,NEW.event_id);
 PERFORM marketplace_asaas_residual_native_claim('receipt',j.proof#>>'{hostReturnCredit,id}',j.host_account_fingerprint,'residual_wallet_return',j.id,NEW.event_id);
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_residual_wallet_return_native_identities AFTER INSERT ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_wallet_return_capture_native_identities();

-- Pure historical conservation. No debt, connection, active status or order
-- lock participates; immutable receipt facts survive a later operational hold.
CREATE FUNCTION marketplace_asaas_post_residual_refund_allocation_valid(refund_id text)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE f marketplace_funding_plans; r marketplace_refund_plans; p marketplace_residual_plans;
 b jsonb; d jsonb; remaining jsonb; seller_count integer:=0; merchant_total bigint:=0; platform_debit bigint; retained bigint;
BEGIN
 SELECT * INTO r FROM marketplace_refund_plans WHERE id=refund_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=r.funding_plan_id AND host_merchant_id=r.host_merchant_id;
 SELECT * INTO p FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id AND generation=1;
 IF r.id IS NULL OR f.provider<>'asaas' OR p.id IS NULL OR p.host_merchant_id<>r.host_merchant_id OR p.basis->>'version' NOT IN('5','7')
   OR NOT marketplace_asaas_residual_evidence_valid(p.id) OR marketplace_asaas_residual_wallet_return_hash(r.allocation)<>r.allocation_hash
   OR r.allocation->'amountCents'<>to_jsonb(r.amount_cents) OR jsonb_array_length(r.allocation->'requiredContributions')<>0
   OR (r.allocation->>'cumulativeRefundCents')::bigint<>(p.allocation->>'refundedCents')::bigint+r.amount_cents
   OR (r.allocation->>'cumulativeRefundCents')::bigint>f.net_amount_cents THEN RETURN false;END IF;
 platform_debit:=(r.allocation->>'platformDebitCents')::bigint;
 retained:=CASE WHEN p.basis->>'version'='7' THEN (p.allocation->>'hostRetainedCents')::bigint ELSE 0 END;
 IF platform_debit<0 OR platform_debit>(p.allocation->>'platformRetainedCents')::bigint OR
   (r.allocation->>'platformRemainingCents')::bigint<>(p.allocation->>'platformRetainedCents')::bigint-platform_debit
   OR jsonb_array_length(r.allocation->'merchantDebits')<>jsonb_array_length(p.allocation->'beneficiaries')
   OR (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(r.allocation->'merchantDebits'))<>jsonb_array_length(p.allocation->'beneficiaries')
   OR jsonb_array_length(r.allocation->'remainingBeneficiaries')<>jsonb_array_length(p.allocation->'beneficiaries') THEN RETURN false;END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   SELECT value INTO d FROM jsonb_array_elements(r.allocation->'merchantDebits') WHERE value->>'merchantId'=b->>'merchantId';
   SELECT value INTO remaining FROM jsonb_array_elements(r.allocation->'remainingBeneficiaries') WHERE value->>'merchantId'=b->>'merchantId';
   IF d IS NULL OR remaining IS NULL OR (d->>'amountCents')::bigint<0 OR (d->>'amountCents')::bigint>(b->>'amountCents')::bigint
     OR (remaining->>'amountCents')::bigint<>(b->>'amountCents')::bigint-(d->>'amountCents')::bigint
     OR remaining->'providerFeeCents' IS DISTINCT FROM b->'providerFeeCents' THEN RETURN false;END IF;
   merchant_total:=merchant_total+(d->>'amountCents')::bigint;
   IF (d->>'amountCents')::bigint>0 THEN
     IF b->>'merchantId'=f.host_merchant_id AND b->>'destination'=p.basis#>>'{asaasFunding,host,walletId}' AND p.basis->>'version'='7' THEN
       IF (d->>'amountCents')::bigint>retained THEN RETURN false;END IF;
     ELSE
       seller_count:=seller_count+1;
       IF b->>'merchantId'=f.host_merchant_id OR NOT EXISTS(SELECT 1 FROM marketplace_residual_operations o
         WHERE o.residual_plan_id=p.id AND o.beneficiary_merchant_id=b->>'merchantId' AND o.provider='asaas' AND o.status='confirmed'
           AND o.request->>'destination'=b->>'destination' AND o.amount_cents=(b->>'amountCents')::bigint) THEN RETURN false;END IF;
     END IF;
   END IF;
 END LOOP;

 RETURN seller_count=1 AND merchant_total=(r.allocation->>'merchantDebitCents')::bigint AND merchant_total+platform_debit=r.amount_cents;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
