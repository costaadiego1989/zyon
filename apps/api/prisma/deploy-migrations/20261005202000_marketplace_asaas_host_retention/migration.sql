-- V7 accounts for the host's existing collector entitlement. This is not
-- a PSP reserve, a self-transfer or Zyon fee revenue. Generation 1 only.
CREATE FUNCTION marketplace_asaas_host_retention_allocation_valid(a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN COALESCE(a->'version'='7'::jsonb AND marketplace_residual_source_cents(a->'hostRetainedCents')
   AND (a->>'hostRetainedCents')::bigint>0 AND marketplace_residual_source_cents(a->'outboundPayoutCents')
   AND (a->>'payoutTotalCents')::bigint=(a->>'hostRetainedCents')::bigint+(a->>'outboundPayoutCents')::bigint
   AND marketplace_asaas_residual_allocation_valid((a-'hostRetainedCents'-'outboundPayoutCents')||'{"version":5}'::jsonb),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_host_retention_request_valid(r jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 RETURN COALESCE(r->'version'='7'::jsonb AND r->>'kind'='host_principal_retention' AND r->>'provider'='asaas' AND r->>'currency'='BRL'
   AND r->>'requestHash'=marketplace_contribution_hash(r-'requestHash')
   AND r->>'basisHash'=marketplace_contribution_hash(r->'basis') AND r->>'allocationHash'=marketplace_contribution_hash(r->'allocation')
   AND r#>'{basis,version}'='7'::jsonb AND marketplace_asaas_host_retention_allocation_valid(r->'allocation')
   AND r->>'fundingPlanId'=r#>>'{basis,fundingPlanId}' AND r->>'instructionsHash'=r#>>'{basis,instructionsHash}'
   AND r->>'budgetHash'=r#>>'{basis,budgetHash}' AND r->>'paymentMethod' IN ('pix','card')
   AND r->>'paymentMethod'=r#>>'{basis,asaasFunding,paymentMethod}' AND r#>>'{capture,provider}'='asaas'
   AND r#>>'{capture,currency}'='BRL' AND r#>>'{capture,providerPaymentId}' ~ '^pay_[A-Za-z0-9_-]+$'
   AND r#>>'{capture,sourceId}'=r#>>'{capture,providerPaymentId}'
   AND r#>>'{capture,environment}' IN ('test','live') AND r#>>'{host,environment}'=r#>>'{capture,environment}'
   AND r#>>'{host,accountFingerprint}'=r#>>'{capture,accountFingerprint}'
   AND r#>>'{host,merchantId}'=r#>>'{basis,asaasFunding,host,merchantId}'
   AND r#>>'{host,walletId}'=r#>>'{basis,asaasFunding,host,walletId}'
   AND r#>>'{host,connectionId}'=marketplace_contribution_hash(jsonb_build_object('merchantId',r#>>'{host,merchantId}','provider','asaas'))
   AND r->'amountCents'=r#>'{allocation,hostRetainedCents}' AND (r->>'amountCents')::bigint>0
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{basis,asaasFunding,destinationAccounts}') a
     WHERE a.value||jsonb_build_object('environment',r#>'{capture,environment}')=r->'host')
   AND (SELECT count(*) FROM jsonb_array_elements(r#>'{allocation,beneficiaries}') b WHERE (b.value->>'amountCents')::bigint>0
     AND b.value->>'destination'=r#>>'{host,walletId}')=1
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{allocation,beneficiaries}') b WHERE b.value->>'merchantId'=r#>>'{host,merchantId}'
     AND b.value->>'destination'=r#>>'{host,walletId}' AND b.value->'amountCents'=r->'amountCents'),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_host_retention_proof_valid(r jsonb,p jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE e jsonb; entries jsonb; refunds jsonb; expected jsonb; source jsonb;
BEGIN
 IF NOT marketplace_asaas_host_retention_request_valid(r) OR p->'version' IS DISTINCT FROM '7'::jsonb
   OR p->>'kind' IS DISTINCT FROM 'host_principal_retention' OR p->>'association' IS DISTINCT FROM 'local_immutable_host_retention_journal'
   OR p->>'requestHash' IS DISTINCT FROM r->>'requestHash' OR p->>'providerPaymentId' IS DISTINCT FROM r#>>'{capture,providerPaymentId}'
   OR p->>'hostAccountFingerprint' IS DISTINCT FROM r#>>'{host,accountFingerprint}' OR p->>'hostWalletId' IS DISTINCT FROM r#>>'{host,walletId}'
   OR p->'amountCents' IS DISTINCT FROM r->'amountCents' OR p->'capturedGrossCents' IS DISTINCT FROM r#>'{capture,amountCents}'
   OR p->'processingFeeCents' IS DISTINCT FROM r#>'{capture,providerFeeCents}' OR p->'refundedCents' IS DISTINCT FROM r#>'{allocation,refundedCents}'
   OR p->>'paymentCreatedDate' IS NULL OR p->>'paymentCreatedDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR NOT isfinite((p->>'paymentCreatedDate')::date) OR extract(year FROM (p->>'paymentCreatedDate')::date)<1
   OR p->>'observedAt' IS NULL OR p->>'observedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]{1,3})?Z$'
   OR NOT isfinite((p->>'observedAt')::timestamptz) OR jsonb_typeof(p->'processingFees') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p->'processingFees')>2000 OR jsonb_typeof(p->'buyerRefundDebits') IS DISTINCT FROM 'array'
   OR jsonb_array_length(p->'buyerRefundDebits')<>jsonb_array_length(r#>'{basis,refunds}')
   OR p#>>'{captureCredit,type}' IS DISTINCT FROM 'PAYMENT_RECEIVED' OR p#>'{captureCredit,amountCents}' IS DISTINCT FROM r#>'{capture,amountCents}'
 THEN RETURN false; END IF;
 entries:=jsonb_build_array(p->'captureCredit')||(p->'processingFees')||(p->'buyerRefundDebits');
 IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(entries))<>jsonb_array_length(entries) THEN RETURN false; END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(entries) LOOP
   IF e->>'id' IS NULL OR e->>'id' !~ '^[A-Za-z0-9_-]{1,100}$' OR e->>'paymentId' IS DISTINCT FROM r#>>'{capture,providerPaymentId}'
     OR e->>'date' IS NULL OR e->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR NOT isfinite((e->>'date')::date)
     OR (e->>'date')::date<(p->>'paymentCreatedDate')::date OR (e->>'date')::date>(substring(p->>'observedAt' FROM 1 FOR 10))::date
     OR jsonb_typeof(e->'amountCents') IS DISTINCT FROM 'number' OR e->>'amountCents' !~ '^-?[0-9]+$'
     OR abs((e->>'amountCents')::bigint)>2147483647 THEN RETURN false; END IF;
   FOR source IN SELECT value FROM jsonb_array_elements(r#>'{basis,asaasFunding,walletReturns}') LOOP
     IF e->>'id' IN (source#>>'{proof,originalHostDebit,id}',source#>>'{proof,originalSellerCredit,id}',source#>>'{proof,sellerReturnDebit,id}',source#>>'{proof,hostReturnCredit,id}')
       OR (source#>>'{proof,hostReturnCredit,date}')::date>(substring(p->>'observedAt' FROM 1 FOR 10))::date THEN RETURN false; END IF;
   END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'processingFees') e WHERE e.value->>'type' IS DISTINCT FROM 'PAYMENT_FEE' OR (e.value->>'amountCents')::bigint>=0)
   OR (SELECT COALESCE(sum(-(value->>'amountCents')::bigint),0) FROM jsonb_array_elements(p->'processingFees'))<>(r#>>'{capture,providerFeeCents}')::bigint
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'buyerRefundDebits') e WHERE e.value->>'type' IS DISTINCT FROM 'PAYMENT_REVERSAL' OR (e.value->>'amountCents')::bigint>=0
     OR (e.value->>'date')::date<(p#>>'{captureCredit,date}')::date) THEN RETURN false; END IF;
 SELECT jsonb_agg(-(value->>'amountCents')::bigint ORDER BY -(value->>'amountCents')::bigint) INTO refunds FROM jsonb_array_elements(p->'buyerRefundDebits');
 SELECT jsonb_agg((value->>'amountCents')::bigint ORDER BY (value->>'amountCents')::bigint) INTO expected FROM jsonb_array_elements(r#>'{basis,refunds}');
 RETURN refunds IS NOT DISTINCT FROM expected;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE TABLE marketplace_asaas_host_retentions (
 id text PRIMARY KEY, residual_plan_id text NOT NULL UNIQUE REFERENCES marketplace_residual_plans(id) ON DELETE RESTRICT,
 host_merchant_id text NOT NULL REFERENCES merchants(id) ON DELETE RESTRICT,
 funding_plan_id text NOT NULL REFERENCES marketplace_funding_plans(payment_intent_id) ON DELETE RESTRICT,
 request_hash text NOT NULL UNIQUE, request jsonb NOT NULL,
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','certified')),
 proof jsonb, certificate_hash text, certified_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(funding_plan_id),
 CHECK(id='ahretain_'||request_hash AND request_hash ~ '^[a-f0-9]{64}$'
   AND request->>'requestHash'=request_hash AND marketplace_asaas_host_retention_request_valid(request)),
 CHECK((status='planned' AND proof IS NULL AND certificate_hash IS NULL AND certified_at IS NULL) OR
   (status='certified' AND proof IS NOT NULL AND certified_at IS NOT NULL AND certificate_hash=marketplace_contribution_hash(jsonb_build_object('request',request,'proof',proof))
     AND marketplace_asaas_host_retention_proof_valid(request,proof)))
);

CREATE FUNCTION marketplace_asaas_host_retention_certificate_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE j marketplace_asaas_host_retentions; e outbox_messages; entries jsonb;
BEGIN
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE residual_plan_id=plan_id;
 IF j.id IS NULL OR j.status<>'certified' OR NOT marketplace_asaas_host_retention_proof_valid(j.request,j.proof)
   OR j.certificate_hash IS DISTINCT FROM marketplace_contribution_hash(jsonb_build_object('request',j.request,'proof',j.proof)) THEN RETURN false; END IF;
 SELECT * INTO e FROM outbox_messages WHERE event_id='marketplace_asaas_host_retention_'||j.id;
 IF e.event_id IS NULL OR e.event_type<>'marketplace.asaas_host_retention.certified' OR e.schema_version<>1 OR e.producer<>'marketplace'
   OR e.merchant_id<>j.host_merchant_id OR e.correlation_id<>j.funding_plan_id OR e.causation_id<>j.id
   OR e.payload IS DISTINCT FROM jsonb_build_object('journal_id',j.id,'residual_plan_id',j.residual_plan_id,'payment_intent_id',j.funding_plan_id,
     'request_hash',j.request_hash,'certificate_hash',j.certificate_hash,'asaas_retention_proof',j.proof,'reconciliation_required',e.payload->'reconciliation_required')
   OR jsonb_typeof(e.payload->'reconciliation_required') IS DISTINCT FROM 'boolean' THEN RETURN false; END IF;
 entries:=jsonb_build_array(j.proof->'captureCredit')||(j.proof->'processingFees')||(j.proof->'buyerRefundDebits');
 RETURN (SELECT count(*) FROM marketplace_asaas_residual_native_identity_claims WHERE owner_kind='host_retention' AND owner_id=j.id AND event_id=e.event_id)=jsonb_array_length(entries)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(entries) entry WHERE NOT EXISTS(
     SELECT 1 FROM marketplace_asaas_residual_native_identity_claims c WHERE c.identity_key='receipt:'||(entry.value->>'id')
       AND c.kind='receipt' AND c.native_id=entry.value->>'id' AND c.account_fingerprint=j.request#>>'{host,accountFingerprint}'
       AND c.owner_kind='host_retention' AND c.owner_id=j.id AND c.event_id=e.event_id));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_host_retention_journal_bound(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE j marketplace_asaas_host_retentions; p marketplace_residual_plans; f marketplace_funding_plans; account jsonb; raw jsonb;
BEGIN
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE residual_plan_id=plan_id;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 SELECT value INTO account FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}')
   WHERE value->>'merchantId'=p.host_merchant_id AND value->>'walletId'=p.basis#>>'{asaasFunding,host,walletId}' AND value->>'accountFingerprint'=f.account_fingerprint;
 raw:=jsonb_build_object('version',7,'kind','host_principal_retention','provider','asaas','currency','BRL','paymentMethod',p.basis#>'{asaasFunding,paymentMethod}',
   'fundingPlanId',p.funding_plan_id,'instructionsHash',f.instructions_hash,'budgetHash',marketplace_contribution_hash(f.budget),'basisHash',p.basis_hash,'allocationHash',p.allocation_hash,
   'capture',f.budget->'capture','host',account||jsonb_build_object('environment',f.environment),'basis',p.basis,'allocation',p.allocation,'amountCents',p.allocation->'hostRetainedCents');
 RETURN COALESCE(j.id IS NOT NULL AND p.id IS NOT NULL AND account IS NOT NULL AND j.host_merchant_id=p.host_merchant_id AND j.funding_plan_id=p.funding_plan_id
   AND j.request=raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw)) AND j.request_hash=marketplace_contribution_hash(raw)
   AND (j.status='planned' OR marketplace_asaas_host_retention_certificate_valid(plan_id)),false);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

-- The next section is generated from the immutable V5 reconstruction. Its
-- source/prefix/fee ownership guards are retained; V7 adds accounting journal.
CREATE FUNCTION marketplace_asaas_host_retention_evidence_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; pi payment_intents; rf record; wr marketplace_asaas_wallet_returns;
 prefix jsonb; receipts jsonb; original jsonb; certificates jsonb; b jsonb; op marketplace_residual_operations; raw jsonb;
 expected_reference text; expected_transfers jsonb; total bigint; retained bigint; merchant_debit bigint; expected_count integer:=0;
 source_receipt jsonb; ev outbox_messages; proof jsonb; j marketplace_asaas_host_retentions;
BEGIN
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 SELECT * INTO f FROM marketplace_funding_plans WHERE payment_intent_id=p.funding_plan_id;
 SELECT * INTO pi FROM payment_intents WHERE id=p.funding_plan_id AND merchant_id=p.host_merchant_id;
 IF p.id IS NULL OR f.payment_intent_id IS NULL OR pi.id IS NULL OR f.provider<>'asaas' OR p.generation<>1
   OR p.host_merchant_id<>f.host_merchant_id OR p.basis->'version' IS DISTINCT FROM '7'::jsonb
   OR NOT marketplace_asaas_host_retention_allocation_valid(p.allocation)
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
 IF NOT marketplace_asaas_host_retention_journal_bound(plan_id) THEN RETURN false; END IF;
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE residual_plan_id=p.id;
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
   INTO expected_transfers FROM jsonb_array_elements(p.allocation->'beneficiaries') WITH ORDINALITY b(value,ord) WHERE (b.value->>'amountCents')::bigint>0 AND b.value->>'destination'<>p.basis#>>'{asaasFunding,host,walletId}';
 FOR b IN SELECT value FROM jsonb_array_elements(p.allocation->'beneficiaries') LOOP
   SELECT COALESCE(sum((d->>'amountCents')::bigint),0) INTO merchant_debit FROM marketplace_refund_plans r,
     jsonb_array_elements(r.allocation->'merchantDebits') d WHERE r.funding_plan_id=f.payment_intent_id AND r.id IN (SELECT value->>'refundPlanId' FROM jsonb_array_elements(p.basis->'refunds')) AND d->>'merchantId'=b->>'merchantId';
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(f.budget->'beneficiaries') original WHERE original.value->>'merchantId'=b->>'merchantId'
       AND original.value->>'destination'=b->>'destination' AND original.value->'providerFeeCents'=b->'providerFeeCents'
       AND (original.value->>'amountCents')::bigint-merchant_debit=(b->>'amountCents')::bigint)
     OR (b->>'amountCents')::bigint>0 AND b->>'destination'=p.basis#>>'{asaasFunding,host,walletId}' AND b->>'merchantId'<>f.host_merchant_id THEN RETURN false; END IF;
   IF (b->>'amountCents')::bigint=0 THEN CONTINUE; END IF;
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') a WHERE a.value->>'merchantId'=b->>'merchantId'
     AND a.value->>'walletId'=b->>'destination' AND a.value->>'accountFingerprint' ~ '^[a-f0-9]{64}$'
     AND a.value->>'connectionId'=marketplace_contribution_hash(jsonb_build_object('merchantId',b->>'merchantId','provider','asaas'))
     AND a.value->>'secretCipherHash' ~ '^[a-f0-9]{64}$') THEN RETURN false; END IF;
   IF b->>'destination'=p.basis#>>'{asaasFunding,host,walletId}' THEN
     IF b->>'merchantId'<>f.host_merchant_id OR b->'amountCents' IS DISTINCT FROM p.allocation->'hostRetainedCents'
       OR EXISTS(SELECT 1 FROM jsonb_array_elements(original) own WHERE own->>'merchantId'=f.host_merchant_id AND own->>'status'<>'planned')
       OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.basis#>'{asaasFunding,destinationAccounts}') own WHERE own->>'merchantId'=f.host_merchant_id
         AND own->>'walletId'=b->>'destination' AND own->>'accountFingerprint'=f.account_fingerprint) THEN RETURN false;END IF;
     CONTINUE;
   END IF;
   expected_count:=expected_count+1;
   SELECT * INTO op FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND beneficiary_merchant_id=b->>'merchantId' AND source_id='original';
   expected_reference:='mresidual_'||marketplace_contribution_hash(jsonb_build_array(f.host_merchant_id,f.payment_intent_id,p.basis_hash,b->>'merchantId'));
   raw:=jsonb_build_object('version',7,'provider','asaas','fundingPlanId',f.payment_intent_id,'beneficiaryMerchantId',b->'merchantId',
     'basisHash',p.basis_hash,'allocationHash',p.allocation_hash,'accountFingerprint',f.account_fingerprint,'providerPaymentId',f.provider_payment_id,
     'destination',b->'destination','amountCents',b->'amountCents','currency','BRL','reference',expected_reference,'capture',f.budget->'capture',
     'asaasFunding',p.basis->'asaasFunding','residualAllocation',p.allocation,'remainingTotalCents',p.allocation->'outboundPayoutCents',
     'refunds',(SELECT jsonb_agg(jsonb_build_object('providerOperationId',value->'providerOperationId','amountCents',value->'amountCents') ORDER BY ord)
       FROM jsonb_array_elements(prefix) WITH ORDINALITY x(value,ord)),'transfers',expected_transfers,'hostRetention',jsonb_build_object('journalId',j.id,'requestHash',j.request_hash));
   IF op.id IS NULL OR op.provider<>'asaas' OR op.account_fingerprint<>f.account_fingerprint OR op.amount_cents<>(b->>'amountCents')::bigint
     OR op.reference<>expected_reference OR op.request IS DISTINCT FROM raw||jsonb_build_object('requestHash',marketplace_contribution_hash(raw))
     OR op.request_hash IS DISTINCT FROM marketplace_contribution_hash(raw) THEN RETURN false; END IF;
   SELECT * INTO ev FROM outbox_messages WHERE event_id='marketplace_asaas_residual_submission_'||op.id;
   IF ev.event_id IS NOT NULL AND NOT marketplace_asaas_host_retention_outbound_event_valid(ev) THEN RETURN false;END IF;
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
 RETURN (SELECT count(*) FROM marketplace_residual_operations WHERE residual_plan_id=p.id)=expected_count
   AND (p.status<>'completed' OR marketplace_asaas_host_retention_certificate_valid(p.id)
     AND NOT EXISTS(SELECT 1 FROM marketplace_residual_operations WHERE residual_plan_id=p.id AND status<>'confirmed'));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

ALTER FUNCTION marketplace_asaas_residual_evidence_valid(text) RENAME TO marketplace_asaas_residual_v5_evidence_valid;
CREATE FUNCTION marketplace_asaas_residual_evidence_valid(plan_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (SELECT basis->'version' FROM marketplace_residual_plans WHERE id=plan_id)='7'::jsonb
   THEN marketplace_asaas_host_retention_evidence_valid(plan_id) ELSE marketplace_asaas_residual_v5_evidence_valid(plan_id) END
$$;
CREATE FUNCTION marketplace_asaas_host_retention_admission_valid(plan_id text) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE p marketplace_residual_plans; f marketplace_funding_plans; pi payment_intents; a jsonb;
BEGIN
 IF NOT marketplace_asaas_host_retention_evidence_valid(plan_id) THEN RETURN false; END IF;
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
ALTER FUNCTION marketplace_asaas_residual_admission_valid(text) RENAME TO marketplace_asaas_residual_v5_admission_valid;
CREATE FUNCTION marketplace_asaas_residual_admission_valid(plan_id text) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE WHEN (SELECT basis->'version' FROM marketplace_residual_plans WHERE id=plan_id)='7'::jsonb
   THEN marketplace_asaas_host_retention_admission_valid(plan_id) ELSE marketplace_asaas_residual_v5_admission_valid(plan_id) END
$$;
ALTER FUNCTION marketplace_asaas_residual_transfer_proof_valid(jsonb,jsonb) RENAME TO marketplace_asaas_residual_v5_transfer_proof_valid;
CREATE FUNCTION marketplace_asaas_residual_transfer_proof_valid(r jsonb,p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT marketplace_asaas_residual_v5_transfer_proof_valid(CASE WHEN r->'version'='7'::jsonb THEN r||'{"version":5}'::jsonb ELSE r END,p)
$$;
ALTER FUNCTION marketplace_residual_allocation_valid(jsonb) RENAME TO marketplace_residual_v1_v6_allocation_valid;
CREATE FUNCTION marketplace_residual_allocation_valid(a jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT CASE WHEN a->'version'='7'::jsonb THEN marketplace_asaas_host_retention_allocation_valid(a) ELSE marketplace_residual_v1_v6_allocation_valid(a) END
$$;

CREATE FUNCTION marketplace_asaas_host_retention_outbound_event_valid(e outbox_messages,fresh boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE o marketplace_residual_operations; p marketplace_residual_plans; j marketplace_asaas_host_retentions; preflight jsonb; expected jsonb;
BEGIN
 SELECT * INTO o FROM marketplace_residual_operations WHERE id=e.causation_id;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=o.residual_plan_id;
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE residual_plan_id=p.id;
 IF o.id IS NULL OR o.request->'version' IS DISTINCT FROM '7'::jsonb OR o.claimed_at IS NULL OR o.status='planned'
   OR e.event_type NOT IN ('marketplace.asaas_residual.submission_authorized','marketplace.residual.confirmed')
   OR e.merchant_id<>p.host_merchant_id OR e.schema_version<>1 OR e.producer<>'marketplace'
   OR e.correlation_id<>p.funding_plan_id OR e.causation_id<>o.id OR NOT marketplace_asaas_host_retention_certificate_valid(p.id) THEN RETURN false; END IF;
 IF e.event_type='marketplace.asaas_residual.submission_authorized' THEN
   preflight:=e.payload->'host_retention_preflight';
   expected:=jsonb_build_object('residual_plan_id',p.id,'operation_id',o.id,'payment_intent_id',p.funding_plan_id,'request_hash',o.request_hash,
     'host_retention_journal_id',j.id,'host_retention_certificate_hash',j.certificate_hash,'host_retention_preflight',preflight);
   IF e.event_id IS DISTINCT FROM 'marketplace_asaas_residual_submission_'||o.id OR e.payload IS DISTINCT FROM expected
     OR NOT marketplace_asaas_host_retention_proof_valid(j.request,preflight)
     OR (preflight-'observedAt') IS DISTINCT FROM (j.proof-'observedAt')
     OR (preflight->>'observedAt')::timestamptz<(e.occurred_at AT TIME ZONE 'UTC')-interval '5 minutes'
     OR (preflight->>'observedAt')::timestamptz>(e.occurred_at AT TIME ZONE 'UTC')+interval '1 minute'
     OR fresh AND (o.status<>'unknown' OR o.provider_transfer_id IS NOT NULL OR p.status<>'prepared' OR (p.due_at AT TIME ZONE 'UTC')>now()
       OR NOT marketplace_asaas_residual_admission_valid(p.id)
       OR (preflight->>'observedAt')::timestamptz<now()-interval '5 minutes' OR (preflight->>'observedAt')::timestamptz>now()+interval '1 minute') THEN RETURN false; END IF;
 ELSE
   IF o.status<>'confirmed' OR e.event_id IS DISTINCT FROM 'marketplace_residual_confirmed_'||o.id
     OR e.payload#>>'{asaas_proof,providerTransferId}' IS DISTINCT FROM o.provider_transfer_id
     OR NOT marketplace_asaas_residual_transfer_proof_valid(o.request,e.payload->'asaas_proof') THEN RETURN false; END IF;
 END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION marketplace_asaas_host_retention_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_immutable'; END IF;
 IF (NEW.id,NEW.residual_plan_id,NEW.host_merchant_id,NEW.funding_plan_id,NEW.request_hash,NEW.request,NEW.created_at)
   IS DISTINCT FROM (OLD.id,OLD.residual_plan_id,OLD.host_merchant_id,OLD.funding_plan_id,OLD.request_hash,OLD.request,OLD.created_at)
   OR OLD.status='certified' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_host_retention_immutable BEFORE UPDATE OR DELETE ON marketplace_asaas_host_retentions
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_immutable();

CREATE FUNCTION marketplace_asaas_host_retention_commit_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p marketplace_residual_plans; plan_id text; j marketplace_asaas_host_retentions;
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN plan_id:=NEW.id;
 ELSIF TG_TABLE_NAME='marketplace_residual_operations' THEN plan_id:=NEW.residual_plan_id;
 ELSE plan_id:=NEW.residual_plan_id;END IF;
 SELECT * INTO p FROM marketplace_residual_plans WHERE id=plan_id;
 IF p.basis->'version' IS DISTINCT FROM '7'::jsonb THEN RETURN NEW; END IF;
 IF NOT marketplace_asaas_host_retention_evidence_valid(plan_id) THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_evidence_unproven'; END IF;
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE residual_plan_id=plan_id;
 IF p.status='completed' AND (p.held_reason IS NOT NULL OR NOT marketplace_asaas_residual_admission_valid(plan_id)
   OR NOT marketplace_asaas_host_retention_certificate_valid(plan_id) OR EXISTS(SELECT 1 FROM marketplace_residual_operations WHERE residual_plan_id=plan_id AND status<>'confirmed'))
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_completion_unproven'; END IF;
 IF TG_OP='INSERT' AND p.status='prepared' AND NOT marketplace_asaas_residual_admission_valid(plan_id)
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_admission_unproven'; END IF;
 IF TG_TABLE_NAME='marketplace_asaas_host_retentions' AND TG_OP='UPDATE' AND NEW.status='certified' AND OLD.status<>'certified'
   AND NOT marketplace_asaas_residual_admission_valid(plan_id) AND (p.status<>'held' OR p.held_reason IS NULL OR NOT EXISTS(
     SELECT 1 FROM outbox_messages WHERE event_id='marketplace_asaas_host_retention_'||NEW.id AND payload->'reconciliation_required'='true'::jsonb))
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_late_certificate_hold_required'; END IF;
 IF TG_TABLE_NAME='marketplace_residual_operations' AND TG_OP='UPDATE' AND NEW.status='confirmed' AND OLD.status<>'confirmed'
   AND NOT marketplace_asaas_residual_admission_valid(plan_id) AND (p.status<>'held' OR p.held_reason IS NULL OR NOT EXISTS(
     SELECT 1 FROM outbox_messages WHERE event_id='marketplace_residual_confirmed_'||NEW.id AND payload->'reconciliation_required'='true'::jsonb))
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_late_receipt_hold_required'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER marketplace_asaas_host_retention_plan_commit AFTER INSERT OR UPDATE ON marketplace_residual_plans
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_asaas_host_retention_operation_commit AFTER INSERT OR UPDATE ON marketplace_residual_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_commit_guard();
CREATE CONSTRAINT TRIGGER marketplace_asaas_host_retention_journal_commit AFTER INSERT OR UPDATE ON marketplace_asaas_host_retentions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_commit_guard();

CREATE FUNCTION marketplace_asaas_host_retention_plan_identity_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='marketplace_residual_plans' THEN
   IF OLD.basis->'version'='7'::jsonb AND (TG_OP='DELETE' OR
     (NEW.id,NEW.funding_plan_id,NEW.host_merchant_id,NEW.generation,NEW.basis,NEW.basis_hash,NEW.allocation,NEW.allocation_hash,NEW.due_at)
       IS DISTINCT FROM (OLD.id,OLD.funding_plan_id,OLD.host_merchant_id,OLD.generation,OLD.basis,OLD.basis_hash,OLD.allocation,OLD.allocation_hash,OLD.due_at))
     THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_plan_immutable'; END IF;
 ELSE
   IF OLD.request->'version'='7'::jsonb AND (TG_OP='DELETE' OR EXISTS(SELECT 1 FROM outbox_messages WHERE event_id='marketplace_asaas_residual_submission_'||OLD.id)
     AND (NEW.status='planned' OR NEW.claimed_at IS NULL OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at))
     THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_claim_immutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_host_retention_plan_identity BEFORE UPDATE OR DELETE ON marketplace_residual_plans
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_plan_identity_guard();
CREATE TRIGGER marketplace_asaas_host_retention_operation_identity BEFORE UPDATE OR DELETE ON marketplace_residual_operations
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_plan_identity_guard();

CREATE FUNCTION marketplace_asaas_host_retention_outbox_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j marketplace_asaas_host_retentions; e outbox_messages; entry jsonb;
BEGIN
 IF TG_OP='DELETE' THEN e:=OLD;ELSE e:=NEW;END IF;
 IF TG_OP IN ('UPDATE','DELETE') AND OLD.event_type='marketplace.asaas_host_retention.certified' THEN
   IF TG_OP='DELETE' OR (NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload)
     IS DISTINCT FROM (OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload)
     THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_event_immutable'; END IF;
 END IF;
 IF e.event_type<>'marketplace.asaas_host_retention.certified' THEN IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END IF;
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE id=e.causation_id;
 IF j.id IS NULL OR j.status<>'certified' OR e.event_id IS DISTINCT FROM 'marketplace_asaas_host_retention_'||j.id
   OR e.merchant_id<>j.host_merchant_id OR e.schema_version<>1 OR e.producer<>'marketplace' OR e.correlation_id<>j.funding_plan_id
   OR NOT marketplace_asaas_host_retention_proof_valid(j.request,j.proof)
   OR e.payload IS DISTINCT FROM jsonb_build_object('journal_id',j.id,'residual_plan_id',j.residual_plan_id,'payment_intent_id',j.funding_plan_id,
     'request_hash',j.request_hash,'certificate_hash',j.certificate_hash,'asaas_retention_proof',j.proof,'reconciliation_required',e.payload->'reconciliation_required')
   OR jsonb_typeof(e.payload->'reconciliation_required') IS DISTINCT FROM 'boolean'
   OR TG_OP='INSERT' AND ((j.proof->>'observedAt')::timestamptz<now()-interval '5 minutes' OR (j.proof->>'observedAt')::timestamptz>now()+interval '1 minute')
   THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_event_unbound'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_host_retention_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_outbox_guard();

CREATE FUNCTION marketplace_asaas_host_retention_capture_native_identities() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j marketplace_asaas_host_retentions; entry jsonb;
BEGIN
 IF NEW.event_type<>'marketplace.asaas_host_retention.certified' THEN RETURN NEW;END IF;
 SELECT * INTO j FROM marketplace_asaas_host_retentions WHERE id=NEW.causation_id;
 FOR entry IN SELECT value FROM jsonb_array_elements(jsonb_build_array(j.proof->'captureCredit')||(j.proof->'processingFees')||(j.proof->'buyerRefundDebits')) LOOP
   PERFORM marketplace_asaas_residual_native_claim('receipt',entry->>'id',j.request#>>'{host,accountFingerprint}','host_retention',j.id,NEW.event_id);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER marketplace_asaas_host_retention_native_identities AFTER INSERT ON outbox_messages
 FOR EACH ROW EXECUTE FUNCTION marketplace_asaas_host_retention_capture_native_identities();

-- Extend registry checks with a new owner. Financial source identity remains
-- globally unique, with an immutable originating certificate/outbox FK.
DO $$ DECLARE c record; expression text; BEGIN
 FOR c IN SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint
   WHERE conrelid='marketplace_asaas_residual_native_identity_claims'::regclass AND contype='c' LOOP
   IF c.definition LIKE '%owner_kind%' THEN
     EXECUTE format('ALTER TABLE marketplace_asaas_residual_native_identity_claims DROP CONSTRAINT %I',c.conname);
   END IF;
 END LOOP;
 ALTER TABLE marketplace_asaas_residual_native_identity_claims ADD CONSTRAINT marketplace_asaas_native_owner_valid
   CHECK(owner_kind IN ('payout','wallet_return','residual','host_retention'));
 ALTER TABLE marketplace_asaas_residual_native_identity_claims ADD CONSTRAINT marketplace_asaas_native_event_valid
   CHECK((owner_kind IN ('residual','host_retention') AND event_id IS NOT NULL) OR (owner_kind IN ('payout','wallet_return') AND event_id IS NULL));
END $$;

-- Preserve installed V5 trigger bodies literally. Only prepend a V7 branch.
DO $$ DECLARE definition text; insertion text; location integer; BEGIN
 definition:=pg_get_functiondef('marketplace_asaas_residual_native_claim_guard()'::regprocedure);
 insertion:=$branch$
 IF NEW.owner_kind='host_retention' THEN
   IF TG_OP<>'INSERT' OR NEW.kind<>'receipt' OR NOT EXISTS(
     SELECT 1 FROM marketplace_asaas_host_retentions j JOIN outbox_messages e ON e.event_id=NEW.event_id
     WHERE j.id=NEW.owner_id AND j.status='certified' AND e.event_type='marketplace.asaas_host_retention.certified'
       AND e.event_id='marketplace_asaas_host_retention_'||j.id AND e.causation_id=j.id
       AND NEW.account_fingerprint=j.request#>>'{host,accountFingerprint}' AND marketplace_asaas_host_retention_proof_valid(j.request,j.proof)
       AND EXISTS(SELECT 1 FROM jsonb_array_elements(jsonb_build_array(j.proof->'captureCredit')||(j.proof->'processingFees')||(j.proof->'buyerRefundDebits')) entry
         WHERE entry.value->>'id'=NEW.native_id)) THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_native_identity_unbound'; END IF;
   RETURN NEW;
 END IF;
$branch$;
 location:=strpos(definition,'BEGIN');IF location=0 THEN RAISE EXCEPTION 'asaas_v5_native_guard_missing';END IF;
 definition:=substring(definition FROM 1 FOR location+4)||insertion||substring(definition FROM location+5);
 definition:=replace(definition,'op.request->''version'' IS DISTINCT FROM ''5''::jsonb','op.request->''version'' NOT IN (''5''::jsonb,''7''::jsonb)');
 EXECUTE definition;
 definition:=pg_get_functiondef('marketplace_asaas_residual_outbox_guard()'::regprocedure);
 insertion:=$branch$
 IF TG_OP='DELETE' THEN e:=OLD;ELSE e:=NEW;END IF;
 IF EXISTS(SELECT 1 FROM marketplace_residual_operations v7 WHERE v7.request->'version'='7'::jsonb AND
   (v7.id=e.causation_id OR TG_OP IN ('UPDATE','DELETE') AND v7.id=OLD.causation_id)) AND
   (e.event_type IN ('marketplace.asaas_residual.submission_authorized','marketplace.residual.confirmed') OR
    TG_OP IN ('UPDATE','DELETE') AND OLD.event_type IN ('marketplace.asaas_residual.submission_authorized','marketplace.residual.confirmed')) THEN
   IF TG_OP='DELETE' OR TG_OP='UPDATE' AND (NEW.event_id,NEW.event_type,NEW.schema_version,NEW.merchant_id,NEW.occurred_at,NEW.correlation_id,NEW.causation_id,NEW.producer,NEW.payload)
     IS DISTINCT FROM (OLD.event_id,OLD.event_type,OLD.schema_version,OLD.merchant_id,OLD.occurred_at,OLD.correlation_id,OLD.causation_id,OLD.producer,OLD.payload)
     THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_financial_event_immutable'; END IF;
   IF NOT marketplace_asaas_host_retention_outbound_event_valid(e,TG_OP='INSERT') THEN RAISE EXCEPTION 'marketplace_asaas_host_retention_outbound_event_unbound'; END IF;
   RETURN NEW;
 END IF;
$branch$;
 location:=strpos(definition,'BEGIN');IF location=0 THEN RAISE EXCEPTION 'asaas_v5_outbox_guard_missing';END IF;
 EXECUTE substring(definition FROM 1 FOR location+4)||insertion||substring(definition FROM location+5);
END $$;

-- Retain exact installed V1-V6 CHECK branches; add only the V7 shape.
DO $$ DECLARE definition text; inherited text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_plans'::regclass AND conname='marketplace_residual_plan_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_plan_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_plans DROP CONSTRAINT marketplace_residual_plan_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_plans ADD CONSTRAINT marketplace_residual_plan_valid CHECK (('||inherited||') OR COALESCE(
   status IN (''prepared'',''completed'',''held'') AND generation=1 AND basis_hash ~ ''^[a-f0-9]{64}$'' AND allocation_hash ~ ''^[a-f0-9]{64}$''
   AND basis->''version''=''7''::jsonb AND allocation->''version''=''7''::jsonb
   AND jsonb_typeof(basis->''refunds'')=''array'' AND jsonb_array_length(basis->''refunds'') BETWEEN 1 AND 2000
   AND jsonb_typeof(basis#>''{asaasFunding,originalPayouts}'')=''array'' AND jsonb_typeof(basis#>''{asaasFunding,walletReturns}'')=''array''
   AND jsonb_typeof(basis#>''{asaasFunding,destinationAccounts}'')=''array'' AND NOT basis ? ''originalTransfers'' AND NOT basis ? ''previousGenerations''
   AND NOT basis ? ''fundingContributions'' AND marketplace_residual_allocation_valid(allocation),false))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_operations'::regclass AND conname='marketplace_residual_source_id_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_source_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_operations DROP CONSTRAINT marketplace_residual_source_id_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_source_id_valid CHECK (('||inherited||') OR COALESCE(
   source_id=''original'' AND request->''version''=''7''::jsonb AND request->>''provider''=''asaas'' AND NOT request ? ''sourceId'',false))';
 SELECT pg_get_constraintdef(oid) INTO definition FROM pg_constraint WHERE conrelid='marketplace_residual_operations'::regclass AND conname='marketplace_residual_operations_valid';
 IF definition NOT LIKE 'CHECK (%)' THEN RAISE EXCEPTION 'marketplace_residual_legacy_operation_constraint_missing';END IF;
 inherited:=substring(definition FROM 8 FOR length(definition)-8);
 ALTER TABLE marketplace_residual_operations DROP CONSTRAINT marketplace_residual_operations_valid;
 EXECUTE 'ALTER TABLE marketplace_residual_operations ADD CONSTRAINT marketplace_residual_operations_valid CHECK (('||inherited||') OR COALESCE(
   status IN (''planned'',''unknown'',''pending'',''confirmed'',''failed'',''cancelled'') AND version>=0 AND amount_cents>0 AND provider=''asaas''
   AND source_id=''original'' AND request_hash ~ ''^[a-f0-9]{64}$'' AND request->''version''=''7''::jsonb
   AND request->>''requestHash''=request_hash AND marketplace_contribution_hash(request-''requestHash'')=request_hash
   AND request->>''reference''=reference AND request->>''provider''=provider AND request->>''accountFingerprint''=account_fingerprint
   AND marketplace_residual_source_cents(request->''amountCents'') AND (request->>''amountCents'')::bigint=amount_cents
   AND request->>''currency''=''BRL'' AND NOT request ? ''sourceId'' AND jsonb_typeof(request->''hostRetention'')=''object''
   AND (status NOT IN (''confirmed'',''failed'') OR provider_transfer_id IS NOT NULL),false))';
END $$;
