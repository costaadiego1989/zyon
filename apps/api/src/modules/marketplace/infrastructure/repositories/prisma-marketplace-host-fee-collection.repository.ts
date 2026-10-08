import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { MarketplaceContributionActor, MarketplaceContributionCustomerProof } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceHostFeeCollectionRepository, MarketplaceHostFeeCollectionApproval, MarketplaceHostFeeCollectionRequest,
  MarketplaceHostFeeCollectionJournal, MarketplaceHostFeeCollectionObservation, MarketplaceHostFeeCredit,
  MarketplaceHostFeeContext, MarketplaceHostFeeCandidate } from "../../domain/ports/marketplace-host-fee-collection.port.js";
import type { MarketplaceHostPrincipalExtinctionEvidence } from "../../domain/ports/marketplace-order-dispute-closure.port.js";
import type { MarketplaceDisputeClosureRequest } from "../../domain/ports/marketplace-dispute-closure.port.js";
import { marketplaceHostPrincipalExtinctionId } from "../../domain/services/marketplace-order-dispute-closure.js";
import { lockMarketplaceOrder } from "./prisma-marketplace-funding.repository.js";
import { marketplaceContributionHash as hash } from "../../domain/services/marketplace-refund-contribution.js";
import { buildHostFeeCredit, hostFeeSessionObservation, validHostFeeCollection, buildMarketplaceHostDisputeObligation,
  marketplaceHostDisputeObligationId, marketplaceHostDisputeObligationPayload } from "../../domain/services/marketplace-host-fee-collection.js";

import type { MarketplaceFeeExcessRequest, MarketplaceFeeExcessOperation, MarketplaceFeeExcessObservation, MarketplaceFeeExcessReturn, MarketplaceFeeExcessStatus } from "../../domain/ports/marketplace-fee-excess-return.port.js";
import { validMarketplaceFeeExcessRequest, buildMarketplaceFeeExcessReturn, marketplaceFeeExcessReference } from "../../domain/services/marketplace-fee-excess-return.js";

interface Row { id:string; debt_id:string; fee_certificate_id:string; funding_plan_id:string; host_merchant_id:string;
  merchant_id:string; actor_user_id:string; approval_hash:string; customer_id:string; environment:string; account_fingerprint:string;
  request:MarketplaceHostFeeCollectionRequest; request_hash:string; status:MarketplaceHostFeeCollectionJournal["status"]; version:number;
  session_id:string|null; payment_intent_id:string|null; checkout_url:string|null; observation:any; excess_return_status:MarketplaceFeeExcessStatus; returned_excess_cents:number;
  excess_return_request:MarketplaceFeeExcessRequest|null; excess_return_provider_refund_id:string|null; }
interface Basis { evidence:MarketplaceHostPrincipalExtinctionEvidence; certificateId:string; certificateHash:string;
  request:MarketplaceDisputeClosureRequest; credits:MarketplaceHostFeeCredit[]; returns:MarketplaceFeeExcessReturn[]; }
const json=(v:unknown)=>JSON.stringify(v);
const same=(a:unknown,b:unknown)=>hash(a)===hash(b);
const id=(v:unknown):v is string=>typeof v==="string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const fresh=(v:string)=>Number.isFinite(Date.parse(v)) && Date.parse(v)>=Date.now()-300000 && Date.parse(v)<=Date.now()+60000;
function fail(reason="marketplace_host_fee_collection_unproven"):never{throw new ConflictException(reason);}
const eventId=(r:MarketplaceHostFeeCollectionRequest,state:string)=>`mhostfee_collection_${state}_${hash([r.collectionId,r.requestHash])}`;
const payload=(r:MarketplaceHostFeeCollectionRequest)=>({collection_id:r.collectionId,debt_id:r.debtId,fee_certificate_id:r.feeCertificateId,
  funding_plan_id:r.fundingPlanId,host_merchant_id:r.merchantId,request_hash:r.requestHash});
const creditPayload=(c:MarketplaceHostFeeCredit)=>({...payload(c.request),credit_cents:c.creditCents,processing_fee_cents:c.processingFeeCents,
  excess_liability_cents:c.excessLiabilityCents,certificate_hash:c.certificateHash});

/** A fee receipt has its own purpose and journal. It never changes the historical
 * principal certificate, funding budget, hold or original payout permission. */
@Injectable()
export class PrismaMarketplaceHostFeeCollectionRepository implements MarketplaceHostFeeCollectionRepository {
  constructor(private readonly prisma:PrismaClient,@Optional() private readonly tenants?:TenantContextService) {}
  private scoped<T>(actor:MarketplaceContributionActor,work:()=>Promise<T>) {
    return this.tenants?this.tenants.run({merchantId:actor.merchantId,userId:actor.userId,role:"system"},async()=>await work()):work();
  }
  private async active(actor:MarketplaceContributionActor,tx:Prisma.TransactionClient|PrismaClient=this.prisma) {
    if(!id(actor.merchantId)||!id(actor.userId))this.missing();
    const u=await this.scoped(actor,async()=>await tx.merchantUser.findFirst({where:{id:actor.userId,merchantId:actor.merchantId,disabledAt:null,role:{in:["owner","admin"]}},select:{id:true}}));
    if(!u)this.missing();
  }
  private async actor(actor:MarketplaceContributionActor) {
    const current=this.tenants?.get();
    if(current && (current.merchantId!==actor.merchantId || current.userId!==actor.userId))this.missing();
    await this.active(actor);
  }
  private missing():never{throw new NotFoundException("marketplace_host_fee_collection_not_found");}
  private async withBasis<T>(actor:MarketplaceContributionActor,debtId:string,work:(tx:Prisma.TransactionClient,b:Basis)=>Promise<T>):Promise<T> {
    await this.actor(actor);if(!id(debtId))this.missing();
    // Host debtId is an original host payout. Ownership is proven before locks;
    // this journey never creates a synthetic seller debt or settlement.
    const anchors=await this.prisma.$queryRaw<Array<{host_merchant_id:string;funding_plan_id:string;provider_payment_id:string}>>`
      SELECT f.host_merchant_id,p.funding_plan_id,f.provider_payment_id FROM marketplace_host_debts d
      JOIN marketplace_payouts p ON p.id=d.payout_id AND p.kind='host_receivable' AND p.beneficiary_merchant_id=d.host_merchant_id
      JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id
      WHERE d.payout_id=${debtId} AND d.host_merchant_id=${actor.merchantId} AND f.host_merchant_id=${actor.merchantId}`;
    if(anchors.length!==1)this.missing();const anchor=anchors[0]!;
    return this.scoped({merchantId:anchor.host_merchant_id,userId:actor.userId},()=>this.prisma.$transaction(async tx=>{
      await this.active(actor,tx);await lockMarketplaceOrder(tx,anchor.host_merchant_id,anchor.provider_payment_id);
      await tx.$queryRaw`SELECT payment_intent_id FROM marketplace_funding_plans
        WHERE payment_intent_id=${anchor.funding_plan_id} AND host_merchant_id=${actor.merchantId} FOR UPDATE`;
      const rows=await tx.$queryRaw<Array<{id:string;evidence_hash:string;evidence:MarketplaceHostPrincipalExtinctionEvidence;
        expected_evidence:MarketplaceHostPrincipalExtinctionEvidence|null;valid:boolean;request:MarketplaceDisputeClosureRequest}>>`
        SELECT c.id,c.evidence_hash,c.evidence,s.request,marketplace_host_principal_extinction_valid(c.payout_id) AS valid,
          marketplace_host_principal_extinction_evidence(c.payout_id) AS expected_evidence FROM marketplace_host_principal_extinctions c
        JOIN marketplace_dispute_closure_snapshots s ON s.id=c.closure_snapshot_id
        WHERE c.payout_id=${debtId} AND c.host_merchant_id=${actor.merchantId}
          AND c.funding_plan_id=${anchor.funding_plan_id} FOR UPDATE OF c`;
      const c=rows[0];if(rows.length!==1 || !c || c.valid!==true || c.evidence.version!==1 ||
        c.evidence.reason!=="stripe_host_dispute_principal_extinguished" || c.evidence.hostDisputeFeeCents<=0 ||
        c.evidence.feeCollectionState!=="uncollected" || c.evidence.payoutId!==debtId || c.evidence.hostMerchantId!==actor.merchantId ||
        c.evidence.fundingPlanId!==anchor.funding_plan_id || c.id!==marketplaceHostPrincipalExtinctionId(c.evidence) ||
        c.evidence_hash!==hash(c.evidence) || !c.expected_evidence || !same(c.expected_evidence,c.evidence) ||
        c.request.hostMerchantId!==actor.merchantId || c.request.paymentIntentId!==anchor.funding_plan_id ||
        c.request.requestHash!==c.evidence.requestHash || c.request.providerDisputeId!==c.evidence.providerDisputeId)fail();
      const b:Basis={evidence:c.evidence,certificateId:c.id,certificateHash:c.evidence_hash,request:c.request,credits:[],returns:[]};
      b.credits=await this.credits(tx,b);b.returns=await this.excessReturns(tx,b);return work(tx,b);
    },{timeout:30000}));
  }
  private async credits(tx:Prisma.TransactionClient,b:Basis) {
    const rows=await tx.$queryRaw<Array<any>>`SELECT c.*,marketplace_host_fee_credit_valid(c.id) AS valid,j.request,j.status,j.session_id,j.payment_intent_id,e.event_id,e.event_type,
      e.merchant_id AS event_merchant,e.correlation_id,e.causation_id,e.producer,e.schema_version,e.payload
      FROM marketplace_host_fee_credits c JOIN marketplace_host_fee_collections j ON j.id=c.id
      LEFT JOIN outbox_messages e ON e.event_id='mhostfee_collection_credited_'||marketplace_contribution_hash(jsonb_build_array(j.id,j.request_hash))
      WHERE c.fee_certificate_id=${b.certificateId} ORDER BY c.credit_sequence LIMIT 2001`;
    if(rows.length>2000)fail();const credits:MarketplaceHostFeeCredit[]=[],seen=new Set<string>();let sum=0;
    for(const row of rows) {
      const c=row.certificate as MarketplaceHostFeeCredit,r=row.request as MarketplaceHostFeeCollectionRequest;
      const expected=buildHostFeeCredit(r,c?.proof,new Date(c?.proof?.observedAt),false);
      if(row.valid!==true || !expected || !same(expected,c) || !this.bound(r,b) || r.maximumCreditCents!==b.evidence.hostDisputeFeeCents-sum ||
        !same(r.priorCreditHashes,credits.map(v=>v.certificateHash)) || row.status!=="credited" || row.id!==r.collectionId || row.credit_sequence!==credits.length+1 ||
        row.merchant_id!==r.merchantId || row.funding_plan_id!==r.fundingPlanId || row.host_merchant_id!==r.hostMerchantId || row.environment!==r.environment ||
        row.account_fingerprint!==r.accountFingerprint || row.request_hash!==r.requestHash || row.certificate_hash!==c.certificateHash ||
        row.session_id!==c.proof.sessionId || row.payment_intent_id!==c.proof.paymentIntent.id || row.provider_payment_intent_id!==c.proof.paymentIntent.id ||
        row.provider_charge_id!==c.proof.charge.id || row.provider_balance_transaction_id!==c.proof.balance.id ||
        row.credit_cents!==c.creditCents || row.processing_fee_cents!==c.processingFeeCents || row.excess_liability_cents!==c.excessLiabilityCents ||
        row.event_id!==eventId(r,"credited") || row.event_type!=="marketplace.host_fee_collection_credited" || row.event_merchant!==r.merchantId ||
        row.correlation_id!==r.fundingPlanId || row.causation_id!==r.debtId || row.producer!=="marketplace" || row.schema_version!==1 || !same(row.payload,creditPayload(c)))fail();
      for(const receipt of [c.proof.paymentIntent.id,c.proof.charge.id,c.proof.balance.id]) {if(seen.has(receipt))fail();seen.add(receipt);}
      sum+=c.creditCents;if(sum>b.evidence.hostDisputeFeeCents)fail();credits.push(c);
    }
    return credits;
  }
  private bound(r:MarketplaceHostFeeCollectionRequest,b:Basis) {return validHostFeeCollection(r) && r.feeCertificateId===b.certificateId &&
    r.feeCertificateHash===b.certificateHash && same(r.feeEvidence,b.evidence) && same(r.disputeRequest,b.request);}
  private async excessReturns(tx:Prisma.TransactionClient,b:Basis):Promise<MarketplaceFeeExcessReturn[]> {
    const rows=await tx.$queryRaw<Array<{certificate:MarketplaceFeeExcessReturn;valid:boolean}>>`
      SELECT j.excess_return_certificate AS certificate,marketplace_fee_excess_return_valid('host',j.id) AS valid
      FROM marketplace_host_fee_collections j JOIN marketplace_host_fee_credits c ON c.id=j.id
      WHERE j.fee_certificate_id=${b.certificateId} AND j.excess_return_status='returned' ORDER BY c.credit_sequence`;
    return rows.map(row=>{
      const r=row.certificate,expected=buildMarketplaceFeeExcessReturn(r?.request,{state:"confirmed",providerRefundId:r?.proof?.refund?.id,proof:r?.proof},new Date(r?.proof?.observedAt),false);
      if(!row.valid || !expected || !same(expected,r) || !b.credits.some(c=>same(c,r.request.credit)))fail("marketplace_host_fee_excess_return_unproven");
      return r;
    });
  }
  private outstandingExcess(b:Basis){return b.credits.reduce((n,c)=>n+c.excessLiabilityCents,0)-b.returns.reduce((n,r)=>n+r.request.amountCents,0);}
  private excessView(row:Row,c:MarketplaceHostFeeCredit,b:Basis) {
    const returned=row.returned_excess_cents,receipt=b.returns.find(r=>r.request.credit.request.collectionId===row.id);
    if(!Number.isSafeInteger(returned)||returned<0||returned>c.excessLiabilityCents || (row.excess_return_status==="returned")!==Boolean(receipt) ||
      receipt && returned!==receipt.request.amountCents)fail("marketplace_host_fee_excess_return_unproven");
    return {returnedExcessCents:returned,outstandingExcessCents:c.excessLiabilityCents-returned,excessStatus:row.excess_return_status,
      canReturnExcess:c.excessLiabilityCents>0 && row.excess_return_status==="held" && !row.excess_return_request,
      ...(receipt?{excessReturn:receipt}:{})};
  }
  async claimExcess(actor:MarketplaceContributionActor,collectionId:string,amountCents:number,recovery=false):Promise<MarketplaceFeeExcessOperation|undefined> {
    const own=await this.owned(actor,collectionId);return this.withBasis(actor,own.debt_id,async(tx,b)=>{
      const row=(await this.row(tx,collectionId))!,journal=this.view(row,b),credit=journal.credit;
      if(!credit || row.status!=="credited" || !Number.isSafeInteger(amountCents) || amountCents<=0 || amountCents!==credit.excessLiabilityCents)
        fail("marketplace_host_fee_excess_amount_changed");
      if(row.excess_return_status==="returned")return undefined;
      if(row.excess_return_request){
        if(!validMarketplaceFeeExcessRequest(row.excess_return_request) || !same(row.excess_return_request.credit,credit) || row.excess_return_request.family!=="host")
          fail("marketplace_host_fee_excess_return_unproven");
        return {request:row.excess_return_request,submit:false,...(row.excess_return_provider_refund_id?{providerRefundId:row.excess_return_provider_refund_id}:{})};
      }
      if(recovery)return undefined; // Recovery may observe an existing claim only.
      if(row.excess_return_status!=="held")fail("marketplace_host_fee_excess_return_unproven");
      const raw={family:"host" as const,credit:structuredClone(credit),amountCents,actorUserId:actor.userId,authorisedAt:new Date().toISOString(),
        reference:marketplaceFeeExcessReference("host",credit)},request={...raw,requestHash:hash(raw)};
      if(!validMarketplaceFeeExcessRequest(request))fail("marketplace_host_fee_excess_return_unproven");
      await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET excess_return_status='unknown',excess_return_request=${json(request)}::jsonb,
        excess_return_request_hash=${request.requestHash},excess_return_submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
      await this.emitExcess(tx,request,"submitted");return {request,submit:true};
    });
  }
  async recordExcess(actor:MarketplaceContributionActor,operation:MarketplaceFeeExcessOperation,observation:MarketplaceFeeExcessObservation) {
    const request=operation?.request;
    if(!request || request.family!=="host" || !validMarketplaceFeeExcessRequest(request))fail("marketplace_host_fee_excess_return_unproven");
    const own=await this.owned(actor,request.credit.request.collectionId);return this.withBasis(actor,own.debt_id,async(tx,b)=>{
      const row=(await this.row(tx,own.id))!,journal=this.view(row,b);
      if(!row.excess_return_request || !same(row.excess_return_request,request) || !journal.credit || !same(journal.credit,request.credit))
        fail("marketplace_host_fee_excess_return_changed");
      if(row.excess_return_status==="returned")return journal;
      if(!observation || !["confirmed","unknown","pending","failed"].includes(observation.state))fail("marketplace_host_fee_excess_return_unproven");
      const refundId=observation.providerRefundId??observation.proof?.refund.id??row.excess_return_provider_refund_id;
      if(row.excess_return_provider_refund_id && refundId!==row.excess_return_provider_refund_id)fail("marketplace_host_fee_excess_return_changed");
      if(observation.state!=="confirmed"){
        const state=observation.state==="unknown"&&row.excess_return_status==="pending"?"pending":observation.state;
        await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET excess_return_status=${state},excess_return_observation=${json(observation)}::jsonb,
          excess_return_provider_refund_id=${refundId??null},updated_at=CURRENT_TIMESTAMP WHERE id=${own.id}`;
        return this.view((await this.row(tx,own.id))!,b);
      }
      const certificate=buildMarketplaceFeeExcessReturn(request,observation);
      if(!certificate)fail("marketplace_host_fee_excess_return_unproven");
      await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET excess_return_status='returned',excess_return_observation=${json(observation)}::jsonb,
        excess_return_certificate=${json(certificate)}::jsonb,excess_return_certificate_hash=${certificate.certificateHash},
        excess_return_provider_refund_id=${certificate.proof.refund.id},excess_return_balance_transaction_id=${certificate.proof.balance.id},
        returned_excess_cents=${request.amountCents},excess_returned_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${own.id}`;
      await this.emitExcess(tx,request,"returned",certificate);b.returns.push(certificate);
      await this.closeIfComplete(tx,b);
      return this.view((await this.row(tx,own.id))!,b);
    });
  }
  private async emitExcess(tx:Prisma.TransactionClient,r:MarketplaceFeeExcessRequest,state:"submitted"|"returned",receipt?:MarketplaceFeeExcessReturn) {
    const c=r.credit.request,data={eventId:`mfee_excess_${state}_${hash([r.family,c.collectionId,r.requestHash])}`,
      eventType:`marketplace.host_fee_excess_${state}`,schemaVersion:1,merchantId:c.merchantId,occurredAt:new Date(),
      correlationId:c.fundingPlanId,causationId:c.collectionId,producer:"marketplace",payload:{family:r.family,collection_id:c.collectionId,
        debt_id:c.debtId,fee_certificate_id:c.feeCertificateId,funding_plan_id:c.fundingPlanId,merchant_id:c.merchantId,
        request_hash:r.requestHash,credit_certificate_hash:r.credit.certificateHash,amount_cents:r.amountCents,
        ...(receipt?{provider_refund_id:receipt.proof.refund.id,returned_excess_cents:r.amountCents,certificate_hash:receipt.certificateHash}:{})}};
    await this.scoped({merchantId:c.merchantId,userId:r.actorUserId},async()=>await tx.outboxMessage.create({data}));
  }
  private remaining(b:Basis){return b.evidence.hostDisputeFeeCents-b.credits.reduce((n,c)=>n+c.creditCents,0);}
  private async pending(tx:Prisma.TransactionClient,b:Basis){return (await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM marketplace_host_fee_collections WHERE fee_certificate_id=${b.certificateId} AND status NOT IN ('credited','expired') LIMIT 1`).length>0;}
  private validateApproval(a:MarketplaceHostFeeCollectionApproval) {if(a.confirmed!==true || !id(a.debtId)||!id(a.collectionId)||!/^cus_[A-Za-z0-9_]+$/.test(a.customerId) ||
    !Number.isSafeInteger(a.grossAmountCents)||a.grossAmountCents<50||a.grossAmountCents>2147483647)throw new BadRequestException("invalid_marketplace_host_fee_confirmation");}
  async context(actor:MarketplaceContributionActor,debtId:string) {return this.withBasis(actor,debtId,(tx,b)=>this.contextFromBasis(tx,b));}
  private async contextFromBasis(tx:Prisma.TransactionClient,b:Basis):Promise<MarketplaceHostFeeContext> {
    const closed=await this.obligation(tx,b),pendingFeeCents=this.remaining(b),excess=this.outstandingExcess(b);
    return {debtId:b.evidence.payoutId,feeCertificateId:b.certificateId,environment:b.evidence.environment,
    dueCents:b.evidence.hostDisputeFeeCents,collectedCents:b.evidence.hostDisputeFeeCents-this.remaining(b),outstandingCents:this.remaining(b),
    processingFeeCents:b.credits.reduce((n,c)=>n+c.processingFeeCents,0),excessLiabilityCents:excess,
    canPrepare:pendingFeeCents>0 && !await this.pending(tx,b),fundingHoldReleased:false as const,payoutReauthorized:false as const,
    obligationStatus:closed?"closed" as const:pendingFeeCents===0 && excess>0?"fees_collected_excess_held" as const:"outstanding" as const,
    ...(closed?{obligationId:closed.id}:{}),pendingFeeCents,obligationCanClose:!closed && pendingFeeCents===0 && excess===0 && !await this.pending(tx,b)};
  }
  private async hostedCustomer(tx:Prisma.TransactionClient,actor:MarketplaceContributionActor,b:Basis) {
    // A previously proven customer belongs to this immutable original scope.
    // A new billing identity must never replace it for a historical collection.
    const mapping=await tx.$queryRaw<Array<{customer_id:string}>>`SELECT customer_id FROM marketplace_refund_contribution_customers
      WHERE merchant_id=${actor.merchantId} AND environment=${b.evidence.environment} AND account_fingerprint=${b.evidence.accountFingerprint}`;
    if(mapping.length>1)fail("marketplace_host_fee_customer_unproven");
    if(mapping.length){if(!/^cus_[A-Za-z0-9_]+$/.test(mapping[0]!.customer_id))fail("marketplace_host_fee_customer_unproven");return mapping[0]!.customer_id;}
    const billing=await this.scoped(actor,async()=>await tx.merchantBillingSubscription.findUnique({
      where:{merchantId:actor.merchantId},select:{stripeCustomerId:true}}));
    const customerId=billing?.stripeCustomerId;
    return customerId && /^cus_[A-Za-z0-9_]+$/.test(customerId)?customerId:undefined;
  }
  async hostedCustomerId(actor:MarketplaceContributionActor,debtId:string) {
    return this.withBasis(actor,debtId,(tx,b)=>this.hostedCustomer(tx,actor,b));
  }
  async dashboardContext(actor:MarketplaceContributionActor,debtId:string):Promise<MarketplaceHostFeeCandidate> {
    return this.withBasis(actor,debtId,async(tx,b)=>{
      const c=await this.contextFromBasis(tx,b),customerSetupRequired=!await this.hostedCustomer(tx,actor,b);
      return {kind:"candidate",debt_id:c.debtId,fee_certificate_id:c.feeCertificateId,environment:c.environment,
        due_cents:c.dueCents,collected_cents:c.collectedCents,outstanding_cents:c.outstandingCents,
        processing_fee_cents:c.processingFeeCents,excess_liability_cents:c.excessLiabilityCents,
        can_prepare:c.canPrepare && !customerSetupRequired,customer_setup_required:customerSetupRequired,
        obligation_status:c.obligationStatus,...(c.obligationId?{obligation_id:c.obligationId}:{}),obligation_can_close:c.obligationCanClose,
        funding_hold_released:false,payout_reauthorized:false};
    });
  }
  async candidates(actor:MarketplaceContributionActor,limit:number,cursor?:string) {
    this.limit(limit);await this.actor(actor);let after="";
    if(cursor!==undefined){try{
      if(typeof cursor!=="string" || cursor.length>1024)throw Error();
      const c=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
      if(c.purpose!=="host_fee_candidates_v1" || c.merchantId!==actor.merchantId || c.userId!==actor.userId || !id(c.after))throw Error();after=c.after;
    }catch{throw new BadRequestException("invalid_marketplace_host_fee_cursor");}}
    const rows=await this.prisma.$queryRaw<Array<{id:string;debt_id:string}>>`
      SELECT c.id,c.payout_id AS debt_id FROM marketplace_host_principal_extinctions c
      JOIN marketplace_host_debts d ON d.payout_id=c.payout_id AND d.host_merchant_id=c.host_merchant_id
      WHERE c.host_merchant_id=${actor.merchantId} AND c.evidence->'version'='1'::jsonb
        AND (c.evidence->>'hostDisputeFeeCents')::integer>0 AND c.id>${after} ORDER BY c.id LIMIT ${limit+1}`;
    const items:MarketplaceHostFeeCandidate[]=[];
    for(const row of rows.slice(0,limit)){
      const item=await this.dashboardContext(actor,row.debt_id);if(item.fee_certificate_id!==row.id)fail();items.push(item);
    }
    return {items,...(rows.length>limit?{nextCursor:Buffer.from(json({purpose:"host_fee_candidates_v1",...actor,after:rows[limit-1]!.id})).toString("base64url")}:{})};
  }
  private async obligation(tx:Prisma.TransactionClient,b:Basis) {
    const rows=await tx.$queryRaw<Array<{id:string;evidence:unknown;evidence_hash:string;valid:boolean}>>`
      SELECT o.id,o.evidence,o.evidence_hash,marketplace_host_dispute_obligation_valid(o.payout_id) AS valid
      FROM marketplace_host_dispute_obligations o WHERE o.payout_id=${b.evidence.payoutId}`;
    if(!rows.length)return undefined;
    const expected=buildMarketplaceHostDisputeObligation(b.evidence,b.certificateId,b.certificateHash,b.credits,b.returns),row=rows[0]!;
    if(rows.length!==1 || !expected || !row.valid || row.id!==marketplaceHostDisputeObligationId(expected) ||
      row.evidence_hash!==hash(expected) || !same(row.evidence,expected))fail("marketplace_host_dispute_obligation_unproven");
    return row;
  }
  private async closeIfComplete(tx:Prisma.TransactionClient,b:Basis) {
    const existing=await this.obligation(tx,b);if(existing)return {status:"closed" as const,obligationId:existing.id,debtId:b.evidence.payoutId,
      replay:true,fundingHoldReleased:false as const,payoutReauthorized:false as const};
    const evidence=buildMarketplaceHostDisputeObligation(b.evidence,b.certificateId,b.certificateHash,b.credits,b.returns);
    if(!evidence || await this.pending(tx,b))return undefined;
    const obligationId=marketplaceHostDisputeObligationId(evidence),evidenceHash=hash(evidence);
    await tx.$executeRaw`INSERT INTO marketplace_host_dispute_obligations(id,payout_id,fee_certificate_id,host_merchant_id,funding_plan_id,evidence,evidence_hash)
      VALUES(${obligationId},${evidence.payoutId},${evidence.feeCertificateId},${evidence.hostMerchantId},${evidence.fundingPlanId},${json(evidence)}::jsonb,${evidenceHash})`;
    await this.scoped({merchantId:evidence.hostMerchantId,userId:b.credits.at(-1)!.request.actorUserId},async()=>await tx.outboxMessage.create({data:{
      eventId:obligationId,eventType:"marketplace.host_dispute_obligation_closed",schemaVersion:1,merchantId:evidence.hostMerchantId,occurredAt:new Date(),
      correlationId:evidence.fundingPlanId,causationId:evidence.debtId,producer:"marketplace",payload:marketplaceHostDisputeObligationPayload(evidence)}}));
    if(!(await this.obligation(tx,b)))fail("marketplace_host_dispute_obligation_unproven");
    return {status:"closed" as const,obligationId,debtId:evidence.debtId,replay:false,fundingHoldReleased:false as const,payoutReauthorized:false as const};
  }
  async closeObligation(actor:MarketplaceContributionActor,debtId:string) {return this.withBasis(actor,debtId,async(tx,b)=>{
    const closed=await this.closeIfComplete(tx,b);if(!closed)fail("marketplace_host_dispute_obligation_incomplete");return closed;
  });}
  async customerScope(actor:MarketplaceContributionActor,input:MarketplaceHostFeeCollectionApproval) {
    this.validateApproval(input);return this.withBasis(actor,input.debtId,async(_tx,b)=>({merchantId:actor.merchantId,customerId:input.customerId,
      environment:b.evidence.environment,accountFingerprint:b.evidence.accountFingerprint}));
  }
  async prepare(actor:MarketplaceContributionActor,input:MarketplaceHostFeeCollectionApproval,proof:MarketplaceContributionCustomerProof) {
    this.validateApproval(input);return this.withBasis(actor,input.debtId,async(tx,b)=>{
      const old=await this.row(tx,input.collectionId);if(old){if(old.merchant_id!==actor.merchantId || old.approval_hash!==hash({actor,input}))fail("marketplace_host_fee_consent_changed");return this.view(old,b);}
      if(this.remaining(b)<=0)fail("marketplace_host_fee_already_collected");if(await this.pending(tx,b))fail("marketplace_host_fee_pending_collection");
      if(!proof || proof.customerId!==input.customerId || proof.merchantId!==actor.merchantId || proof.environment!==b.evidence.environment ||
        proof.accountFingerprint!==b.evidence.accountFingerprint || !fresh(proof.observedAt))fail("marketplace_host_fee_customer_unproven");
      await tx.$executeRaw`INSERT INTO marketplace_refund_contribution_customers(merchant_id,environment,account_fingerprint,customer_id,proof)
        VALUES(${actor.merchantId},${proof.environment},${proof.accountFingerprint},${proof.customerId},${json(proof)}::jsonb) ON CONFLICT DO NOTHING`;
      const mapping=await tx.$queryRaw<Array<{customer_id:string}>>`SELECT customer_id FROM marketplace_refund_contribution_customers
        WHERE merchant_id=${actor.merchantId} AND environment=${proof.environment} AND account_fingerprint=${proof.accountFingerprint}`;
      if(mapping.length!==1 || mapping[0]!.customer_id!==proof.customerId)fail("marketplace_host_fee_customer_changed");
      const authorisedAt=new Date().toISOString(),raw:Omit<MarketplaceHostFeeCollectionRequest,"requestHash">={version:1,reason:"marketplace_host_dispute_fee_collection",provider:"stripe",method:"card",currency:"BRL",
        environment:b.evidence.environment,accountFingerprint:b.evidence.accountFingerprint,collectionId:input.collectionId,debtId:input.debtId,
        feeCertificateId:b.certificateId,feeCertificateHash:b.certificateHash,hostMerchantId:b.evidence.hostMerchantId,fundingPlanId:b.evidence.fundingPlanId,
        merchantId:actor.merchantId,actorUserId:actor.userId,customerId:input.customerId,feeEvidence:b.evidence,disputeRequest:b.request,
        grossAmountCents:input.grossAmountCents,maximumCreditCents:this.remaining(b),priorCreditHashes:b.credits.map(c=>c.certificateHash),authorisedAt,
        expiresAt:Math.floor(Date.parse(authorisedAt)/1000)+3600,reference:`mhostfeecollect_${hash([b.certificateId,input.collectionId,actor.merchantId])}`};
      const r={...raw,requestHash:hash(raw)};if(!validHostFeeCollection(r))fail();
      await tx.$executeRaw`INSERT INTO marketplace_host_fee_collections(id,fee_certificate_id,debt_id,funding_plan_id,host_merchant_id,merchant_id,actor_user_id,approval_hash,
        customer_id,environment,account_fingerprint,request,request_hash,customer_proof,status)
        VALUES(${r.collectionId},${r.feeCertificateId},${r.debtId},${r.fundingPlanId},${r.hostMerchantId},${r.merchantId},${r.actorUserId},${hash({actor,input})},
          ${r.customerId},${r.environment},${r.accountFingerprint},${json(r)}::jsonb,${r.requestHash},${json(proof)}::jsonb,'approved')`;
      await this.emit(tx,r,"approved",{gross_amount_cents:r.grossAmountCents,maximum_credit_cents:r.maximumCreditCents});return this.view((await this.row(tx,r.collectionId))!,b);
    });
  }
  private async row(tx:Prisma.TransactionClient,id:string){return (await tx.$queryRaw<Row[]>`SELECT * FROM marketplace_host_fee_collections WHERE id=${id} FOR UPDATE`)[0];}
  private async owned(actor:MarketplaceContributionActor,collectionId:string){await this.actor(actor);if(!id(collectionId))this.missing();
    const r=(await this.prisma.$queryRaw<Row[]>`SELECT * FROM marketplace_host_fee_collections WHERE id=${collectionId} AND merchant_id=${actor.merchantId}`)[0];if(!r)this.missing();return r;}
  private view(row:Row,b:Basis):MarketplaceHostFeeCollectionJournal {
    const r=row.request,c=b.credits.find(c=>c.request.collectionId===row.id);
    if(!this.bound(r,b) || row.id!==r.collectionId || row.debt_id!==r.debtId || row.fee_certificate_id!==r.feeCertificateId || row.funding_plan_id!==r.fundingPlanId ||
      row.host_merchant_id!==r.hostMerchantId || row.merchant_id!==r.merchantId || row.actor_user_id!==r.actorUserId || row.customer_id!==r.customerId ||
      row.environment!==r.environment || row.account_fingerprint!==r.accountFingerprint || row.request_hash!==r.requestHash ||
      (row.status==="credited")!==Boolean(c))fail();
    return {id:row.id,status:row.status,version:row.version,request:r,...(row.session_id?{sessionId:row.session_id}:{}),
      ...(row.payment_intent_id?{paymentIntentId:row.payment_intent_id}:{}),...(row.status==="open" && row.checkout_url?{checkoutUrl:row.checkout_url}:{}),...(c?{credit:c,...this.excessView(row,c,b)}:{})};
  }
  async get(actor:MarketplaceContributionActor,collectionId:string){const own=await this.owned(actor,collectionId);
    return this.withBasis(actor,own.debt_id,async(tx,b)=>this.view((await this.row(tx,collectionId))!,b));}
  async cancel(actor:MarketplaceContributionActor,collectionId:string){const own=await this.owned(actor,collectionId);return this.withBasis(actor,own.debt_id,async(tx,b)=>{
    const row=(await this.row(tx,collectionId))!,r=this.view(row,b).request;if(row.status==="expired" && row.version===0)return this.view(row,b);
    if(row.status!=="approved")fail("marketplace_host_fee_already_submitted");
    await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET status='expired',observation=${json({reason:"unsubmitted_approval_cancelled",requestHash:r.requestHash})}::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
    await this.emit(tx,r,"expired",{reason:"unsubmitted_approval_cancelled"});return this.view((await this.row(tx,collectionId))!,b);
  });}
  async claim(actor:MarketplaceContributionActor,collectionId:string,grossAmountCents:number){
    if(!Number.isSafeInteger(grossAmountCents)||grossAmountCents<50||grossAmountCents>2147483647)throw new BadRequestException("invalid_marketplace_host_fee_confirmation");
    const own=await this.owned(actor,collectionId);return this.withBasis(actor,own.debt_id,async(tx,b)=>{
    const row=(await this.row(tx,collectionId))!,r=this.view(row,b).request;if(row.status!=="approved")return undefined;
    if(r.actorUserId!==actor.userId || grossAmountCents!==r.grossAmountCents)fail("marketplace_host_fee_consent_changed");
    if(this.remaining(b)!==r.maximumCreditCents || !same(r.priorCreditHashes,b.credits.map(c=>c.certificateHash)))fail("marketplace_host_fee_obligation_changed");
    if(r.expiresAt<Math.floor(Date.now()/1000)+1801)fail("marketplace_host_fee_approval_expired");
    await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET status='creating',version=1,submitted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
    await this.emit(tx,r,"submitted",{gross_amount_cents:r.grossAmountCents});return this.view((await this.row(tx,collectionId))!,b);
  });}
  async record(actor:MarketplaceContributionActor,collectionId:string,o:MarketplaceHostFeeCollectionObservation){const own=await this.owned(actor,collectionId);return this.withBasis(actor,own.debt_id,async(tx,b)=>{
    const row=(await this.row(tx,collectionId))!,r=this.view(row,b).request;
    if(row.status==="credited"){await this.closeIfComplete(tx,b);return this.view(row,b);}
    if(row.status==="expired")return this.view(row,b);
    if(row.status==="approved")fail("marketplace_host_fee_submission_required");
    if(o.state==="unknown") {await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET status=${row.status==="paid"?"paid":"unproven"},updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
      return this.view((await this.row(tx,collectionId))!,b);}
    const checked=hostFeeSessionObservation(r,o.session);
    if(!o.observedAt || !fresh(o.observedAt) || checked.state==="unknown" || checked.state!==o.state || checked.sessionId!==o.sessionId ||
      checked.paymentIntentId!==o.paymentIntentId || checked.checkoutUrl!==o.checkoutUrl || o.requestHash!==r.requestHash)fail("marketplace_host_fee_receipt_unproven");
    if(row.session_id && row.session_id!==o.sessionId || row.payment_intent_id && row.payment_intent_id!==o.paymentIntentId || row.status==="paid" && o.state!=="paid")fail("marketplace_host_fee_receipt_changed");
    const {credit:incoming,...observation}=o;
    await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET status=${o.state},session_id=${o.sessionId!},payment_intent_id=${o.paymentIntentId??null},
      checkout_url=${o.checkoutUrl??null},observation=${json(observation)}::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
    if(row.status!==o.state && ["paid","expired"].includes(o.state))await this.emit(tx,r,o.state,{gross_amount_cents:r.grossAmountCents});
    if(incoming) {
      const c=buildHostFeeCredit(r,incoming.proof);
      if(o.state!=="paid" || !c || !same(c,incoming) || c.proof.sessionId!==o.sessionId || c.proof.paymentIntent.id!==o.paymentIntentId ||
        this.remaining(b)!==r.maximumCreditCents || !same(r.priorCreditHashes,b.credits.map(c=>c.certificateHash)))fail("marketplace_host_fee_credit_unproven");
      await tx.$executeRaw`INSERT INTO marketplace_host_fee_credits(id,fee_certificate_id,merchant_id,funding_plan_id,host_merchant_id,environment,account_fingerprint,request_hash,credit_sequence,
        provider_payment_intent_id,provider_charge_id,provider_balance_transaction_id,credit_cents,processing_fee_cents,excess_liability_cents,certificate,certificate_hash)
        VALUES(${r.collectionId},${r.feeCertificateId},${r.merchantId},${r.fundingPlanId},${r.hostMerchantId},${r.environment},${r.accountFingerprint},${r.requestHash},${b.credits.length+1},
          ${c.proof.paymentIntent.id},${c.proof.charge.id},${c.proof.balance.id},${c.creditCents},${c.processingFeeCents},${c.excessLiabilityCents},${json(c)}::jsonb,${c.certificateHash})`;
      if(c.excessLiabilityCents>0)await tx.$executeRaw`INSERT INTO marketplace_host_fee_excess_liabilities(collection_id,host_merchant_id,amount_cents,status)
        VALUES(${r.collectionId},${r.hostMerchantId},${c.excessLiabilityCents},'held')`;
      await tx.$executeRaw`UPDATE marketplace_host_fee_collections SET status='credited',updated_at=CURRENT_TIMESTAMP WHERE id=${collectionId}`;
      await this.emit(tx,r,"credited",{credit_cents:c.creditCents,processing_fee_cents:c.processingFeeCents,excess_liability_cents:c.excessLiabilityCents,certificate_hash:c.certificateHash});
      b.credits.push(c);
      await this.closeIfComplete(tx,b);
    }
    return this.view((await this.row(tx,collectionId))!,b);
  });}
  async list(actor:MarketplaceContributionActor,debtId:string,limit:number,cursor?:string){this.limit(limit);await this.context(actor,debtId);let after="";
    if(cursor!==undefined){try{if(typeof cursor!=="string"||cursor.length>1024)throw Error();const c=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
      if(c.purpose!=="host_fee_history_v1" || c.merchantId!==actor.merchantId || c.userId!==actor.userId || c.debtId!==debtId || !id(c.after))throw Error();after=c.after;}catch{throw new BadRequestException("invalid_marketplace_host_fee_cursor");}}
    const rows=await this.prisma.$queryRaw<Array<{id:string}>>`SELECT id FROM marketplace_host_fee_collections WHERE merchant_id=${actor.merchantId} AND debt_id=${debtId} AND id>${after} ORDER BY id LIMIT ${limit+1}`;
    const items:MarketplaceHostFeeCollectionJournal[]=[];for(const row of rows.slice(0,limit))items.push(await this.get(actor,row.id));
    return {items,...(rows.length>limit?{nextCursor:Buffer.from(json({purpose:"host_fee_history_v1",...actor,debtId,after:rows[limit-1]!.id})).toString("base64url")}:{})};}
  private limit(limit:number){if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw new BadRequestException("invalid_marketplace_host_fee_limit");}
  async unresolved(limit:number){this.limit(limit);const rows=await this.prisma.$queryRaw<Array<{id:string;merchant_id:string;actor_user_id:string}>>`
    SELECT j.id,j.merchant_id,u.id AS actor_user_id FROM marketplace_host_fee_collections j
    JOIN LATERAL (SELECT id FROM merchant_users WHERE merchant_id=j.merchant_id AND disabled_at IS NULL AND role IN ('owner','admin')
      ORDER BY CASE WHEN id=j.actor_user_id THEN 0 ELSE 1 END,id LIMIT 1) u ON true
    WHERE j.status IN ('creating','open','paid','unproven') OR j.status='credited' AND j.excess_return_status IN ('unknown','pending')
    ORDER BY j.updated_at,j.id LIMIT ${limit}`;
    return rows.map(r=>({actor:{merchantId:r.merchant_id,userId:r.actor_user_id},collectionId:r.id}));}

  async unclosedObligations(limit:number){this.limit(limit);const rows=await this.prisma.$queryRaw<Array<{debt_id:string;merchant_id:string;user_id:string}>>`
    SELECT c.payout_id AS debt_id,c.host_merchant_id AS merchant_id,u.id AS user_id FROM marketplace_host_principal_extinctions c
    JOIN LATERAL (SELECT id FROM merchant_users WHERE merchant_id=c.host_merchant_id AND disabled_at IS NULL
      AND role IN ('owner','admin') ORDER BY id LIMIT 1) u ON true
    WHERE c.evidence->'version'='1'::jsonb AND (c.evidence->>'hostDisputeFeeCents')::integer>0
      AND NOT EXISTS(SELECT 1 FROM marketplace_host_dispute_obligations o WHERE o.payout_id=c.payout_id)
      AND NOT EXISTS(SELECT 1 FROM marketplace_host_fee_collections j WHERE j.fee_certificate_id=c.id AND j.status NOT IN ('credited','expired'))
      AND (SELECT COALESCE(sum(credit_cents),0) FROM marketplace_host_fee_credits WHERE fee_certificate_id=c.id)=(c.evidence->>'hostDisputeFeeCents')::integer
      AND NOT EXISTS(SELECT 1 FROM marketplace_host_fee_credits credit WHERE credit.fee_certificate_id=c.id AND marketplace_fee_excess_outstanding('host',credit.id)<>0)
      AND marketplace_host_dispute_obligation_evidence(c.payout_id) IS NOT NULL
    ORDER BY c.created_at,c.id LIMIT ${limit}`;
    return rows.map(r=>({actor:{merchantId:r.merchant_id,userId:r.user_id},debtId:r.debt_id}));}
  private async emit(tx:Prisma.TransactionClient,r:MarketplaceHostFeeCollectionRequest,state:string,extra:Record<string,unknown>) {
    const data={eventId:eventId(r,state),eventType:`marketplace.host_fee_collection_${state}`,schemaVersion:1,merchantId:r.merchantId,occurredAt:new Date(),
      correlationId:r.fundingPlanId,causationId:r.debtId,producer:"marketplace",payload:{...payload(r),...extra}};
    await this.scoped({merchantId:r.merchantId,userId:r.actorUserId},async()=>await tx.outboxMessage.create({data}));
  }
}
