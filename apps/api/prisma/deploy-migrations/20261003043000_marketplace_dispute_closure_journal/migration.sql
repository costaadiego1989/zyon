-- Append-only account ledger snapshots, no debt/hold
-- release, no refund credit, no transfer admission and no financial PSP writes.
CREATE TABLE IF NOT EXISTS marketplace_dispute_ledger_entries (
 id text PRIMARY KEY,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL,
 provider text NOT NULL CHECK (provider='stripe'),
 environment text NOT NULL CHECK (environment IN ('test','live')),
 account_fingerprint text NOT NULL CHECK (account_fingerprint ~ '^[a-f0-9]{64}$'),
 provider_dispute_id text NOT NULL CHECK (provider_dispute_id ~ '^(dp|du)_[A-Za-z0-9_]+$'),
 provider_balance_transaction_id text NOT NULL CHECK (provider_balance_transaction_id ~ '^txn_[A-Za-z0-9_]+$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 request jsonb NOT NULL,
 proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
 proof jsonb NOT NULL,
 entry jsonb NOT NULL,
 entry_hash text NOT NULL CHECK (entry_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT marketplace_dispute_ledger_receipt_unique UNIQUE(provider,environment,account_fingerprint,provider_balance_transaction_id),
 CONSTRAINT marketplace_dispute_ledger_entry_valid CHECK (COALESCE(
   jsonb_typeof(entry)='object' AND entry->>'balanceTransactionId'=provider_balance_transaction_id
   AND entry->>'kind' IN ('principal_withdrawal','principal_reinstatement')
   AND jsonb_typeof(entry->'amountCents')='number' AND jsonb_typeof(entry->'feeCents')='number' AND jsonb_typeof(entry->'netCents')='number'
   AND abs((entry->>'amountCents')::numeric)<=2147483647 AND abs((entry->>'feeCents')::numeric)<=2147483647
   AND abs((entry->>'netCents')::numeric)<=2147483647
   AND trunc((entry->>'amountCents')::numeric)=(entry->>'amountCents')::numeric
   AND trunc((entry->>'feeCents')::numeric)=(entry->>'feeCents')::numeric
   AND trunc((entry->>'netCents')::numeric)=(entry->>'netCents')::numeric
   AND (entry->>'amountCents')::numeric-(entry->>'feeCents')::numeric=(entry->>'netCents')::numeric
   AND ((entry->>'kind'='principal_withdrawal' AND (entry->>'amountCents')::numeric<0 AND (entry->>'feeCents')::numeric>=0)
     OR (entry->>'kind'='principal_reinstatement' AND (entry->>'amountCents')::numeric>0 AND (entry->>'feeCents')::numeric<=0)),false))
);
CREATE INDEX IF NOT EXISTS marketplace_dispute_ledger_funding_idx
 ON marketplace_dispute_ledger_entries(funding_plan_id,provider_dispute_id);

CREATE TABLE IF NOT EXISTS marketplace_dispute_closure_snapshots (
 id text PRIMARY KEY,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL,
 provider_dispute_id text NOT NULL CHECK (provider_dispute_id ~ '^(dp|du)_[A-Za-z0-9_]+$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 request jsonb NOT NULL,
 proof_hash text NOT NULL CHECK (proof_hash ~ '^[a-f0-9]{64}$'),
 proof jsonb NOT NULL,
 fee_allocation jsonb NOT NULL,
 observed_at timestamptz(3) NOT NULL,
 created_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT marketplace_dispute_closure_snapshot_unique UNIQUE(host_merchant_id,funding_plan_id,provider_dispute_id,proof_hash),
 CONSTRAINT marketplace_dispute_closure_snapshot_valid CHECK (COALESCE(
   jsonb_typeof(request)='object' AND request->'version'='1'::jsonb AND request->>'provider'='stripe'
   AND request->>'hostMerchantId'=host_merchant_id AND request->>'paymentIntentId'=funding_plan_id
   AND request->>'providerDisputeId'=provider_dispute_id AND request->>'requestHash'=request_hash
   AND request->>'environment' IN ('test','live') AND request->>'currency'='BRL'
   AND request->>'feePolicy'='proportional_seller_sales_v1'
   AND jsonb_typeof(proof)='object' AND proof->'version'='1'::jsonb AND proof->>'requestHash'=request_hash
   AND proof->>'provider'='stripe' AND proof->>'providerDisputeId'=provider_dispute_id
   AND proof->>'status' IN ('won','lost') AND proof->>'currency'='BRL'
   AND proof->>'environment'=request->>'environment' AND proof->>'accountFingerprint'=request->>'accountFingerprint'
   AND proof->>'providerPaymentId'=request->>'providerPaymentId' AND proof->>'sourceId'=request->>'sourceId'
   AND proof->'amountCents'=request->'amountCents' AND jsonb_typeof(proof->'entries')='array'
   AND jsonb_array_length(proof->'entries')=CASE WHEN proof->>'status'='won' THEN 2 ELSE 1 END
   AND jsonb_typeof(fee_allocation)='array',false))
);
CREATE INDEX IF NOT EXISTS marketplace_dispute_closure_funding_idx
 ON marketplace_dispute_closure_snapshots(funding_plan_id,provider_dispute_id,created_at);

CREATE OR REPLACE FUNCTION marketplace_dispute_closure_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_dispute_closure_immutable'; END IF;
 IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'marketplace_dispute_closure_immutable'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_dispute_ledger_immutable_guard ON marketplace_dispute_ledger_entries;
CREATE TRIGGER marketplace_dispute_ledger_immutable_guard BEFORE UPDATE OR DELETE ON marketplace_dispute_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_immutable();
DROP TRIGGER IF EXISTS marketplace_dispute_snapshot_immutable_guard ON marketplace_dispute_closure_snapshots;
CREATE TRIGGER marketplace_dispute_snapshot_immutable_guard BEFORE UPDATE OR DELETE ON marketplace_dispute_closure_snapshots
 FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_immutable();

CREATE OR REPLACE FUNCTION marketplace_dispute_closure_hash(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT encode(sha256(convert_to(marketplace_recovery_canonical(value),'UTF8')),'hex')
$$;

CREATE OR REPLACE FUNCTION marketplace_dispute_fee_allocation(request_body jsonb, fee_total bigint) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 WITH sales AS (
   SELECT value->>'sellerMerchantId' seller, sum((value->>'grossAmountCents')::bigint) gross
   FROM jsonb_array_elements(request_body->'sales') GROUP BY value->>'sellerMerchantId'
 ), bases AS (
   SELECT seller,gross,trunc(fee_total::numeric*gross/sum(gross) OVER())::bigint base,
     mod(fee_total::numeric*gross,sum(gross) OVER()) remainder FROM sales
 ), ranked AS (
   SELECT *,row_number() OVER(ORDER BY remainder DESC,seller COLLATE "C") rank,
     fee_total-sum(base) OVER() remaining FROM bases
 ) SELECT jsonb_agg(jsonb_build_object('sellerMerchantId',seller,'salesCents',gross,
   'feeCents',base+CASE WHEN rank<=remaining THEN 1 ELSE 0 END,'collectionState','uncollected') ORDER BY seller COLLATE "C") FROM ranked
$$;

CREATE OR REPLACE FUNCTION marketplace_dispute_closure_validate(req jsonb, proof_body jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE f RECORD; raw jsonb; expected jsonb; entries jsonb; movement jsonb; orders text[];
  withdrawn bigint:=0; reinstated bigint:=0; fees bigint:=0; net_total bigint:=0;
  amount bigint; fee bigint; net bigint; observed timestamptz;
BEGIN
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=req->>'paymentIntentId';
 IF NOT FOUND OR f.provider_payment_id IS NULL THEN RAISE EXCEPTION 'marketplace_dispute_funding_unproven'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(marketplace_recovery_canonical(jsonb_build_array('marketplace-order',f.host_merchant_id,f.provider_payment_id)),0));
 SELECT fp.*,pay.merchant_id AS payment_merchant,pay.provider_payment_id AS payment_provider,pay.status AS payment_status,
   pay.currency AS payment_currency,pay.amount_cents AS payment_amount,pay.approved_amount_cents,pay.commerce_order_id,pay.session_id,pay.creation,
   ledger.purchased_at,ledger.chargeback_at,ledger.checkout_session_id AS ledger_session
 INTO f FROM marketplace_funding_plans fp JOIN payment_intents pay ON pay.id=fp.payment_intent_id
 JOIN marketplace_order_ledgers ledger ON ledger.host_merchant_id=fp.host_merchant_id AND ledger.order_id=fp.provider_payment_id
 WHERE fp.payment_intent_id=req->>'paymentIntentId' FOR UPDATE OF fp;
 IF NOT FOUND OR f.provider IS DISTINCT FROM 'stripe' OR f.status IS DISTINCT FROM 'held' OR f.funded_at IS NULL OR f.budget IS NULL
   OR f.host_merchant_id IS DISTINCT FROM req->>'hostMerchantId' OR f.payment_merchant IS DISTINCT FROM f.host_merchant_id
   OR f.payment_provider IS DISTINCT FROM f.provider_payment_id OR f.payment_currency IS DISTINCT FROM 'BRL'
   OR f.payment_amount IS DISTINCT FROM f.amount_cents OR f.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR (f.payment_status='approved' OR left(f.payment_status,11)='chargeback_') IS NOT TRUE
   OR f.chargeback_at IS NULL OR f.purchased_at IS NULL OR f.session_id IS DISTINCT FROM f.checkout_session_id OR f.ledger_session IS DISTINCT FROM f.checkout_session_id
   OR f.instructions_hash IS DISTINCT FROM marketplace_dispute_closure_hash(f.instructions)
   OR f.creation#>'{input,marketplaceFunding}' IS DISTINCT FROM f.instructions OR f.creation#>>'{input,provider}' IS DISTINCT FROM 'stripe'
   OR f.creation#>>'{input,providerAccountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR f.creation#>>'{input,merchantId}' IS DISTINCT FROM f.host_merchant_id OR f.creation#>>'{input,intentId}' IS DISTINCT FROM f.payment_intent_id
   OR f.creation#>>'{input,sessionId}' IS DISTINCT FROM f.checkout_session_id
   OR NULLIF(f.creation#>>'{input,stripeConnectAccountId}','') IS NOT NULL OR NULLIF(f.creation#>>'{input,merchantPayoutDestination}','') IS NOT NULL
   OR NULLIF(f.creation#>>'{input,settlementMode}','') IS NOT NULL
   OR f.instructions->>'hostMerchantId' IS DISTINCT FROM f.host_merchant_id OR f.instructions->>'provider' IS DISTINCT FROM 'stripe'
   OR f.instructions->>'environment' IS DISTINCT FROM f.environment OR f.instructions->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint
   OR f.instructions->'amountCents' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>>'{capture,providerPaymentId}' IS DISTINCT FROM f.provider_payment_id OR f.budget#>>'{capture,provider}' IS DISTINCT FROM 'stripe'
   OR f.budget#>>'{capture,environment}' IS DISTINCT FROM f.environment OR f.budget#>>'{capture,accountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR f.budget#>>'{capture,currency}' IS DISTINCT FROM 'BRL' OR f.budget#>'{capture,amountCents}' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>'{capture,providerFeeCents}' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR f.budget#>'{capture,netAmountCents}' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
   OR f.budget->'payoutTotalCents' IS DISTINCT FROM to_jsonb(f.payout_total_cents)
   OR f.budget->'platformRetainedCents' IS DISTINCT FROM to_jsonb(f.platform_retained_cents)
   OR f.amount_cents-f.provider_fee_cents IS DISTINCT FROM f.net_amount_cents
   OR f.payout_total_cents+f.platform_retained_cents IS DISTINCT FROM f.net_amount_cents
   OR jsonb_typeof(f.instructions->'lines') IS DISTINCT FROM 'array' OR jsonb_typeof(f.budget->'beneficiaries') IS DISTINCT FROM 'array'
   THEN RAISE EXCEPTION 'marketplace_dispute_funding_unproven'; END IF;
 SELECT array_agg(order_id) INTO orders FROM (
   SELECT f.provider_payment_id order_id UNION SELECT f.commerce_order_id WHERE f.commerce_order_id IS NOT NULL
   UNION SELECT co.id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND (co.external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR co.session_id=f.session_id)
   UNION SELECT co.external_order_id FROM completed_orders co WHERE co.merchant_id=f.host_merchant_id AND co.external_order_id IS NOT NULL
     AND (co.external_order_id IN(f.provider_payment_id,f.commerce_order_id) OR co.session_id=f.session_id)
 ) identities;
 IF EXISTS(SELECT 1 FROM marketplace_refund_plans WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM returns WHERE merchant_id=f.host_merchant_id AND order_id=ANY(orders) AND status NOT IN ('REJECTED','CANCELLED'))
   OR EXISTS(SELECT 1 FROM marketplace_transfer_reversals rv LEFT JOIN marketplace_payouts po ON po.id=rv.payout_id
     LEFT JOIN marketplace_refund_plans rp ON rp.id=rv.refund_plan_id LEFT JOIN marketplace_residual_operations ro ON ro.id=rv.residual_operation_id
     LEFT JOIN marketplace_residual_plans rg ON rg.id=ro.residual_plan_id
     WHERE po.funding_plan_id=f.payment_intent_id OR rp.funding_plan_id=f.payment_intent_id OR rg.funding_plan_id=f.payment_intent_id)
   OR (SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id) IS DISTINCT FROM
     (SELECT count(*) FROM jsonb_array_elements(f.budget->'beneficiaries') benef WHERE (benef->>'amountCents')::bigint>0)
   OR (SELECT count(DISTINCT beneficiary_merchant_id) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id) IS DISTINCT FROM
     (SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_payouts po WHERE po.funding_plan_id=f.payment_intent_id AND
     (po.provider IS DISTINCT FROM 'stripe' OR po.account_fingerprint IS DISTINCT FROM f.account_fingerprint
      OR po.provider_payment_id IS DISTINCT FROM f.provider_payment_id OR po.currency IS DISTINCT FROM 'BRL'
      OR ((po.status IN ('planned','cancelled') AND po.claimed_at IS NULL AND po.provider_transfer_id IS NULL)
        OR (po.status='confirmed' AND po.claimed_at IS NOT NULL AND po.reconciled_at IS NOT NULL AND po.provider_transfer_id ~ '^tr_[A-Za-z0-9_]+$')) IS NOT TRUE
      OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') benef WHERE benef->>'merchantId'=po.beneficiary_merchant_id
        AND benef->>'destination'=po.destination AND (benef->>'amountCents')::bigint=po.amount_cents)))
   THEN RAISE EXCEPTION 'marketplace_dispute_history_unproven'; END IF;
 raw:=jsonb_build_object('version',1,'hostMerchantId',f.host_merchant_id,'paymentIntentId',f.payment_intent_id,
   'checkoutSessionId',f.checkout_session_id,'instructionsHash',f.instructions_hash,'budgetHash',marketplace_dispute_closure_hash(f.budget),
   'provider','stripe','environment',f.environment,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
   'sourceId',f.budget#>'{capture,sourceId}','captureBalanceTransactionId',f.budget#>'{capture,balanceTransactionId}',
   'captureFeeCents',f.budget#>'{capture,providerFeeCents}','captureNetCents',f.budget#>'{capture,netAmountCents}',
   'providerDisputeId',req->>'providerDisputeId','amountCents',f.amount_cents,'currency','BRL','feePolicy','proportional_seller_sales_v1',
   'sales',(SELECT jsonb_agg(jsonb_build_object('lineItemId',sale->'lineItemId','sellerMerchantId',sale->'sellerMerchantId',
     'grossAmountCents',sale->'grossAmountCents','commissionCents',sale->'commissionCents') ORDER BY (sale->>'lineItemId') COLLATE "C")
     FROM jsonb_array_elements(f.instructions->'lines') sale));
 expected:=raw||jsonb_build_object('requestHash',marketplace_dispute_closure_hash(raw));
 IF req IS DISTINCT FROM expected OR req->>'providerDisputeId' !~ '^(dp|du)_[A-Za-z0-9_]+$'
   OR req->>'sourceId' !~ '^ch_[A-Za-z0-9_]+$' OR req->>'providerPaymentId' !~ '^pi_[A-Za-z0-9_]+$'
   OR req->>'captureBalanceTransactionId' !~ '^txn_[A-Za-z0-9_]+$' OR req->>'accountFingerprint' !~ '^[a-f0-9]{64}$'
   OR f.instructions->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR jsonb_array_length(req->'sales') NOT BETWEEN 1 AND 2000
   OR (SELECT count(DISTINCT value->>'lineItemId') FROM jsonb_array_elements(req->'sales'))<>jsonb_array_length(req->'sales')
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(req->'sales') sale WHERE COALESCE(length(sale->>'lineItemId')>0
     AND length(sale->>'sellerMerchantId')>0 AND jsonb_typeof(sale->'grossAmountCents')='number' AND jsonb_typeof(sale->'commissionCents')='number'
     AND (sale->>'grossAmountCents')::numeric>0 AND trunc((sale->>'grossAmountCents')::numeric)=(sale->>'grossAmountCents')::numeric
     AND (sale->>'commissionCents')::numeric>=0 AND trunc((sale->>'commissionCents')::numeric)=(sale->>'commissionCents')::numeric
     AND (sale->>'commissionCents')::numeric<(sale->>'grossAmountCents')::numeric,false) IS NOT TRUE)
   OR (SELECT sum((sale->>'grossAmountCents')::bigint) FROM jsonb_array_elements(req->'sales') sale)>f.amount_cents
   THEN RAISE EXCEPTION 'marketplace_dispute_request_unproven'; END IF;
 observed:=(proof_body->>'observedAt')::timestamptz;
 IF observed IS NULL OR observed<clock_timestamp()-interval '300 seconds' OR observed>clock_timestamp()+interval '60 seconds'
   OR COALESCE(proof_body->'version'='1'::jsonb AND proof_body->>'requestHash'=req->>'requestHash'
     AND proof_body->>'provider'='stripe' AND proof_body->>'environment'=req->>'environment'
     AND proof_body->>'accountFingerprint'=req->>'accountFingerprint' AND proof_body->>'providerPaymentId'=req->>'providerPaymentId'
     AND proof_body->>'sourceId'=req->>'sourceId' AND proof_body->>'providerDisputeId'=req->>'providerDisputeId'
     AND proof_body->'amountCents'=req->'amountCents' AND proof_body->>'currency'='BRL' AND proof_body->>'status' IN ('won','lost')
     AND jsonb_typeof(proof_body->'entries')='array',false) IS NOT TRUE
   THEN RAISE EXCEPTION 'marketplace_dispute_proof_unproven'; END IF;
 entries:=proof_body->'entries';
 IF jsonb_array_length(entries)<>(CASE WHEN proof_body->>'status'='won' THEN 2 ELSE 1 END)
   OR (SELECT count(DISTINCT value->>'balanceTransactionId') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries)
   THEN RAISE EXCEPTION 'marketplace_dispute_proof_unproven'; END IF;
 FOR movement IN SELECT value FROM jsonb_array_elements(entries) LOOP
   IF COALESCE(movement->>'balanceTransactionId' ~ '^txn_[A-Za-z0-9_]+$'
     AND jsonb_typeof(movement->'amountCents')='number' AND jsonb_typeof(movement->'feeCents')='number' AND jsonb_typeof(movement->'netCents')='number'
     AND abs((movement->>'amountCents')::numeric)<=2147483647 AND abs((movement->>'feeCents')::numeric)<=2147483647 AND abs((movement->>'netCents')::numeric)<=2147483647
     AND trunc((movement->>'amountCents')::numeric)=(movement->>'amountCents')::numeric
     AND trunc((movement->>'feeCents')::numeric)=(movement->>'feeCents')::numeric AND trunc((movement->>'netCents')::numeric)=(movement->>'netCents')::numeric
     AND jsonb_typeof(movement->'created')='number' AND jsonb_typeof(movement->'availableOn')='number'
     AND trunc((movement->>'created')::numeric)=(movement->>'created')::numeric AND trunc((movement->>'availableOn')::numeric)=(movement->>'availableOn')::numeric
     AND (movement->>'created')::numeric>0 AND (movement->>'availableOn')::numeric>0
     AND to_timestamp((movement->>'created')::double precision)<=observed+interval '60 seconds'
     AND to_timestamp((movement->>'availableOn')::double precision)<=observed+interval '60 seconds',false) IS NOT TRUE
     THEN RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   amount:=(movement->>'amountCents')::bigint; fee:=(movement->>'feeCents')::bigint; net:=(movement->>'netCents')::bigint;
   IF amount-fee<>net THEN RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   IF movement->>'kind'='principal_withdrawal' AND amount=-f.amount_cents AND fee>=0 THEN withdrawn:=withdrawn-amount;
   ELSIF movement->>'kind'='principal_reinstatement' AND amount=f.amount_cents AND fee<=0 THEN reinstated:=reinstated+amount;
   ELSE RAISE EXCEPTION 'marketplace_dispute_movement_unproven'; END IF;
   fees:=fees+fee; net_total:=net_total+net;
 END LOOP;
 IF withdrawn<>f.amount_cents OR reinstated<>(CASE WHEN proof_body->>'status'='won' THEN f.amount_cents ELSE 0 END)
   OR fees NOT BETWEEN 0 AND 2147483647 OR abs(net_total)>2147483647 OR net_total<>reinstated-withdrawn-fees
   OR proof_body->'principalWithdrawnCents' IS DISTINCT FROM to_jsonb(withdrawn)
   OR proof_body->'principalReinstatedCents' IS DISTINCT FROM to_jsonb(reinstated)
   OR proof_body->'providerFeeCents' IS DISTINCT FROM to_jsonb(fees) OR proof_body->'balanceDeltaCents' IS DISTINCT FROM to_jsonb(net_total)
   THEN RAISE EXCEPTION 'marketplace_dispute_totals_unproven'; END IF;
END $$;

CREATE OR REPLACE FUNCTION marketplace_dispute_closure_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE normalized_proof jsonb; expected_hash text;
BEGIN
 PERFORM marketplace_dispute_closure_validate(NEW.request,NEW.proof);
 SELECT (NEW.proof-'observedAt'-'entries')||jsonb_build_object('entries',jsonb_agg(value ORDER BY (value->>'balanceTransactionId') COLLATE "C"))
 INTO normalized_proof FROM jsonb_array_elements(NEW.proof->'entries');
 expected_hash:=marketplace_dispute_closure_hash(normalized_proof);
 IF NEW.funding_plan_id IS DISTINCT FROM NEW.request->>'paymentIntentId' OR NEW.host_merchant_id IS DISTINCT FROM NEW.request->>'hostMerchantId'
   OR NEW.provider_dispute_id IS DISTINCT FROM NEW.request->>'providerDisputeId' OR NEW.request_hash IS DISTINCT FROM NEW.request->>'requestHash'
   OR NEW.proof_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'marketplace_dispute_row_unproven'; END IF;
 IF TG_TABLE_NAME='marketplace_dispute_ledger_entries' THEN
   IF NEW.provider IS DISTINCT FROM 'stripe' OR NEW.environment IS DISTINCT FROM NEW.request->>'environment'
     OR NEW.account_fingerprint IS DISTINCT FROM NEW.request->>'accountFingerprint' OR NEW.entry_hash IS DISTINCT FROM marketplace_dispute_closure_hash(NEW.entry)
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.proof->'entries') item WHERE item=NEW.entry)
     OR NEW.provider_balance_transaction_id IS DISTINCT FROM NEW.entry->>'balanceTransactionId'
     OR EXISTS(SELECT 1 FROM marketplace_dispute_closure_snapshots snap WHERE snap.funding_plan_id=NEW.funding_plan_id AND snap.provider_dispute_id=NEW.provider_dispute_id
       AND (snap.request_hash<>NEW.request_hash OR snap.proof->>'status'='won'))
     THEN RAISE EXCEPTION 'marketplace_dispute_entry_unproven'; END IF;
 ELSE
   IF NEW.observed_at IS DISTINCT FROM (NEW.proof->>'observedAt')::timestamptz
     OR NEW.fee_allocation IS DISTINCT FROM marketplace_dispute_fee_allocation(NEW.request,(NEW.proof->>'providerFeeCents')::bigint)
     OR (SELECT count(*) FROM marketplace_dispute_ledger_entries le WHERE le.funding_plan_id=NEW.funding_plan_id AND le.provider_dispute_id=NEW.provider_dispute_id)<>jsonb_array_length(NEW.proof->'entries')
     OR EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.proof->'entries') item WHERE NOT EXISTS(
       SELECT 1 FROM marketplace_dispute_ledger_entries le WHERE le.funding_plan_id=NEW.funding_plan_id AND le.provider_dispute_id=NEW.provider_dispute_id
       AND le.host_merchant_id=NEW.host_merchant_id AND le.request_hash=NEW.request_hash AND le.entry=item AND le.entry_hash=marketplace_dispute_closure_hash(item)))
     OR EXISTS(SELECT 1 FROM marketplace_dispute_closure_snapshots snap WHERE snap.funding_plan_id=NEW.funding_plan_id AND snap.provider_dispute_id=NEW.provider_dispute_id
       AND (snap.request_hash<>NEW.request_hash OR snap.proof->>'status'='won'))
     THEN RAISE EXCEPTION 'marketplace_dispute_snapshot_unproven'; END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_dispute_ledger_insert_guard ON marketplace_dispute_ledger_entries;
CREATE TRIGGER marketplace_dispute_ledger_insert_guard BEFORE INSERT ON marketplace_dispute_ledger_entries
 FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_insert_guard();
DROP TRIGGER IF EXISTS marketplace_dispute_snapshot_insert_guard ON marketplace_dispute_closure_snapshots;
CREATE TRIGGER marketplace_dispute_snapshot_insert_guard BEFORE INSERT ON marketplace_dispute_closure_snapshots
 FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_insert_guard();

-- A provider movement cannot reserve the global receipt key without its
-- complete snapshot and durable event in the same committed transaction.
CREATE OR REPLACE FUNCTION marketplace_dispute_closure_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap record; message record; movements integer; withdrawal bigint; reinstatement bigint; fees bigint; net bigint;
BEGIN
 SELECT * INTO snap FROM marketplace_dispute_closure_snapshots s
 WHERE s.funding_plan_id=NEW.funding_plan_id AND s.provider_dispute_id=NEW.provider_dispute_id AND s.proof_hash=NEW.proof_hash;
 IF NOT FOUND OR snap.request_hash IS DISTINCT FROM NEW.request_hash OR snap.host_merchant_id IS DISTINCT FROM NEW.host_merchant_id THEN
  RAISE EXCEPTION 'marketplace_dispute_snapshot_required_at_commit';
 END IF;
 SELECT * INTO message FROM outbox_messages o WHERE o.event_id=snap.id;
 IF NOT FOUND OR message.event_type IS DISTINCT FROM 'marketplace.dispute.closure_observed' OR message.schema_version<>1
  OR message.merchant_id IS DISTINCT FROM snap.host_merchant_id OR message.producer IS DISTINCT FROM 'marketplace'
  OR message.correlation_id IS DISTINCT FROM snap.funding_plan_id OR message.causation_id IS DISTINCT FROM snap.provider_dispute_id THEN
  RAISE EXCEPTION 'marketplace_dispute_outbox_required_at_commit';
 END IF;
 SELECT count(*),COALESCE(sum(CASE WHEN le.entry->>'kind'='principal_withdrawal' THEN -(le.entry->>'amountCents')::bigint ELSE 0 END),0),
  COALESCE(sum(CASE WHEN le.entry->>'kind'='principal_reinstatement' THEN (le.entry->>'amountCents')::bigint ELSE 0 END),0),
  COALESCE(sum((le.entry->>'feeCents')::bigint),0),COALESCE(sum((le.entry->>'netCents')::bigint),0)
 INTO movements,withdrawal,reinstatement,fees,net FROM marketplace_dispute_ledger_entries le
 WHERE le.funding_plan_id=snap.funding_plan_id AND le.provider_dispute_id=snap.provider_dispute_id AND le.proof_hash=snap.proof_hash;
 IF movements NOT BETWEEN 1 AND 2 OR message.payload IS DISTINCT FROM jsonb_build_object(
  'funding_plan_id',snap.funding_plan_id,'provider_dispute_id',snap.provider_dispute_id,
  'request_hash',snap.request_hash,'proof_hash',snap.proof_hash,'status',snap.proof->>'status',
  'principal_withdrawn_cents',snap.proof->'principalWithdrawnCents','principal_reinstated_cents',snap.proof->'principalReinstatedCents',
  'provider_fee_cents',snap.proof->'providerFeeCents','balance_delta_cents',snap.proof->'balanceDeltaCents','new_entry_count',movements,
  'principal_withdrawn_delta_cents',withdrawal,'principal_reinstated_delta_cents',reinstatement,'provider_fee_delta_cents',fees,
  'account_balance_delta_cents',net,'fee_allocation',snap.fee_allocation,'fee_collection_state','uncollected','hold_release_proven',false) THEN
  RAISE EXCEPTION 'marketplace_dispute_outbox_movement_mismatch';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS marketplace_dispute_ledger_commit_guard ON marketplace_dispute_ledger_entries;
CREATE CONSTRAINT TRIGGER marketplace_dispute_ledger_commit_guard AFTER INSERT ON marketplace_dispute_ledger_entries
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_commit_guard();
DROP TRIGGER IF EXISTS marketplace_dispute_snapshot_commit_guard ON marketplace_dispute_closure_snapshots;
CREATE CONSTRAINT TRIGGER marketplace_dispute_snapshot_commit_guard AFTER INSERT ON marketplace_dispute_closure_snapshots
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_dispute_closure_commit_guard();
