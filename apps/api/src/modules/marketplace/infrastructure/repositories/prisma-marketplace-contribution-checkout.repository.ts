import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { MarketplaceContributionActor, MarketplaceContributionCustomerProof } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceRefundContributionCertificate } from "../../domain/ports/marketplace-refund-contribution.port.js";
import type { MarketplaceContributionCheckoutApproval, MarketplaceContributionCheckoutRepository, MarketplaceContributionCheckoutRequest,
  MarketplaceContributionCheckoutJournal, MarketplaceContributionCheckoutObservation, MarketplaceContributionExcessRequest,
  MarketplaceContributionExcessOperation, MarketplaceContributionExcessObservation } from "../../domain/ports/marketplace-contribution-checkout.port.js";
import { validContributionCheckout, validContributionExcess, validContributionExcessProof, certifiedContributionCheckoutCredit, checkoutMetadata } from "../../domain/services/marketplace-contribution-checkout.js";
import { buildMarketplaceRefundContributionPlan, marketplaceContributionHash } from "../../domain/services/marketplace-refund-contribution.js";
import { PrismaMarketplaceRefundContributionRepository, readMarketplaceRefundContributionCredits } from "./prisma-marketplace-refund-contribution.repository.js";

interface Row { id: string; refund_plan_id: string; merchant_id: string; actor_user_id: string; approval_hash: string;
  request: MarketplaceContributionCheckoutRequest; request_hash: string; status: MarketplaceContributionCheckoutJournal["status"]; version: number;
  session_id: string | null; payment_intent_id: string | null; checkout_url: string | null; observation: any; }
interface Liability { amount_cents: number; certificate_hash: string; status: NonNullable<MarketplaceContributionCheckoutJournal["excessStatus"]>;
  returned_cents: number; request: MarketplaceContributionExcessRequest | null; version: number; provider_refund_id: string | null; }
const json = (v: unknown) => JSON.stringify(v);
function fail(reason: string): never { throw new ConflictException(reason); }
const fresh = (v: string) => Number.isFinite(Date.parse(v)) && Date.parse(v)>Date.now()-300_000 && Date.parse(v)<Date.now()+60_000;
const approvalHash = (actor: MarketplaceContributionActor, input: MarketplaceContributionCheckoutApproval) => marketplaceContributionHash({ actor, input });
function journal(row: Row): MarketplaceContributionCheckoutJournal {
  if (!validContributionCheckout(row.request) || row.id!==row.request.contributionId || row.request.refundPlanId!==row.refund_plan_id ||
    row.merchant_id!==row.request.merchantId || row.actor_user_id!==row.request.actorUserId || row.request_hash!==row.request.requestHash) fail("marketplace_contribution_checkout_unproven");
  return { id: row.id, status: row.status, version: row.version, request: row.request,
    ...(row.session_id ? { sessionId: row.session_id } : {}), ...(row.payment_intent_id ? { paymentIntentId: row.payment_intent_id } : {}),
    ...(row.checkout_url && row.status==="open" ? { checkoutUrl: row.checkout_url } : {}) };
}

@Injectable()
export class PrismaMarketplaceContributionCheckoutRepository implements MarketplaceContributionCheckoutRepository {
  constructor(private readonly prisma: PrismaClient, private readonly contributions: PrismaMarketplaceRefundContributionRepository,
    @Optional() private readonly tenants?: TenantContextService) {}
  private seller<T>(actor: MarketplaceContributionActor, work:()=>Promise<T>) {
    return this.tenants ? this.tenants.run({ merchantId: actor.merchantId,userId:actor.userId,role:"system" },async()=>await work()) : work();
  }
  private async actor(actor: MarketplaceContributionActor) {
    const user=await this.seller(actor,async()=>await this.prisma.merchantUser.findFirst({where:{id:actor.userId,merchantId:actor.merchantId,disabledAt:null,role:{in:["owner","admin"]}},select:{id:true}}));
    if (!user) throw new NotFoundException("marketplace_contribution_checkout_not_found");
  }
  private async candidateCustomer(tx: Prisma.TransactionClient, actor: MarketplaceContributionActor, environment:string, account:string) {
    const map=await tx.$queryRaw<Array<{customer_id:string}>>`SELECT customer_id FROM marketplace_refund_contribution_customers
      WHERE merchant_id=${actor.merchantId} AND environment=${environment} AND account_fingerprint=${account}`;
    if(map.length) return map[0]!.customer_id;
    // A billing customer is only an ownership candidate. prepare independently
    // retrieves it on the original account and requires new human consent.
    const subscription=await this.seller(actor,async()=>await tx.merchantBillingSubscription.findUnique({where:{merchantId:actor.merchantId},select:{stripeCustomerId:true}}));
    return subscription?.stripeCustomerId ?? undefined;
  }
  async customerScope(actor: MarketplaceContributionActor, refundPlanId:string, customerId?:string) {
    return this.contributions.withFundingBasis(actor,refundPlanId,async(tx,b)=>{
      const candidate=customerId ?? await this.candidateCustomer(tx,actor,b.instructions.environment,b.instructions.accountFingerprint);
      if(!candidate || !/^cus_[A-Za-z0-9_]+$/.test(candidate)) fail("marketplace_contribution_customer_setup_required");
      return {merchantId:actor.merchantId,customerId:candidate,environment:b.instructions.environment,accountFingerprint:b.instructions.accountFingerprint};
    });
  }
  async prepare(actor: MarketplaceContributionActor,input:MarketplaceContributionCheckoutApproval,customer:MarketplaceContributionCustomerProof) {
    if(input.confirmed!==true || !/^[A-Za-z0-9_-]{1,200}$/.test(input.contributionId) || !/^[A-Za-z0-9_-]{1,200}$/.test(input.refundPlanId) ||
      !Number.isSafeInteger(input.grossAmountCents) || input.grossAmountCents<1 || input.grossAmountCents>2147483647) throw new BadRequestException("invalid_marketplace_contribution_checkout_confirmation");
    return this.contributions.withActorScope(actor,input.refundPlanId,async tx=>{
      const existing=await this.row(tx,input.contributionId);
      if(existing) {if(existing.approval_hash!==approvalHash(actor,input)) fail("marketplace_contribution_checkout_approval_changed");return this.view(tx,existing);}
      // Re-entering the protected basis helper is deliberately avoided inside
      // this transaction. The next callback establishes the financial basis.
      return undefined;
    }).then(async existing=>existing ?? this.contributions.withFundingBasis(actor,input.refundPlanId,async(tx,b)=>{
      const concurrent=await this.row(tx,input.contributionId);
      if(concurrent){if(concurrent.approval_hash!==approvalHash(actor,input)) fail("marketplace_contribution_checkout_approval_changed");return this.view(tx,concurrent);}
      const credits=await readMarketplaceRefundContributionCredits(tx,b.fundingPlanId), plan=buildMarketplaceRefundContributionPlan(b,credits);
      if(plan.cumulativeRefundCents!==b.instructions.amountCents) fail("marketplace_contribution_checkout_full_refund_required");
      const required=plan.requirements.find(v=>v.merchantId===actor.merchantId);
      if(!required?.outstandingCents) fail("marketplace_contribution_checkout_no_deficit");
      const pending=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM marketplace_contribution_checkouts WHERE funding_plan_id=${b.fundingPlanId} AND status NOT IN ('credited','expired')
        UNION ALL SELECT id FROM marketplace_refund_contribution_journals WHERE funding_plan_id=${b.fundingPlanId} AND status<>'credited' LIMIT 1`;
      if(pending.length) fail("marketplace_contribution_pending_approval");
      const candidate=input.customerId ?? await this.candidateCustomer(tx,actor,b.instructions.environment,b.instructions.accountFingerprint);
      if(!customer || customer.customerId!==candidate || customer.merchantId!==actor.merchantId || customer.environment!==b.instructions.environment ||
        customer.accountFingerprint!==b.instructions.accountFingerprint || !fresh(customer.observedAt)) fail("marketplace_contribution_customer_unproven");
      await tx.$executeRaw`INSERT INTO marketplace_refund_contribution_customers(merchant_id,environment,account_fingerprint,customer_id,proof)
        VALUES(${actor.merchantId},${customer.environment},${customer.accountFingerprint},${customer.customerId},${json(customer)}::jsonb) ON CONFLICT DO NOTHING`;
      const map=await this.candidateCustomer(tx,actor,customer.environment,customer.accountFingerprint);
      if(map!==customer.customerId) fail("marketplace_contribution_customer_changed");
      const authorisedAt=new Date().toISOString();
      const raw:Omit<MarketplaceContributionCheckoutRequest,"requestHash">={version:1,reason:"refund_processing_fee_contribution",provider:"stripe",method:"card",currency:"BRL",
        environment:b.instructions.environment,accountFingerprint:b.instructions.accountFingerprint,contributionId:input.contributionId,fundingPlanId:b.fundingPlanId,
        hostMerchantId:b.hostMerchantId,refundPlanId:input.refundPlanId,merchantId:actor.merchantId,actorUserId:actor.userId,customerId:customer.customerId,
        grossAmountCents:input.grossAmountCents,maximumCreditCents:required.outstandingCents,originalPaymentIntentId:b.budget.capture.providerPaymentId,
        originalChargeId:b.budget.capture.sourceId,originalAmountCents:b.instructions.amountCents,
        originalRefundedAmountCents:b.refunds.slice(0,-1).reduce((n,v)=>n+v.allocation.amountCents,0),planHash:plan.planHash,authorisedAt,
        expiresAt:Math.floor(Date.parse(authorisedAt)/1000)+3600,reference:`mcollect_${marketplaceContributionHash([b.fundingPlanId,input.refundPlanId,actor.merchantId,input.contributionId])}`};
      const request={...raw,requestHash:marketplaceContributionHash(raw)};
      if(!validContributionCheckout(request)) fail("marketplace_contribution_checkout_unproven");
      await tx.$executeRaw`INSERT INTO marketplace_contribution_checkouts(id,funding_plan_id,host_merchant_id,refund_plan_id,merchant_id,actor_user_id,approval_hash,
        customer_id,environment,account_fingerprint,request,request_hash,customer_proof,status)
        VALUES(${request.contributionId},${b.fundingPlanId},${b.hostMerchantId},${request.refundPlanId},${actor.merchantId},${actor.userId},${approvalHash(actor,input)},
          ${request.customerId},${request.environment},${request.accountFingerprint},${json(request)}::jsonb,${request.requestHash},${json(customer)}::jsonb,'approved')`;
      await this.emit(tx,actor.merchantId,"approved",request,{gross_amount_cents:request.grossAmountCents,maximum_credit_cents:request.maximumCreditCents});
      return this.view(tx,(await this.row(tx,input.contributionId))!);
    }));
  }
  async get(actor:MarketplaceContributionActor,id:string) {
    const own=await this.owned(actor,id);
    return this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>this.view(tx,(await this.row(tx,id))!));
  }
  async cancel(actor:MarketplaceContributionActor,id:string) {
    const own=await this.owned(actor,id);
    return this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>{
      const row=(await this.row(tx,id))!,r=journal(row).request;
      if(row.status==="expired" && !row.session_id) return this.view(tx,row);
      if(row.status!=="approved") fail("marketplace_contribution_checkout_already_submitted");
      await tx.$executeRaw`UPDATE marketplace_contribution_checkouts SET status='expired',observation=${json({reason:"unsubmitted_approval_cancelled",requestHash:r.requestHash})}::jsonb,
        updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
      await this.emit(tx,row.merchant_id,"expired",r,{reason:"unsubmitted_approval_cancelled"});
      return this.view(tx,(await this.row(tx,id))!);
    });
  }
  async claim(actor:MarketplaceContributionActor,id:string,expectedGross:number) {
    const own=await this.owned(actor,id);
    if(own.status!=="approved") {await this.get(actor,id);return undefined;}
    return this.contributions.withFundingBasis(actor,own.refund_plan_id,async(tx,b)=>{
      const row=(await this.row(tx,id))!, r=journal(row).request;
      if(row.status!=="approved") return undefined;
      if(r.actorUserId!==actor.userId || r.grossAmountCents!==expectedGross) fail("marketplace_contribution_checkout_consent_changed");
      const plan=buildMarketplaceRefundContributionPlan(b,await readMarketplaceRefundContributionCredits(tx,b.fundingPlanId));
      if(plan.planHash!==r.planHash || plan.cumulativeRefundCents!==r.originalAmountCents || r.originalAmountCents!==b.instructions.amountCents) fail("marketplace_contribution_checkout_plan_changed");
      if(r.expiresAt<Math.floor(Date.now()/1000)+1801) fail("marketplace_contribution_checkout_approval_expired");
      await tx.$executeRaw`UPDATE marketplace_contribution_checkouts SET status='creating',version=version+1,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
      await this.emit(tx,actor.merchantId,"submitted",r,{gross_amount_cents:r.grossAmountCents});
      return this.view(tx,(await this.row(tx,id))!);
    });
  }
  async record(actor:MarketplaceContributionActor,id:string,o:MarketplaceContributionCheckoutObservation) {
    const own=await this.owned(actor,id);
    return this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>{
      const row=(await this.row(tx,id))!, r=journal(row).request;
      if(row.status==="credited" || row.status==="expired") return this.view(tx,row);
      if(row.status==="approved") fail("marketplace_contribution_checkout_submission_required");
      if(o.state==="unknown") return this.view(tx,row);
      const s=o.session as any;
      if(o.requestHash!==r.requestHash || !o.observedAt || !fresh(o.observedAt) || !s || s.id!==o.sessionId || s.object!=="checkout.session" ||
        s.customer!==r.customerId || s.mode!=="payment" || s.currency!=="brl" || s.amount_total!==r.grossAmountCents || s.amount_subtotal!==r.grossAmountCents ||
        s.livemode!==(r.environment==="live") || s.client_reference_id!==r.reference || s.expires_at!==r.expiresAt ||
        marketplaceContributionHash(s.metadata)!==marketplaceContributionHash(checkoutMetadata(r)) ||
        marketplaceContributionHash(s.payment_method_types)!==marketplaceContributionHash(["card"]) ||
        s.total_details?.amount_discount!==0 || s.total_details?.amount_shipping!==0 || s.total_details?.amount_tax!==0 || s.subscription || s.setup_intent ||
        o.state==="paid" && (s.status!=="complete" || s.payment_status!=="paid" || s.payment_intent!==o.paymentIntentId || !/^pi_[A-Za-z0-9_]+$/.test(o.paymentIntentId ?? "")) ||
        o.state==="open" && (s.status!=="open" || s.payment_status!=="unpaid" || s.url!==o.checkoutUrl) ||
        o.state==="expired" && (s.status!=="expired" || s.payment_status!=="unpaid")) fail("marketplace_contribution_checkout_receipt_unproven");
      if(row.session_id && row.session_id!==o.sessionId || row.payment_intent_id && row.payment_intent_id!==o.paymentIntentId || row.status==="paid" && o.state!=="paid") fail("marketplace_contribution_checkout_receipt_changed");
      if(o.checkoutUrl){const u=new URL(o.checkoutUrl);if(u.protocol!=="https:" || u.hostname!=="checkout.stripe.com" || u.username || u.password || u.port) fail("marketplace_contribution_checkout_url_unproven");}
      if(o.state==="paid" && o.paymentIntentId===r.originalPaymentIntentId) fail("marketplace_contribution_original_receipt_forbidden");
      await tx.$executeRaw`UPDATE marketplace_contribution_checkouts SET status=${o.state},session_id=${o.sessionId!},payment_intent_id=${o.paymentIntentId ?? row.payment_intent_id},
        checkout_url=${o.checkoutUrl ?? null},observation=${json(o)}::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
      if(row.status!==o.state && ["paid","expired"].includes(o.state)) await this.emit(tx,row.merchant_id,o.state,r,{gross_amount_cents:r.grossAmountCents});
      return this.view(tx,(await this.row(tx,id))!);
    });
  }
  async reconcileCredit(actor:MarketplaceContributionActor,id:string) {
    const own=await this.owned(actor,id);
    await this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>{
      const row=(await this.row(tx,id))!;
      if(row.status==="credited") return;
      const credit=await tx.$queryRaw<Array<{certificate:MarketplaceRefundContributionCertificate}>>`SELECT certificate FROM marketplace_refund_contribution_credits WHERE id=${id}`;
      const c=credit[0]?.certificate;
      if(row.status!=="paid" || !c || c.request.collection?.requestHash!==row.request_hash || c.request.collection.journalId!==id ||
        c.request.providerPaymentIntentId!==row.payment_intent_id || c.request.customerId!==row.request.customerId) fail("marketplace_contribution_checkout_credit_unproven");
      await tx.$executeRaw`UPDATE marketplace_contribution_checkouts SET status='credited',updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
    });
  }
  private async canReturn(tx:Prisma.TransactionClient,r:MarketplaceContributionCheckoutRequest) {
    const rows=await tx.$queryRaw<Array<{ok:boolean}>>`SELECT (p.status='refunded' AND p.amount_cents=${r.originalAmountCents}
      AND l.purchased_at IS NOT NULL AND l.chargeback_at IS NULL AND EXISTS(SELECT 1 FROM marketplace_refund_plans rp
        WHERE rp.id=${r.refundPlanId} AND rp.status='confirmed' AND (rp.allocation->>'cumulativeRefundCents')::bigint=${r.originalAmountCents})
      AND NOT EXISTS(SELECT 1 FROM marketplace_refund_plans rp LEFT JOIN marketplace_refund_operations o ON o.refund_plan_id=rp.id
        WHERE rp.funding_plan_id=${r.fundingPlanId} AND (rp.status<>'confirmed' OR o.status IS DISTINCT FROM 'confirmed' OR o.provider_operation_id IS NULL OR o.reconciled_at IS NULL))
      AND NOT EXISTS(SELECT 1 FROM marketplace_payouts WHERE funding_plan_id=${r.fundingPlanId} AND (status<>'planned' OR claimed_at IS NOT NULL OR provider_transfer_id IS NOT NULL))
      AND NOT EXISTS(SELECT 1 FROM marketplace_residual_plans WHERE funding_plan_id=${r.fundingPlanId})
      AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recoveries WHERE funding_plan_id=${r.fundingPlanId})
      AND NOT EXISTS(SELECT 1 FROM marketplace_transfer_recovery_credits WHERE funding_plan_id=${r.fundingPlanId})) AS ok
      FROM payment_intents p JOIN marketplace_order_ledgers l ON l.host_merchant_id=p.merchant_id AND l.order_id=p.provider_payment_id
      WHERE p.id=${r.fundingPlanId} AND p.merchant_id=${r.hostMerchantId} AND p.provider_payment_id=${r.originalPaymentIntentId}`;
    return rows.length===1 && rows[0]!.ok===true;
  }
  async claimExcess(actor:MarketplaceContributionActor,id:string,amount:number,reconcileOnly:boolean) {
    const own=await this.owned(actor,id);
    return this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>{
      const row=(await this.row(tx,id))!, r=journal(row).request;
      const l=(await tx.$queryRaw<Liability[]>`SELECT * FROM marketplace_contribution_excess_liabilities WHERE contribution_id=${id} FOR UPDATE`)[0];
      if(!l || l.status==="returned" || reconcileOnly && l.status==="held") return undefined;
      if(!Number.isSafeInteger(amount) || amount!==l.amount_cents || !await this.canReturn(tx,r)) fail("marketplace_contribution_excess_not_returnable");
      if(l.request){if(!validContributionExcess(l.request)) fail("marketplace_contribution_excess_unproven");return {request:l.request,version:l.version,submit:false,...(l.provider_refund_id?{providerRefundId:l.provider_refund_id}:{})};}
      const c=(await tx.$queryRaw<Array<{certificate:MarketplaceRefundContributionCertificate}>>`SELECT certificate FROM marketplace_refund_contribution_credits WHERE id=${id}`)[0]?.certificate;
      if(!c || c.excessLiabilityCents!==amount || c.certificateHash!==l.certificate_hash) fail("marketplace_contribution_excess_unproven");
      const raw={contributionId:id,hostMerchantId:r.hostMerchantId,fundingPlanId:r.fundingPlanId,merchantId:r.merchantId,
        accountFingerprint:r.accountFingerprint,environment:r.environment,amountCents:amount,certificate:c,originalAmountCents:r.originalAmountCents,
        reference:`mexcess_${marketplaceContributionHash([id,c.certificateHash,amount])}`};
      const request={...raw,requestHash:marketplaceContributionHash(raw)};
      if(!validContributionExcess(request)) fail("marketplace_contribution_excess_unproven");
      await tx.$executeRaw`UPDATE marketplace_contribution_excess_liabilities SET status='unknown',request=${json(request)}::jsonb,
        request_hash=${request.requestHash},version=version+1,submitted_at=CURRENT_TIMESTAMP WHERE contribution_id=${id}`;
      return {request,version:l.version+1,submit:true};
    });
  }
  async recordExcess(actor:MarketplaceContributionActor,op:MarketplaceContributionExcessOperation,o:MarketplaceContributionExcessObservation) {
    const own=await this.owned(actor,op.request.contributionId);
    await this.contributions.withActorScope(actor,own.refund_plan_id,async tx=>{
      const l=(await tx.$queryRaw<Liability[]>`SELECT * FROM marketplace_contribution_excess_liabilities WHERE contribution_id=${own.id} FOR UPDATE`)[0];
      if(!l || l.version!==op.version || marketplaceContributionHash(l.request)!==marketplaceContributionHash(op.request)) fail("marketplace_contribution_excess_claim_changed");
      if(l.status==="returned") return;
      if(o.state==="unknown") return;
      if(!/^re_[A-Za-z0-9_]+$/.test(o.providerRefundId ?? "") || l.provider_refund_id && l.provider_refund_id!==o.providerRefundId) fail("marketplace_contribution_excess_receipt_changed");
      if(o.state==="confirmed") {
        const p=o.proof;
        if(o.amountCents!==l.amount_cents || !validContributionExcessProof(op.request,o)) fail("marketplace_contribution_excess_receipt_unproven");
        await tx.$executeRaw`UPDATE marketplace_contribution_excess_liabilities SET status='returned',provider_refund_id=${o.providerRefundId!},
          proof=${json(p)}::jsonb,returned_cents=amount_cents,returned_at=CURRENT_TIMESTAMP WHERE contribution_id=${own.id}`;
        await this.emit(tx,own.merchant_id,"excess_returned",own.request,{returned_excess_cents:l.amount_cents,refund_request_hash:op.request.requestHash});
      } else await tx.$executeRaw`UPDATE marketplace_contribution_excess_liabilities SET status=${o.state},provider_refund_id=${o.providerRefundId!} WHERE contribution_id=${own.id}`;
    });
  }
  async listUnresolved(limit:number) {
    this.limit(limit);
    const rows=await this.prisma.$queryRaw<Array<{id:string;merchant_id:string;actor_user_id:string}>>`SELECT c.id,c.merchant_id,c.actor_user_id FROM marketplace_contribution_checkouts c
      LEFT JOIN marketplace_contribution_excess_liabilities l ON l.contribution_id=c.id WHERE c.status IN ('creating','open','paid','unproven') OR l.status IN ('unknown','pending')
      ORDER BY c.updated_at,c.id LIMIT ${limit}`;
    return rows.map(v=>({actor:{merchantId:v.merchant_id,userId:v.actor_user_id},contributionId:v.id}));
  }
  async context(actor:MarketplaceContributionActor,refundPlanId:string) {
    return this.contributions.withFundingBasis(actor,refundPlanId,async(tx,b)=>{
      const p=buildMarketplaceRefundContributionPlan(b,await readMarketplaceRefundContributionCredits(tx,b.fundingPlanId));
      const required=p.requirements.find(v=>v.merchantId===actor.merchantId);
      if(!required) throw new NotFoundException("marketplace_contribution_checkout_not_found");
      const customer=await this.candidateCustomer(tx,actor,b.instructions.environment,b.instructions.accountFingerprint);
      const pending=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM marketplace_contribution_checkouts WHERE funding_plan_id=${b.fundingPlanId} AND status NOT IN ('credited','expired')
        UNION ALL SELECT id FROM marketplace_refund_contribution_journals WHERE funding_plan_id=${b.fundingPlanId} AND status<>'credited' LIMIT 1`;
      const full=p.cumulativeRefundCents===b.instructions.amountCents,setup=!customer || !/^cus_[A-Za-z0-9_]+$/.test(customer);
      return {refund_plan_id:refundPlanId,environment:b.instructions.environment,required_net_cents:required.requiredCents,outstanding_net_cents:required.outstandingCents,
        customer_setup_required:setup,can_create:full && !setup && !pending.length && required.outstandingCents>0,
        ...(!full?{block_reason:"marketplace_contribution_checkout_full_refund_required"}:pending.length?{block_reason:"marketplace_contribution_pending_approval"}:{})};
    });
  }
  async list(actor:MarketplaceContributionActor,limit:number,cursor?:string) {
    this.limit(limit);await this.actor(actor);let after="";
    if(cursor){try{const c=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));if(c.merchantId!==actor.merchantId || typeof c.after!=="string" || c.after.length>205) throw Error();after=c.after;}catch{throw new BadRequestException("invalid_marketplace_contribution_cursor");}}
    const rows=await this.prisma.$queryRaw<Array<{key:string;id:string;kind:string}>>`SELECT * FROM (
      SELECT 'c:'||c.id AS key,c.id,'journal' AS kind FROM marketplace_contribution_checkouts c WHERE c.merchant_id=${actor.merchantId}
      UNION ALL SELECT DISTINCT 'r:'||r.id AS key,r.id,'candidate' AS kind FROM marketplace_refund_plans r JOIN marketplace_payouts p ON p.funding_plan_id=r.funding_plan_id
        JOIN marketplace_funding_plans f ON f.payment_intent_id=r.funding_plan_id WHERE p.beneficiary_merchant_id=${actor.merchantId}
        AND r.status='blocked' AND r.block_reason='marketplace_refund_seller_contribution_required'
        AND (r.allocation->>'cumulativeRefundCents')::bigint=f.amount_cents
        AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.allocation->'requiredContributions') v WHERE v->>'merchantId'=${actor.merchantId})
        AND NOT EXISTS(SELECT 1 FROM marketplace_contribution_checkouts c WHERE c.refund_plan_id=r.id AND c.merchant_id=${actor.merchantId} AND c.status NOT IN ('credited','expired'))
      ) q WHERE q.key>${after} ORDER BY q.key LIMIT ${limit+1}`;
    const items:Array<MarketplaceContributionCheckoutJournal | Awaited<ReturnType<typeof this.context>>>=[];
    for(const row of rows.slice(0,limit)) items.push(row.kind==="journal" ? await this.get(actor,row.id) : await this.context(actor,row.id));
    return {items,...(rows.length>limit?{nextCursor:Buffer.from(json({merchantId:actor.merchantId,after:rows[limit-1]!.key})).toString("base64url")}:{})};
  }
  private limit(value:number){if(!Number.isSafeInteger(value)||value<1||value>100) throw new BadRequestException("invalid_marketplace_contribution_limit");}
  private async row(tx:Prisma.TransactionClient,id:string){return (await tx.$queryRaw<Row[]>`SELECT * FROM marketplace_contribution_checkouts WHERE id=${id} FOR UPDATE`)[0];}
  private async owned(actor:MarketplaceContributionActor,id:string){await this.actor(actor);const row=(await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_contribution_checkouts WHERE id=${id} AND merchant_id=${actor.merchantId}`)[0];if(!row)throw new NotFoundException("marketplace_contribution_checkout_not_found");return row;}
  private async view(tx:Prisma.TransactionClient,row:Row){const result=journal(row);
    const c=(await tx.$queryRaw<Array<{credit_cents:number;processing_fee_cents:number;certificate:MarketplaceRefundContributionCertificate}>>`
      SELECT c.credit_cents,c.processing_fee_cents,c.certificate FROM marketplace_refund_contribution_credits c
      JOIN marketplace_refund_contribution_journals j ON j.id=c.id AND j.status='credited' AND j.certificate=c.certificate
        AND j.certificate_hash=c.certificate_hash AND j.credit_sequence=c.credit_sequence WHERE c.id=${row.id}`)[0];
    const l=(await tx.$queryRaw<Liability[]>`SELECT * FROM marketplace_contribution_excess_liabilities WHERE contribution_id=${row.id}`)[0];
    if(c && (!["paid","credited"].includes(row.status) || !certifiedContributionCheckoutCredit(row.request,c.certificate) ||
      c.credit_cents!==c.certificate.creditCents || c.processing_fee_cents!==c.certificate.processingFeeCents) || row.status==="credited" && !c ||
      l && (!c || l.certificate_hash!==c.certificate.certificateHash || l.amount_cents!==c.certificate.excessLiabilityCents) ||
      c && !!c.certificate.excessLiabilityCents!==!!l) fail("marketplace_contribution_checkout_credit_unproven");
    return {...result,...(c?{creditCertified:true,creditedNetCents:c.credit_cents,processingFeeCents:c.processing_fee_cents,excessLiabilityCents:c.certificate.excessLiabilityCents??0}:{}),
      ...(l?{returnedExcessCents:l.returned_cents,excessStatus:l.status,canReturnExcess:row.status==="credited" && l.status==="held" && await this.canReturn(tx,row.request)}:{})};}
  private async emit(tx:Prisma.TransactionClient,merchantId:string,suffix:string,r:MarketplaceContributionCheckoutRequest,payload:Record<string,unknown>){
    await this.seller({merchantId,userId:r.actorUserId},async()=>await tx.outboxMessage.create({data:{eventId:`marketplace_contribution_checkout_${suffix}_${r.contributionId}`,
      eventType:suffix==="excess_returned"?"marketplace.contribution_excess_returned":`marketplace.contribution_checkout_${suffix}`,schemaVersion:1,merchantId,occurredAt:new Date(),
      correlationId:r.fundingPlanId,causationId:r.refundPlanId,producer:"marketplace",payload:{contribution_id:r.contributionId,refund_plan_id:r.refundPlanId,request_hash:r.requestHash,...payload}}}));
  }
}
