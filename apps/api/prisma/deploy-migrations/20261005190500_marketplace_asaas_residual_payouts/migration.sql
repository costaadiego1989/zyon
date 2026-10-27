-- Asaas V5: first residual after original principal return and own DONE refunds.
-- All existing V1-V4 allocation/constraint expressions are preserved as an inherited branch.
-- V5 is generation 1; original principal + completed own refund prefix only.

CREATE FUNCTION marketplace_asaas_residual_allocation_valid(a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN COALESCE(a->'version'='5'::jsonb
   AND marketplace_residual_source_cents(a->'returnedPrincipalCents')
   AND (a->>'returnedPrincipalCents')::bigint>0
   AND marketplace_residual_source_cents(a->'heldOriginalPrincipalCents')
   AND NOT a ? 'sources' AND NOT a ? 'contributedNetCents' AND NOT a ? 'excessLiabilityCents'
   AND marketplace_residual_legacy_allocation_valid((a-'returnedPrincipalCents'-'heldOriginalPrincipalCents')||'{"version":1}'::jsonb),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_residual_transfer_proof_valid(r jsonb,p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE a jsonb; e jsonb; n integer:=0; source_entry jsonb;
BEGIN
 SELECT value INTO a FROM jsonb_array_elements(r#>'{asaasFunding,destinationAccounts}')
   WHERE value->>'merchantId'=r->>'beneficiaryMerchantId' AND value->>'walletId'=r->>'destination';
 IF r->'version' IS DISTINCT FROM '5'::jsonb OR a IS NULL OR p->'version' IS DISTINCT FROM '5'::jsonb
   OR p->>'kind' IS DISTINCT FROM 'residual_payout' OR p->>'association' IS DISTINCT FROM 'local_immutable_residual_journal'
   OR p->>'requestHash' IS DISTINCT FROM r->>'requestHash' OR p->>'reference' IS DISTINCT FROM r->>'reference'
   OR p->>'providerTransferId' IS NULL OR p->>'providerTransferId' !~ '^[A-Za-z0-9_-]{1,100}$'
   OR p->'amountCents' IS DISTINCT FROM r->'amountCents'
   OR p->>'hostAccountFingerprint' IS DISTINCT FROM r->>'accountFingerprint'
   OR p->>'sellerAccountFingerprint' IS DISTINCT FROM a->>'accountFingerprint'
   OR p->>'hostWalletId' IS DISTINCT FROM r#>>'{asaasFunding,host,walletId}'
   OR p->>'sellerWalletId' IS DISTINCT FROM r->>'destination' OR p->>'hostWalletId'=p->>'sellerWalletId'
   OR p->>'hostAccountFingerprint'=p->>'sellerAccountFingerprint'
   OR p->>'observedAt' IS NULL OR p->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z$' OR NOT isfinite((p->>'observedAt')::timestamptz)
   OR p#>>'{hostDebit,id}' IS NULL OR p#>>'{hostDebit,id}'=p#>>'{sellerCredit,id}' THEN RETURN false; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(jsonb_build_array(p->'hostDebit',p->'sellerCredit')) LOOP
   IF e->>'id' IS NULL OR e->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR e->>'transferId' IS DISTINCT FROM p->>'providerTransferId'
     OR e->>'type' IS DISTINCT FROM (CASE n WHEN 0 THEN 'INTERNAL_TRANSFER_DEBIT' ELSE 'INTERNAL_TRANSFER_CREDIT' END)
     OR (e->>'amountCents')::bigint IS DISTINCT FROM (CASE n WHEN 0 THEN -(r->>'amountCents')::bigint ELSE (r->>'amountCents')::bigint END)
     OR e->>'date' IS NULL OR e->>'date' !~ '^\d{4}-\d{2}-\d{2}$'
     OR (e->>'date')::date>(substring(p->>'observedAt' FROM 1 FOR 10))::date THEN RETURN false; END IF;
   FOR source_entry IN SELECT value FROM jsonb_array_elements(r#>'{asaasFunding,walletReturns}') LOOP
     IF p->>'providerTransferId' IN (source_entry->>'providerTransferId',source_entry#>>'{request,originalPayout,providerTransferId}')
       OR e->>'id' IN (source_entry#>>'{proof,originalHostDebit,id}',source_entry#>>'{proof,originalSellerCredit,id}',
         source_entry#>>'{proof,sellerReturnDebit,id}',source_entry#>>'{proof,hostReturnCredit,id}')
       OR (e->>'date')::date<(source_entry#>>'{proof,hostReturnCredit,date}')::date THEN RETURN false; END IF;
   END LOOP;
   n:=n+1;
 END LOOP;
 RETURN n=2;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;


-- One native identity registry covers both receipt roles and earlier V1 journals.
-- It has no Prisma model: guards derive every row from an existing durable fact.
CREATE TABLE marketplace_asaas_residual_native_identity_claims (
 identity_key text PRIMARY KEY,
 kind text NOT NULL CHECK(kind IN ('receipt','transfer')),
 native_id text NOT NULL CHECK(native_id ~ '^[A-Za-z0-9_-]{1,100}$'),
 account_fingerprint text NOT NULL CHECK(account_fingerprint ~ '^[a-f0-9]{64}$'),
 owner_kind text NOT NULL CHECK(owner_kind IN ('payout','wallet_return','residual')),
 owner_id text NOT NULL,
 event_id text REFERENCES outbox_messages(event_id) ON DELETE RESTRICT,
 CHECK(identity_key=CASE kind WHEN 'receipt' THEN 'receipt:'||native_id ELSE 'transfer:'||account_fingerprint||':'||native_id END),
 CHECK((owner_kind='residual' AND event_id IS NOT NULL) OR (owner_kind<>'residual' AND event_id IS NULL))
);
CREATE INDEX marketplace_asaas_native_identity_owner ON marketplace_asaas_residual_native_identity_claims(owner_kind,owner_id);

-- Immutable historical reconstruction: no credential decryption, no mutable
-- account status/aggregate balance, no admission claim from a financial hold.
CREATE FUNCTION marketplace_asaas_residual_evidence_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; pi payment_intents; rf record; wr marketplace_asaas_wallet_returns;
 prefix jsonb; receipts jsonb; original jsonb; certificates jsonb; b jsonb; op marketplace_residual_operations; raw jsonb;
 expected_reference text; expected_transfers jsonb; total bigint; retained bigint; merchant_debit bigint; expected_count integer:=0;
 source_receipt jsonb; ev outbox_messages; proof jsonb;
BEGIN
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 SELECT * INTO pi FROM payment_intents WHERE id=p.funding_plan_id AND merchant_id=p.host_merchant_id;
 IF p.id IS NULL OR f.payment_intent_id IS NULL OR pi.id IS NULL OR f.provider<>'asaas' OR p.generation<>1
   OR p.host_merchant_id<>f.host_merchant_id OR p.basis->'version' IS DISTINCT FROM '5'::jsonb
   OR NOT marketplace_asaas_residual_allocation_valid(p.allocation)
   OR p.basis_hash IS DISTINCT FROM marketplace_contribution_hash(p.basis)
   OR p.allocation_hash IS DISTINCT FROM marketplace_contribution_hash(p.allocation)
   OR p.basis->>'fundingPlanId' IS DISTINCT FROM f.payment_intent_id
   OR p.basis->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
   OR p.basis->>'budgetHash' IS DISTINCT FROM marketplace_contribution_hash(f.budget)
   OR marketplace_contribution_hash(f.instructions) IS DISTINCT FROM f.instructions_hash
   OR marketplace_contribution_hash(pi.creation#>'{input,marketplaceFunding}') IS DISTINCT FROM f.instructions_hash
   OR f.budget->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR f.instructions->>'feePolicy' IS DISTINCT FROM 'proportional_seller_sales_v1'
   OR f.budget#>>'{capture,provider}' IS DISTINCT FROM 'asaas'
   OR f.budget#>>'{capture,sourceId}' IS DISTINCT FROM f.provider_payment_id
   OR f.budget#>>'{capture,providerPaymentId}' IS DISTINCT FROM f.provider_payment_id
   OR f.budget#>>'{capture,accountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR f.budget#>'{capture,amountCents}' IS DISTINCT FROM to_jsonb(f.amount_cents)
   OR f.budget#>'{capture,netAmountCents}' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
   OR f.budget#>'{capture,providerFeeCents}' IS DISTINCT FROM to_jsonb(f.provider_fee_cents)
   OR f.amount_cents<>f.net_amount_cents+f.provider_fee_cents
   OR p.basis#>>'{asaasFunding,host,merchantId}' IS DISTINCT FROM f.host_merchant_id
   OR p.basis#>>'{asaasFunding,host,accountFingerprint}' IS DISTINCT FROM f.account_fingerprint
   OR p.basis#>>'{asaasFunding,paymentMethod}' IS DISTINCT FROM pi.method
   OR pi.method NOT IN ('pix','card') OR pi.provider_payment_id IS DISTINCT FROM f.provider_payment_id
   OR pi.amount_cents<>f.amount_cents OR pi.approved_amount_cents IS DISTINCT FROM f.amount_cents
   OR EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=f.payment_intent_id AND id<>p.id)
 THEN RETURN false; END IF;
 SELECT jsonb_agg(jsonb_build_object('refundPlanId',r.id,'returnId',r.return_id,'allocationHash',r.allocation_hash,
   'requestHash',o.request_hash,'providerOperationId',o.provider_operation_id,'amountCents',r.amount_cents)
   ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id),sum(r.amount_cents),sum((r.allocation->>'platformDebitCents')::bigint)
   INTO prefix,total,retained FROM marketplace_refund_plans r JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id
   WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')); 
 IF prefix IS NULL OR jsonb_array_length(prefix) NOT BETWEEN 1 AND 2000 OR p.basis->'refunds' IS DISTINCT FROM prefix
   OR total>f.net_amount_cents OR p.allocation->'capturedNetCents' IS DISTINCT FROM to_jsonb(f.net_amount_cents)
   OR p.allocation->'refundedCents' IS DISTINCT FROM to_jsonb(total)
   OR (p.allocation->>'platformRetainedCents')::bigint IS DISTINCT FROM f.platform_retained_cents-retained THEN RETURN false; END IF;
 FOR rf IN SELECT r.*,o.status AS operation_status,o.provider AS operation_provider,o.account_fingerprint AS operation_account,
   o.request,o.request_hash,o.reference AS operation_reference,o.provider_operation_id,o.claimed_at,o.reconciled_at,
   rt.merchant_id AS return_merchant,rt.status AS return_status,rr.id AS return_refund_id,rr.status AS return_refund_status,
   rr.payment_intent_id AS return_payment,rr.amount_in_cents AS return_amount,rr.provider_refund_id,rr.processed_at
   FROM marketplace_refund_plans r LEFT JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id
   LEFT JOIN returns rt ON rt.id=r.return_id LEFT JOIN return_refunds rr ON rr.return_id=r.return_id WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')) LOOP
   SELECT COALESCE(jsonb_agg(jsonb_build_object('providerOperationId',o.provider_operation_id,'amountCents',r.amount_cents)
     ORDER BY (r.allocation->>'cumulativeRefundCents')::bigint,r.id),'[]'::jsonb) INTO receipts
     FROM marketplace_refund_plans r JOIN marketplace_refund_operations o ON o.refund_plan_id=r.id
     WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')) AND (r.allocation->>'cumulativeRefundCents')::bigint<(rf.allocation->>'cumulativeRefundCents')::bigint;
   IF rf.host_merchant_id<>f.host_merchant_id OR rf.operation_status IS DISTINCT FROM 'confirmed' OR rf.operation_provider IS DISTINCT FROM 'asaas'
     OR rf.operation_account IS DISTINCT FROM f.account_fingerprint OR rf.claimed_at IS NULL OR rf.reconciled_at IS NULL
     OR rf.provider_operation_id IS NULL OR rf.provider_operation_id !~ '^asaas_refund_[a-f0-9]{64}$'
     OR marketplace_contribution_hash(rf.allocation) IS DISTINCT FROM rf.allocation_hash
     OR rf.allocation->'amountCents' IS DISTINCT FROM to_jsonb(rf.amount_cents) OR jsonb_array_length(rf.allocation->'requiredContributions')<>0
     OR rf.allocation->'cumulativeRefundCents' IS DISTINCT FROM to_jsonb((SELECT sum(r.amount_cents) FROM marketplace_refund_plans r
       WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')) AND (r.allocation->>'cumulativeRefundCents')::bigint<=(rf.allocation->>'cumulativeRefundCents')::bigint))
     OR rf.request->>'requestHash' IS DISTINCT FROM rf.request_hash OR marketplace_contribution_hash(rf.request-'requestHash') IS DISTINCT FROM rf.request_hash
     OR rf.request->>'reference' IS DISTINCT FROM rf.operation_reference OR rf.request->>'kind' IS DISTINCT FROM 'refund'
     OR rf.request->>'provider' IS DISTINCT FROM 'asaas' OR rf.request->>'sourceId' IS DISTINCT FROM f.provider_payment_id
     OR rf.request->>'providerPaymentId' IS DISTINCT FROM f.provider_payment_id OR rf.request->>'environment' IS DISTINCT FROM f.environment
     OR rf.request->>'accountFingerprint' IS DISTINCT FROM f.account_fingerprint OR rf.request->>'currency' IS DISTINCT FROM 'BRL'
     OR rf.request->'paymentAmountCents' IS DISTINCT FROM to_jsonb(f.amount_cents) OR rf.request->'amountCents' IS DISTINCT FROM to_jsonb(rf.amount_cents)
     OR rf.request->'asaasCapture' IS DISTINCT FROM f.budget->'capture' OR rf.request->'previousRefunds' IS DISTINCT FROM receipts
     OR rf.request ? 'transfer' OR rf.request ? 'fundingContributions'
     OR rf.return_merchant IS DISTINCT FROM f.host_merchant_id OR rf.return_status IS DISTINCT FROM 'REFUND_COMPLETED'
     OR rf.return_refund_status IS DISTINCT FROM 'COMPLETED' OR rf.return_refund_id IS DISTINCT FROM 'mrefund_return_'||marketplace_contribution_hash(to_jsonb(rf.id))
     OR rf.return_payment IS DISTINCT FROM f.payment_intent_id OR rf.return_amount IS DISTINCT FROM rf.amount_cents
     OR rf.provider_refund_id IS DISTINCT FROM rf.provider_operation_id OR rf.processed_at IS NULL
     OR NOT EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_refund_'||rf.id AND e.event_type='marketplace.refund.confirmed'
       AND e.merchant_id=f.host_merchant_id AND e.schema_version=1 AND e.producer='marketplace' AND e.correlation_id=f.payment_intent_id AND e.causation_id=rf.return_id
       AND e.payload=jsonb_build_object('refund_plan_id',rf.id,'return_id',rf.return_id,'payment_intent_id',f.payment_intent_id,'order_id',f.provider_payment_id,
         'amount_cents',rf.amount_cents,'cumulative_refund_cents',(rf.allocation->>'cumulativeRefundCents')::bigint,'allocation_hash',rf.allocation_hash,'provider_refund_id',rf.provider_operation_id)) THEN RETURN false; END IF;
 END LOOP;

 SELECT jsonb_agg(snapshot.value ORDER BY snapshot.value->>'id') INTO original
   FROM jsonb_array_elements(p.basis#>'{asaasFunding,originalPayouts}') snapshot
   JOIN marketplace_payouts o ON o.id=snapshot.value->>'id' AND o.funding_plan_id=f.payment_intent_id
   WHERE snapshot.value->>'merchantId'=o.beneficiary_merchant_id AND snapshot.value->>'destination'=o.destination
     AND snapshot.value->'amountCents'=to_jsonb(o.amount_cents) AND o.provider='asaas' AND o.account_fingerprint=f.account_fingerprint
     AND o.provider_payment_id=f.provider_payment_id AND o.currency='BRL'
     AND (snapshot.value->>'status'='planned' AND NOT snapshot.value ? 'providerTransferId'
       OR snapshot.value->>'status'='confirmed' AND o.status='confirmed' AND o.claimed_at IS NOT NULL AND o.reconciled_at IS NOT NULL
         AND snapshot.value->>'providerTransferId'=o.provider_transfer_id);
 IF original IS NULL OR p.basis#>'{asaasFunding,originalPayouts}' IS DISTINCT FROM original
   OR (SELECT count(*) FROM marketplace_payouts WHERE funding_plan_id=f.payment_intent_id)<>jsonb_array_length(original)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE (b.value->>'amountCents')::bigint IS DISTINCT FROM
     (SELECT COALESCE(sum(o.amount_cents),0) FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id AND o.beneficiary_merchant_id=b.value->>'merchantId' AND o.destination=b.value->>'destination'))
   OR EXISTS(SELECT 1 FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id AND NOT EXISTS(
     SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE b.value->>'merchantId'=o.beneficiary_merchant_id AND b.value->>'destination'=o.destination)) THEN RETURN false; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',w.id,'payoutId',w.payout_id,'amountCents',w.amount_cents,'certificateHash',w.certificate_hash,
   'requestHash',w.request_hash,'providerTransferId',w.provider_return_transfer_id,'request',w.request,'proof',w.proof) ORDER BY w.id)
   INTO certificates FROM marketplace_asaas_wallet_returns w WHERE w.funding_plan_id=f.payment_intent_id AND w.status='returned' AND w.id IN (SELECT value->>'id' FROM jsonb_array_elements(p.basis#>'{asaasFunding,walletReturns}'))
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(prefix) r WHERE r.value->>'refundPlanId'=w.refund_plan_id);
 IF certificates IS NULL OR p.basis#>'{asaasFunding,walletReturns}' IS DISTINCT FROM certificates
   OR (p.allocation->>'returnedPrincipalCents')::bigint IS DISTINCT FROM (SELECT sum((c->>'amountCents')::bigint) FROM jsonb_array_elements(certificates) c)
   OR (p.allocation->>'heldOriginalPrincipalCents')::bigint IS DISTINCT FROM (SELECT COALESCE(sum((planned->>'amountCents')::bigint),0) FROM jsonb_array_elements(original) planned WHERE planned->>'status'='planned')
   OR (p.allocation->>'returnedPrincipalCents')::bigint+(p.allocation->>'heldOriginalPrincipalCents')::bigint<>f.payout_total_cents
   OR EXISTS(SELECT 1 FROM marketplace_payouts o WHERE o.funding_plan_id=f.payment_intent_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(original) snapshot WHERE snapshot->>'id'=o.id AND snapshot->>'status'='confirmed') AND NOT EXISTS(
     SELECT 1 FROM marketplace_asaas_wallet_returns w WHERE w.payout_id=o.id AND w.status='returned' AND w.amount_cents=o.amount_cents
       AND w.request#>>'{originalPayout,providerTransferId}'=o.provider_transfer_id AND w.request#>>'{seller,merchantId}'=o.beneficiary_merchant_id
       AND w.request#>>'{seller,walletId}'=o.destination)) THEN RETURN false; END IF;
 FOR wr IN SELECT * FROM marketplace_asaas_wallet_returns w WHERE w.funding_plan_id=f.payment_intent_id AND w.status='returned' AND w.id IN (SELECT value->>'id' FROM jsonb_array_elements(p.basis#>'{asaasFunding,walletReturns}')) LOOP
   IF NOT marketplace_asaas_wallet_return_request_valid(wr) OR NOT marketplace_asaas_wallet_return_proof_valid(wr)
     OR wr.host_merchant_id<>f.host_merchant_id OR wr.request->'host' IS DISTINCT FROM p.basis#>'{asaasFunding,host}'
     OR wr.request->'capture' IS DISTINCT FROM f.budget->'capture' OR wr.request->>'instructionsHash' IS DISTINCT FROM f.instructions_hash
     OR NOT EXISTS(SELECT 1 FROM marketplace_payouts o WHERE o.id=wr.payout_id AND o.funding_plan_id=f.payment_intent_id AND o.status='confirmed'
       AND o.beneficiary_merchant_id=wr.seller_merchant_id AND o.destination=wr.request#>>'{seller,walletId}' AND o.amount_cents=wr.amount_cents
       AND o.provider_transfer_id=wr.original_provider_transfer_id AND wr.request#>'{originalPayout,amountCents}'=to_jsonb(o.amount_cents))
     OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(prefix) r WHERE r.value->>'refundPlanId'=wr.refund_plan_id AND r.value->>'allocationHash'=wr.request->>'allocationHash')
     OR (SELECT count(*) FROM marketplace_asaas_wallet_return_receipts WHERE journal_id=wr.id)<>4
     OR NOT EXISTS(SELECT 1 FROM outbox_messages e WHERE e.event_id='marketplace_asaas_wallet_return_'||wr.id AND e.event_type='marketplace.asaas_wallet_return.returned'
       AND e.merchant_id=f.host_merchant_id AND e.schema_version=1 AND e.producer='marketplace' AND e.correlation_id=f.payment_intent_id AND e.causation_id=wr.id
       AND e.payload=jsonb_build_object('journal_id',wr.id,'funding_plan_id',f.payment_intent_id,'refund_plan_id',wr.refund_plan_id,
         'payout_id',wr.payout_id,'amount_cents',wr.amount_cents,'certificate_hash',wr.certificate_hash)) THEN RETURN false; END IF;
   FOR source_receipt IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
     jsonb_build_object('kind','original_host_debit','account',wr.host_account_fingerprint,'entry',wr.proof->'originalHostDebit'),
     jsonb_build_object('kind','original_seller_credit','account',wr.seller_account_fingerprint,'entry',wr.proof->'originalSellerCredit'),
     jsonb_build_object('kind','seller_return_debit','account',wr.seller_account_fingerprint,'entry',wr.proof->'sellerReturnDebit'),
     jsonb_build_object('kind','host_return_credit','account',wr.host_account_fingerprint,'entry',wr.proof->'hostReturnCredit'))) LOOP
     IF NOT EXISTS(SELECT 1 FROM marketplace_asaas_wallet_return_receipts e WHERE e.journal_id=wr.id AND e.kind=source_receipt->>'kind'
       AND e.account_fingerprint=source_receipt->>'account' AND e.receipt_id=source_receipt#>>'{entry,id}' AND e.transfer_id=source_receipt#>>'{entry,transferId}'
       AND e.amount_cents=(source_receipt#>>'{entry,amountCents}')::bigint AND e.date=(source_receipt#>>'{entry,date}')::date) THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 IF jsonb_array_length(p.allocation->'beneficiaries')<>jsonb_array_length(f.budget->'beneficiaries')
   OR jsonb_typeof(p.basis#>'{asaasFunding,destinationAccounts}') IS DISTINCT FROM 'array'
   OR (SELECT count(DISTINCT value->>'merchantId') FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}'))
     <>jsonb_array_length(p.basis#>'{asaasFunding,destinationAccounts}') THEN RETURN false; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(certificates) c WHERE NOT EXISTS(
   SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') a WHERE a.value->>'merchantId'=c.value#>>'{request,seller,merchantId}'
     AND a.value->>'walletId'=c.value#>>'{request,seller,walletId}' AND a.value->>'accountFingerprint'=c.value#>>'{request,seller,accountFingerprint}')) THEN RETURN false; END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('reference','mresidual_'||marketplace_contribution_hash(jsonb_build_array(
   f.host_merchant_id,f.payment_intent_id,p.basis_hash,b.value->>'merchantId')),'destination',b.value->'destination','amountCents',b.value->'amountCents') ORDER BY b.ord),'[]'::jsonb)
   INTO expected_transfers FROM jsonb_array_elements(p.allocation->'beneficiaries') WITH ORDINALITY b(value,ord) WHERE (b.value->>'amountCents')::bigint>0;
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   SELECT COALESCE(sum((d->>'amountCents')::bigint),0) INTO merchant_debit FROM marketplace_refund_plans r,
     jsonb_array_elements(r.allocation->'merchantDebits') d WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')) AND d->>'merchantId'=b->>'merchantId';
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') original WHERE original.value->>'merchantId'=b->>'merchantId'
       AND original.value->>'destination'=b->>'destination' AND original.value->'providerFeeCents'=b->'providerFeeCents'
       AND (original.value->>'amountCents')::bigint-merchant_debit=(b->>'amountCents')::bigint)
     OR (b->>'amountCents')::bigint>0 AND b->>'destination'=p.basis#>>'{asaasFunding,host,walletId}' THEN RETURN false; END IF;
   IF (b->>'amountCents')::bigint=0 THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') a WHERE a.value->>'merchantId'=b->>'merchantId'
     AND a.value->>'walletId'=b->>'destination' AND a.value->>'accountFingerprint' ~ '^[a-f0-9]{64}$'
     AND a.value->>'connectionId'=marketplace_contribution_hash(jsonb_build_object('merchantId',b->>'merchantId','provider','asaas'))
     AND a.value->>'secretCipherHash' ~ '^[a-f0-9]{64}$') THEN RETURN false; END IF;
   expected_count:=expected_count+1;
   SELECT * INTO op FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND beneficiary_merchant_id=b->>'merchantId' AND source_id='original';
   expected_reference:='mresidual_'||marketplace_contribution_hash(jsonb_build_array(f.host_merchant_id,f.payment_intent_id,p.basis_hash,b->>'merchantId'));
   raw:=jsonb_build_object('version',5,'provider','asaas','fundingPlanId',f.payment_intent_id,'beneficiaryMerchantId',b->'merchantId',
     'basisHash',p.basis_hash,'allocationHash',p.allocation_hash,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
     'destination',b->'destination','amountCents',b->'amountCents','currency','BRL','reference',expected_reference,'capture',f.budget->'capture',
     'asaasFunding',p.basis->'asaasFunding','residualAllocation',p.allocation,'remainingTotalCents',p.allocation->'payoutTotalCents',
     'refunds',(SELECT jsonb_agg(jsonb_build_object('providerOperationId',value->'providerOperationId','amountCents',value->'amountCents') ORDER BY ord)
       FROM jsonb_array_elements(prefix) WITH ORDINALITY x(value,ord)),'transfers',expected_transfers);
   IF op.id IS NULL OR op.provider<>'asaas' OR op.account_fingerprint<>f.account_fingerprint OR op.amount_cents<>(b->>'amountCents')::bigint
     OR op.reference<>expected_reference OR op.request IS DISTINCT FROM raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw))
     OR op.request_hash IS DISTINCT FROM marketplace_contribution_hash(raw) THEN RETURN false; END IF;
   SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_asaas_residual_submission_'||op.id;
   IF ev.event_id IS NOT NULL AND (ev.event_type<>'marketplace.asaas_residual.submission_authorized' OR ev.merchant_id<>f.host_merchant_id
     OR ev.schema_version<>1 OR ev.producer<>'marketplace' OR ev.correlation_id<>f.payment_intent_id OR ev.causation_id<>op.id
     OR ev.payload IS DISTINCT FROM jsonb_build_object('residual_plan_id',p.id,'operation_id',op.id,'payment_intent_id',f.payment_intent_id,'request_hash',op.request_hash)
     OR op.claimed_at IS NULL OR op.status='planned') THEN RETURN false; END IF;
   IF op.status IN ('pending','confirmed','failed') AND ev.event_id IS NULL THEN RETURN false; END IF;
   IF op.status='confirmed' THEN
     SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_residual_confirmed_'||op.id;
     proof:=ev.payload->'asaas_proof';
     IF ev.event_id IS NULL OR ev.event_type<>'marketplace.residual.confirmed' OR ev.merchant_id<>f.host_merchant_id OR ev.schema_version<>1 OR ev.producer<>'marketplace'
       OR ev.correlation_id<>f.payment_intent_id OR ev.causation_id<>op.id OR op.claimed_at IS NULL OR op.reconciled_at IS NULL
       
       OR proof->>'providerTransferId' IS DISTINCT FROM op.provider_transfer_id OR NOT marketplace_asaas_residual_transfer_proof_valid(op.request,proof)
       OR (SELECT count(*) FROM marketplace_asaas_residual_native_identity_claims WHERE owner_kind='residual' AND owner_id=op.id AND event_id=ev.event_id)<>4
       OR ev.payload IS DISTINCT FROM jsonb_build_object('residual_plan_id',p.id,'operation_id',op.id,'payment_intent_id',f.payment_intent_id,
         'beneficiary_merchant_id',op.beneficiary_merchant_id,'amount_cents',op.amount_cents,'provider_transfer_id',op.provider_transfer_id,
         'reconciliation_required',ev.payload->'reconciliation_required','asaas_proof',proof) THEN RETURN false; END IF;
     IF EXISTS(SELECT 1 FROM outbox_messages other WHERE other.event_id<>ev.event_id AND other.event_type='marketplace.residual.confirmed'
       AND (other.payload#>>'{asaas_proof,hostAccountFingerprint}'=proof->>'hostAccountFingerprint'
         AND (other.payload#>>'{asaas_proof,providerTransferId}'=proof->>'providerTransferId' OR other.payload#>>'{asaas_proof,hostDebit,id}'=proof#>>'{hostDebit,id}')
         OR other.payload#>>'{asaas_proof,sellerAccountFingerprint}'=proof->>'sellerAccountFingerprint'
           AND other.payload#>>'{asaas_proof,sellerCredit,id}'=proof#>>'{sellerCredit,id}')) THEN RETURN false; END IF;
   END IF;
 END LOOP;
 RETURN (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=p.id)=expected_count;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_residual_admission_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; pi payment_intents; a jsonb;
BEGIN
 IF NOT marketplace_asaas_residual_evidence_valid(plan_id) THEN RETURN false; END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id; SELECT * INTO pi FROM payment_intents WHERE id=f.payment_intent_id;
 IF p.status NOT IN ('prepared','completed') OR p.held_reason IS NOT NULL OR f.status<>'held' OR NOT EXISTS(SELECT 1 FROM payment_intents WHERE id=f.payment_intent_id AND status='approved')
   OR NOT EXISTS(SELECT 1 FROM marketplace_order_ledgers WHERE host_merchant_id=f.host_merchant_id AND order_id=f.provider_payment_id AND purchased_at IS NOT NULL AND chargeback_at IS NULL)
   
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=f.payment_intent_id)
   OR EXISTS(SELECT 1 FROM marketplace_refund_plans r WHERE r.funding_plan_id=f.payment_intent_id AND
     (r.status<>'confirmed' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis->'refunds') prefix WHERE prefix->>'refundPlanId'=r.id)))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,originalPayouts}') snapshot JOIN marketplace_payouts o ON o.id=snapshot.value->>'id'
     WHERE o.status IS DISTINCT FROM snapshot.value->>'status' OR snapshot.value->>'status'='planned' AND (o.claimed_at IS NOT NULL OR o.provider_transfer_id IS NOT NULL))
   OR EXISTS(SELECT 1 FROM returns rt WHERE rt.merchant_id=f.host_merchant_id AND
     (rt.order_id IN (f.provider_payment_id,pi.commerce_order_id) OR rt.order_id IN (SELECT id FROM completed_orders WHERE merchant_id=f.host_merchant_id AND external_order_id IN (f.provider_payment_id,pi.commerce_order_id)))
     AND rt.status NOT IN ('REJECTED','CANCELLED') AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis->'refunds') prefix WHERE prefix->>'returnId'=rt.id))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_seller_debts d ON d.seller_merchant_id=b.value->>'merchantId' WHERE d.status IN ('outstanding','deducted'))
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b JOIN marketplace_host_debts d ON d.host_merchant_id=b.value->>'merchantId' WHERE d.status IN ('outstanding','deducted'))

   OR EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') b WHERE EXISTS (
     SELECT 1 FROM marketplace_residual_operations o JOIN marketplace_residual_plans r ON r.id=o.residual_plan_id
     WHERE o.beneficiary_merchant_id=b.value->>'merchantId' AND o.status IN ('unknown','pending','confirmed') AND r.status='held'
     AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recoveries c WHERE c.residual_operation_id=o.id AND c.funding_plan_id=r.funding_plan_id
       AND c.host_merchant_id=r.host_merchant_id AND c.beneficiary_merchant_id=o.beneficiary_merchant_id AND c.provider=o.provider
       AND c.account_fingerprint=o.account_fingerprint AND c.provider_transfer_id=o.provider_transfer_id AND c.amount_cents=o.amount_cents
       AND r.held_reason='marketplace_residual_dispute_requires_reconciliation' AND EXISTS(SELECT 1 FROM marketplace_funding_plans cf
         JOIN marketplace_order_ledgers cl ON cl.host_merchant_id=cf.host_merchant_id AND cl.order_id=cf.provider_payment_id
         WHERE cf.payment_intent_id=c.funding_plan_id AND cf.status='held' AND cl.chargeback_at IS NOT NULL)))
     OR EXISTS(SELECT 1 FROM marketplace_payouts o JOIN marketplace_funding_plans ff ON ff.payment_intent_id=o.funding_plan_id
       JOIN marketplace_order_ledgers ll ON ll.host_merchant_id=ff.host_merchant_id AND ll.order_id=ff.provider_payment_id
       WHERE o.beneficiary_merchant_id=b.value->>'merchantId' AND o.status IN ('unknown','pending','confirmed') AND ll.chargeback_at IS NOT NULL
       AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recoveries c WHERE c.payout_id=o.id AND c.funding_plan_id=ff.payment_intent_id
         AND c.host_merchant_id=ff.host_merchant_id AND c.beneficiary_merchant_id=o.beneficiary_merchant_id AND c.provider=o.provider
         AND c.account_fingerprint=o.account_fingerprint AND c.provider_transfer_id=o.provider_transfer_id AND c.amount_cents=o.amount_cents AND ff.status='held')
       AND EXISTS(SELECT 1 FROM marketplace_transfer_reversals v JOIN marketplace_refund_plans r ON r.id=v.refund_plan_id WHERE r.funding_plan_id=ff.payment_intent_id)))
   THEN RETURN false; END IF;
 FOR a IN SELECT value FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') LOOP
   IF NOT EXISTS(SELECT 1 FROM merchant_payment_connections c WHERE c.merchant_id=a->>'merchantId' AND c.provider='asaas'
     AND marketplace_contribution_hash(jsonb_build_object('merchantId',c.merchant_id,'provider',c.provider))=a->>'connectionId'
     AND c.environment=f.environment AND c.wallet_id=a->>'walletId' AND c.status='active' AND c.payouts_enabled AND c.secret_cipher IS NOT NULL
     AND marketplace_contribution_hash(to_jsonb(c.secret_cipher))=a->>'secretCipherHash') THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_residual_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE plan_id text; p marketplace_residual_plans;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN plan_id:=NEW.id;ELSE plan_id:=NEW.residual_plan_id;END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 IF p.basis->'version' IS DISTINCT FROM '5'::jsonb THEN RETURN NEW; END IF;
 
 IF NOT marketplace_asaas_residual_evidence_valid(plan_id) THEN RAISE EXCEPTION 'marketplace_asaas_residual_evidence_unproven'; END IF;
 IF p.status='completed' AND (p.held_reason IS NOT NULL OR EXISTS(SELECT 1 FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND status<>'confirmed'))
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_completion_unproven'; END IF;
 IF TG_TABLE_NAME='marketplace_residual_operations' AND TG_OP='UPDATE' AND NEW.status='confirmed' AND OLD.status<>'confirmed'
   AND NOT marketplace_asaas_residual_admission_valid(plan_id) AND (p.status<>'held' OR p.held_reason IS NULL OR NOT EXISTS(
     SELECT 1 FROM outbox_messages WHERE event_id='marketplace_residual_confirmed_'||NEW.id AND payload->'reconciliation_required'='true'::jsonb))
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_late_receipt_hold_required'; END IF;
 IF TG_OP='INSERT' AND p.status='prepared' AND NOT marketplace_asaas_residual_admission_valid(plan_id)
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_admission_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_plan_commit_guard AFTER INSERT OR UPDATE ON marketplace_residual_plans
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_operation_commit_guard AFTER INSERT OR UPDATE ON marketplace_residual_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_commit_guard();

CREATE FUNCTION marketplace_asaas_residual_claim_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   IF (TG_TABLE_NAME='marketplace_residual_plans' AND to_jsonb(OLD)#>'{basis,version}'='5'::jsonb)
     OR (TG_TABLE_NAME='marketplace_residual_operations' AND to_jsonb(OLD)#>'{request,version}'='5'::jsonb)
     THEN RAISE EXCEPTION 'marketplace_asaas_residual_journal_immutable'; END IF;RETURN OLD;
 END IF;
 IF OLD.request->'version'='5'::jsonb AND EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_asaas_residual_submission_'||OLD.id)
   AND (NEW.status='planned' OR NEW.claimed_at IS NULL OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at)
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_submission_already_consumed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_residual_claim_reset_guard BEFORE UPDATE ON marketplace_residual_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_claim_immutable();
CREATE TRIGGER marketplace_asaas_residual_plan_delete_guard BEFORE DELETE ON marketplace_residual_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_claim_immutable();
CREATE TRIGGER marketplace_asaas_residual_operation_delete_guard BEFORE DELETE ON marketplace_residual_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_claim_immutable();

CREATE FUNCTION marketplace_asaas_residual_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e outbox_messages; o marketplace_residual_operations; p marketplace_residual_plans;
BEGIN
 IF TG_OP='DELETE' THEN e:=OLD;ELSE e:=NEW;END IF;
 
 IF TG_OP IN ('UPDATE','DELETE') AND (OLD.event_type='marketplace.asaas_residual.submission_authorized' OR OLD.event_type='marketplace.residual.confirmed'
   AND EXISTS(SELECT 1 FROM marketplace_residual_operations old_op WHERE old_op.id=OLD.causation_id AND old_op.request->'version'='5'::jsonb)) THEN
   IF TG_OP='DELETE' OR (NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload)
     IS DISTINCT FROM (OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload)
     THEN RAISE EXCEPTION 'marketplace_asaas_residual_financial_event_immutable'; END IF;
 END IF;
 IF e.event_type NOT IN ('marketplace.asaas_residual.submission_authorized','marketplace.residual.confirmed') THEN
   IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
 END IF;
 SELECT * INTO o FROM marketplace_residual_operations WHERE id=e.causation_id;
 IF e.event_type='marketplace.residual.confirmed' AND o.request->'version' IS DISTINCT FROM '5'::jsonb THEN
   IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload)
   IS DISTINCT FROM (OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload)
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_financial_event_immutable'; END IF;
 IF o.id IS NULL OR o.request->'version' IS DISTINCT FROM '5'::jsonb OR o.claimed_at IS NULL OR o.status='planned'
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_submission_claim_missing'; END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=o.residual_plan_id;
 IF e.merchant_id IS DISTINCT FROM p.host_merchant_id OR e.schema_version<>1 OR e.producer<>'marketplace'
   OR e.correlation_id IS DISTINCT FROM p.funding_plan_id OR e.causation_id IS DISTINCT FROM o.id THEN RAISE EXCEPTION 'marketplace_asaas_residual_event_unbound'; END IF;

 IF TG_OP='INSERT' AND e.event_type='marketplace.asaas_residual.submission_authorized' AND
   (o.status<>'unknown' OR o.provider_transfer_id IS NOT NULL OR p.status<>'prepared' OR p.due_at>now())
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_permission_claim_not_fresh'; END IF;
 IF e.event_type='marketplace.asaas_residual.submission_authorized' AND (
   e.event_id IS DISTINCT FROM 'marketplace_asaas_residual_submission_'||o.id
   OR e.payload IS DISTINCT FROM jsonb_build_object('residual_plan_id',p.id,'operation_id',o.id,'payment_intent_id',p.funding_plan_id,'request_hash',o.request_hash))
   THEN RAISE EXCEPTION 'marketplace_asaas_residual_permission_unbound'; END IF;
 IF e.event_type='marketplace.residual.confirmed' AND (
   o.status<>'confirmed' OR e.event_id IS DISTINCT FROM 'marketplace_residual_confirmed_'||o.id
   OR e.payload#>>'{asaas_proof,providerTransferId}' IS DISTINCT FROM o.provider_transfer_id
   OR NOT marketplace_asaas_residual_transfer_proof_valid(o.request,e.payload->'asaas_proof')) THEN RAISE EXCEPTION 'marketplace_asaas_residual_native_receipt_unbound'; END IF;
 IF TG_OP='INSERT' AND e.event_type='marketplace.asaas_residual.submission_authorized'
   AND NOT marketplace_asaas_residual_admission_valid(o.residual_plan_id) THEN RAISE EXCEPTION 'marketplace_asaas_residual_admission_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_residual_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_outbox_guard();

CREATE FUNCTION marketplace_asaas_residual_outbox_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE op marketplace_residual_operations;
BEGIN
 SELECT * INTO op FROM marketplace_residual_operations WHERE id=NEW.causation_id;
 IF op.request->'version'='5'::jsonb AND NEW.event_type IN ('marketplace.asaas_residual.submission_authorized','marketplace.residual.confirmed')
   AND NOT marketplace_asaas_residual_evidence_valid(op.residual_plan_id) THEN RAISE EXCEPTION 'marketplace_asaas_residual_evidence_unproven'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_asaas_residual_outbox_commit_guard AFTER INSERT OR UPDATE ON outbox_messages
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_outbox_commit_guard();


-- Rename preserves the exact V1-V4 function body and its OID dependencies.
ALTER FUNCTION marketplace_residual_allocation_valid(jsonb) RENAME TO marketplace_residual_v1_v4_allocation_valid;
CREATE FUNCTION marketplace_residual_allocation_valid(a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN a->'version'='5'::jsonb THEN marketplace_asaas_residual_allocation_valid(a) ELSE marketplace_residual_v1_v4_allocation_valid(a) END
$$;

-- Keep the installed legacy CHECK expression verbatim, adding only the V5 branch.
DO $$ DECLARE definition text; inherited text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_plans'::regclass AND conname='marketplace_residual_plan_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_plan_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_plans DROP CONSTRAINT marketplace_residual_plan_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK (('||inherited||') OR COALESCE(
  status IN (''prepared'',''completed'',''held'') AND generation=1 AND basis_hash ~ ''^[a-f0-9]{64}$'' AND allocation_hash ~ ''^[a-f0-9]{64}$''
  AND jsonb_typeof(basis)=''object'' AND basis->''version''=''5''::jsonb AND allocation->''version''=''5''::jsonb
  AND jsonb_typeof(basis->''refunds'')=''array'' AND jsonb_array_length(basis->''refunds'') BETWEEN 1 AND 2000
  AND jsonb_typeof(basis#>''{asaasFunding,originalPayouts}'')=''array'' AND jsonb_typeof(basis#>''{asaasFunding,walletReturns}'')=''array''
  AND jsonb_typeof(basis#>''{asaasFunding,destinationAccounts}'')=''array'' AND NOT basis ? ''originalTransfers'' AND NOT basis ? ''previousGenerations''
  AND NOT basis ? ''fundingContributions'' AND marketplace_residual_allocation_valid(allocation),false))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_operations'::regclass AND conname='marketplace_residual_source_id_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_source_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_operations DROP CONSTRAINT marketplace_residual_source_id_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_source_id_valid CHECK (('||inherited||') OR COALESCE(
  source_id=''original'' AND request->''version''=''5''::jsonb AND request->>''provider''=''asaas'' AND NOT request ? ''sourceId'',false))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_operations'::regclass AND conname='marketplace_residual_operations_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_operation_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_operations DROP CONSTRAINT marketplace_residual_operations_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_operations_valid CHECK (('||inherited||') OR COALESCE(
  status IN (''planned'',''unknown'',''pending'',''confirmed'',''failed'',''cancelled'') AND version>=0 AND amount_cents>0 AND provider=''asaas''
  AND source_id=''original'' AND request_hash ~ ''^[a-f0-9]{64}$'' AND jsonb_typeof(request)=''object'' AND request->''version''=''5''::jsonb
  AND request->>''requestHash''=request_hash AND marketplace_contribution_hash(request-''requestHash'')=request_hash
  AND request->>''reference''=reference AND request->>''provider''=provider AND request->>''accountFingerprint''=account_fingerprint
  AND marketplace_residual_source_cents(request->''amountCents'') AND (request->>''amountCents'')::bigint=amount_cents
  AND request->>''currency''=''BRL'' AND NOT request ? ''sourceId''
  AND (status NOT IN (''confirmed'',''failed'') OR provider_transfer_id IS NOT NULL),false))';
END $$;
CREATE FUNCTION marketplace_asaas_residual_native_claim(k text,n text,a text,ok text,oid text,eid text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE key text; row marketplace_asaas_residual_native_identity_claims;
BEGIN
 key:=CASE k WHEN 'receipt' THEN 'receipt:'||n ELSE 'transfer:'||a||':'||n END;
 INSERT INTO marketplace_asaas_residual_native_identity_claims(identity_key,kind,native_id,account_fingerprint,owner_kind,owner_id,event_id)
   VALUES(key,k,n,a,ok,oid,eid) ON CONFLICT(identity_key) DO NOTHING;
 SELECT * INTO row FROM marketplace_asaas_residual_native_identity_claims WHERE identity_key=key;
 IF (row.kind,row.native_id,row.account_fingerprint,row.owner_kind,row.owner_id,row.event_id) IS DISTINCT FROM (k,n,a,ok,oid,eid)
   THEN RAISE EXCEPTION 'marketplace_asaas_native_identity_already_consumed'; END IF;
END $$;

CREATE FUNCTION marketplace_asaas_residual_native_claim_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ev outbox_messages; op marketplace_residual_operations; w marketplace_asaas_wallet_returns; proof jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'marketplace_asaas_native_identity_immutable'; END IF;
 IF NEW.owner_kind='residual' THEN
   SELECT * INTO ev FROM outbox_messages WHERE event_id=NEW.event_id;
   SELECT * INTO op FROM marketplace_residual_operations WHERE id=NEW.owner_id;
   proof:=ev.payload->'asaas_proof';
   IF ev.event_type IS DISTINCT FROM 'marketplace.residual.confirmed' OR ev.causation_id IS DISTINCT FROM op.id
     OR op.request->'version' IS DISTINCT FROM '5'::jsonb OR op.status IS DISTINCT FROM 'confirmed'
     OR NOT marketplace_asaas_residual_transfer_proof_valid(op.request,proof)
     OR NOT (NEW.kind='transfer' AND NEW.native_id=proof->>'providerTransferId' AND NEW.account_fingerprint IN (proof->>'hostAccountFingerprint',proof->>'sellerAccountFingerprint')
       OR NEW.kind='receipt' AND (NEW.native_id=proof#>>'{hostDebit,id}' AND NEW.account_fingerprint=proof->>'hostAccountFingerprint'
         OR NEW.native_id=proof#>>'{sellerCredit,id}' AND NEW.account_fingerprint=proof->>'sellerAccountFingerprint'))
     THEN RAISE EXCEPTION 'marketplace_asaas_native_identity_unbound'; END IF;
 ELSIF NEW.owner_kind='wallet_return' THEN
   SELECT * INTO w FROM marketplace_asaas_wallet_returns WHERE id=NEW.owner_id;
   IF NOT COALESCE((NEW.kind='transfer' AND w.provider_return_transfer_id=NEW.native_id AND NEW.account_fingerprint IN (w.host_account_fingerprint,w.seller_account_fingerprint)
     OR NEW.kind='receipt' AND EXISTS(SELECT 1 FROM marketplace_asaas_wallet_return_receipts WHERE journal_id=w.id AND receipt_id=NEW.native_id AND account_fingerprint=NEW.account_fingerprint)),false)
     THEN RAISE EXCEPTION 'marketplace_asaas_native_identity_unbound'; END IF;
 ELSE
   IF NEW.kind<>'transfer' OR NOT EXISTS(SELECT 1 FROM marketplace_payouts p WHERE p.id=NEW.owner_id AND p.provider='asaas'
     AND p.provider_transfer_id=NEW.native_id AND (p.account_fingerprint=NEW.account_fingerprint OR EXISTS(
       SELECT 1 FROM marketplace_asaas_wallet_returns payout_return WHERE payout_return.payout_id=p.id AND payout_return.original_provider_transfer_id=NEW.native_id AND payout_return.seller_account_fingerprint=NEW.account_fingerprint)))
     THEN RAISE EXCEPTION 'marketplace_asaas_native_identity_unbound'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_native_identity_guard BEFORE INSERT OR UPDATE OR DELETE ON marketplace_asaas_residual_native_identity_claims
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_native_claim_guard();

CREATE FUNCTION marketplace_asaas_residual_capture_native_identities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE proof jsonb;
BEGIN
 IF TG_TABLE_NAME='marketplace_payouts' THEN
   IF NEW.provider='asaas' AND NEW.provider_transfer_id IS NOT NULL THEN
     PERFORM marketplace_asaas_residual_native_claim('transfer',NEW.provider_transfer_id,NEW.account_fingerprint,'payout',NEW.id);END IF;
 ELSIF TG_TABLE_NAME='marketplace_asaas_wallet_returns' THEN
   PERFORM marketplace_asaas_residual_native_claim('transfer',NEW.original_provider_transfer_id,NEW.host_account_fingerprint,'payout',NEW.payout_id);
   PERFORM marketplace_asaas_residual_native_claim('transfer',NEW.original_provider_transfer_id,NEW.seller_account_fingerprint,'payout',NEW.payout_id);
   IF NEW.provider_return_transfer_id IS NOT NULL THEN
     PERFORM marketplace_asaas_residual_native_claim('transfer',NEW.provider_return_transfer_id,NEW.host_account_fingerprint,'wallet_return',NEW.id);
     PERFORM marketplace_asaas_residual_native_claim('transfer',NEW.provider_return_transfer_id,NEW.seller_account_fingerprint,'wallet_return',NEW.id);END IF;
 ELSIF TG_TABLE_NAME='marketplace_asaas_wallet_return_receipts' THEN
   PERFORM marketplace_asaas_residual_native_claim('receipt',NEW.receipt_id,NEW.account_fingerprint,'wallet_return',NEW.journal_id);
 ELSIF NEW.event_type='marketplace.residual.confirmed' AND NEW.payload#>'{asaas_proof,version}'='5'::jsonb THEN
   proof:=NEW.payload->'asaas_proof';
   PERFORM marketplace_asaas_residual_native_claim('transfer',proof->>'providerTransferId',proof->>'hostAccountFingerprint','residual',NEW.causation_id,NEW.event_id);
   PERFORM marketplace_asaas_residual_native_claim('transfer',proof->>'providerTransferId',proof->>'sellerAccountFingerprint','residual',NEW.causation_id,NEW.event_id);
   PERFORM marketplace_asaas_residual_native_claim('receipt',proof#>>'{hostDebit,id}',proof->>'hostAccountFingerprint','residual',NEW.causation_id,NEW.event_id);
   PERFORM marketplace_asaas_residual_native_claim('receipt',proof#>>'{sellerCredit,id}',proof->>'sellerAccountFingerprint','residual',NEW.causation_id,NEW.event_id);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_native_payout_identity AFTER INSERT OR UPDATE ON marketplace_payouts
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_capture_native_identities();
CREATE TRIGGER marketplace_asaas_native_return_identity AFTER INSERT OR UPDATE ON marketplace_asaas_wallet_returns
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_capture_native_identities();
CREATE TRIGGER marketplace_asaas_native_return_receipt_identity AFTER INSERT ON marketplace_asaas_wallet_return_receipts
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_capture_native_identities();
CREATE TRIGGER marketplace_asaas_native_residual_identity AFTER INSERT ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_residual_capture_native_identities();
DO $$ DECLARE p marketplace_payouts; w marketplace_asaas_wallet_returns; r marketplace_asaas_wallet_return_receipts; BEGIN
 FOR p IN SELECT * FROM marketplace_payouts WHERE provider='asaas' AND provider_transfer_id IS NOT NULL LOOP
   PERFORM marketplace_asaas_residual_native_claim('transfer',p.provider_transfer_id,p.account_fingerprint,'payout',p.id);END LOOP;
 FOR w IN SELECT * FROM marketplace_asaas_wallet_returns LOOP
   PERFORM marketplace_asaas_residual_native_claim('transfer',w.original_provider_transfer_id,w.host_account_fingerprint,'payout',w.payout_id);
   PERFORM marketplace_asaas_residual_native_claim('transfer',w.original_provider_transfer_id,w.seller_account_fingerprint,'payout',w.payout_id);
   IF w.provider_return_transfer_id IS NOT NULL THEN
     PERFORM marketplace_asaas_residual_native_claim('transfer',w.provider_return_transfer_id,w.host_account_fingerprint,'wallet_return',w.id);
     PERFORM marketplace_asaas_residual_native_claim('transfer',w.provider_return_transfer_id,w.seller_account_fingerprint,'wallet_return',w.id);END IF;END LOOP;
 FOR r IN SELECT * FROM marketplace_asaas_wallet_return_receipts LOOP
   PERFORM marketplace_asaas_residual_native_claim('receipt',r.receipt_id,r.account_fingerprint,'wallet_return',r.journal_id);END LOOP;
END $$;
