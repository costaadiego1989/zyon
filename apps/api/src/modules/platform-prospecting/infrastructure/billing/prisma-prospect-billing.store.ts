import {createHash,randomUUID} from "node:crypto";
import type {PrismaClient,Prisma} from "@prisma/client";
import type {ProspectOffer} from "@zyon/shared-types";
import type {BillingAccount,ProposalStore,ProspectBillingBridgeService} from "../../application/billing/prospect-billing-bridge.service.js";
import type {ProspectingActor,CanonicalBillingOfferPort} from "../../domain/prospecting.ports.js";
import type {SubscriptionFinancialFact} from "../../../payment/domain/ports/subscription-attribution.port.js";
import {prospectCommand,prospectAudit} from "../crm/prospect-command.js";
import {lockEndpoint} from "../conversations/conversation-timeline.js";
import {releasePreSubmission} from "../campaigns/prisma-campaign.repository.js";

export class PrismaProspectBillingStore implements ProposalStore {
 constructor(private readonly db:PrismaClient,private readonly ttlMs:number,private readonly clock=()=>new Date()){
  if(!Number.isSafeInteger(ttlMs)||ttlMs<=0)throw Error("invalid_proposal_ttl");
 }
 private async lead(tx:Prisma.TransactionClient,id:string){
  await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id=${id} FOR UPDATE`;
  const lead=await tx.platformProspect.findUnique({where:{id}});if(!lead||lead.piiDiscardedAt)throw Error("prospect_not_found");return lead;
 }
 private async insert(tx:Prisma.TransactionClient,prospectId:string,offer:ProspectOffer,clientRequestId:string,nonceHash:(id:string)=>string){
  const id=randomUUID(),expiresAt=new Date(+this.clock()+this.ttlMs);
  return tx.prospectBillingProposal.create({data:{id,prospectId,planKey:offer.planKey,offerVersion:offer.version,nonceHash:nonceHash(id),expiresAt,clientRequestId}});
 }
 chatLinks(signer:Pick<ProspectBillingBridgeService,"signupLink">){
  return {
   prepare:async(tx:Prisma.TransactionClient,prospectId:string,offer:ProspectOffer,inboundId:string)=>{
    const row=await this.insert(tx,prospectId,offer,"chat."+inboundId,id=>signer.signupLink(id,offer).nonceHash);
    return {id:row.id,url:signer.signupLink(row.id,offer).url};
   },
   current:async(tx:Prisma.TransactionClient,prospectId:string,offer:ProspectOffer,inboundId:string,id:string,content:string|null)=>{
    const row=await tx.prospectBillingProposal.findUnique({where:{id}});
    if(!row||row.prospectId!==prospectId||row.planKey!==offer.planKey||row.offerVersion!==offer.version||
       row.clientRequestId!=="chat."+inboundId||row.boundMerchantId||row.expiresAt<=this.clock())return false;
    const signed=signer.signupLink(id,offer);
    return row.nonceHash===signed.nonceHash && content===signed.url;
   }
  };
 }
 create(prospectId:string,offer:ProspectOffer,clientRequestId:string,actor:ProspectingActor,nonceHash:(id:string)=>string){
  return prospectCommand(this.db,"billing.proposal",{prospectId,planKey:offer.planKey,clientRequestId},actor,async tx=>{
   await this.lead(tx,prospectId);
   const row=await this.insert(tx,prospectId,offer,clientRequestId,nonceHash),{id,expiresAt}=row;
   await prospectAudit(tx,actor,"billing.proposal","prospect",prospectId,row.version,{proposalId:id,planKey:offer.planKey,offerVersion:offer.version});
   return {result:{id,expiresAt:expiresAt.toISOString(),version:row.version,offerVersion:row.offerVersion},resourceIds:[prospectId,id]};
  });
 }
 async bind(hash:string,account:BillingAccount,userId:string,offers:CanonicalBillingOfferPort){
  return this.db.$transaction(async tx=>{
   const ref=await tx.prospectBillingProposal.findUnique({where:{nonceHash:hash}});if(!ref)throw Error("proposal_not_found");
   await this.lead(tx,ref.prospectId);
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sales-billing-account'),hashtext(${account.id}))::text`;
   await tx.$queryRaw`SELECT id FROM prospect_billing_proposals WHERE id=${ref.id} FOR UPDATE`;
   const row=await tx.prospectBillingProposal.findUniqueOrThrow({where:{id:ref.id}});
   const next=account.status==="active"?"manage_subscription" as const:"select_plan" as const;
   if(row.boundMerchantId){if(row.boundMerchantId!==account.id || row.boundUserId!==userId)throw Error("proposal_account_conflict");return {boundMerchantId:account.id,next};}
   const now=this.clock();if(row.expiresAt<=now)throw Error("proposal_expired_conflict");
   if((await offers.current(row.planKey)).version!==row.offerVersion)throw Error("offer_version_conflict");
   if(await tx.prospectBillingProposal.findFirst({where:{boundMerchantId:account.id,conversionEligible:true}}))throw Error("proposal_account_conflict");
   await tx.prospectBillingProposal.update({where:{id:row.id},data:{boundMerchantId:account.id,boundUserId:userId,boundAt:now,conversionEligible:next==="select_plan",version:{increment:1}}});
   const states=[...(account.createdAt>=row.createdAt?["signup"]:[]),...(account.status==="trialing"&&account.trialEndsAt&&account.trialEndsAt>now?["trial"]:[])];
   for(const state of states)await tx.prospectConversion.create({data:{prospectId:row.prospectId,proposalId:row.id,merchantId:account.id,provider:"account",providerEventId:row.id+"."+state,subscriptionId:account.id,state,occurredAt:now}});
   return {boundMerchantId:account.id,next};
  });
 }
 async subscriptionForPayment(merchantId:string,provider:string,paymentRef:string){
  const row=await this.db.prospectBillingReceipt.findFirst({where:{provider,paymentRef,proposal:{boundMerchantId:merchantId}},select:{subscriptionId:true}});
  return row?.subscriptionId??null;
 }
 async tracks(merchantId:string){return !!await this.db.prospectBillingProposal.findFirst({where:{boundMerchantId:merchantId,conversionEligible:true},select:{id:true}});}
 async apply(f:SubscriptionFinancialFact,account:{merchantId:string;planKey:string}){
  await this.db.$transaction(async tx=>{
   const candidate=await tx.prospectBillingProposal.findFirst({where:{boundMerchantId:account.merchantId,conversionEligible:true}});
   if(!candidate || !candidate.boundAt || f.state!=="refunded"&&candidate.planKey!==account.planKey || +f.occurredAt<Math.floor(+candidate.boundAt/1000)*1000)return;
   const bindings=await tx.prospectContactBinding.findMany({where:{prospectId:candidate.prospectId},orderBy:{endpointId:"asc"},select:{endpointId:true}});
   // Lock every affected lead in stable order before endpoint rows, as in privacy/suppression.
   const endpoints=bindings.map(b=>b.endpointId);
   const campaigns=await tx.campaignRecipient.findMany({where:{endpointId:{in:endpoints}},distinct:["campaignId"],select:{campaignId:true},orderBy:{campaignId:"asc"}});
   for(const c of campaigns)await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('prospect.dispatch'),hashtext(${c.campaignId}))::text`;
   if(endpoints.length)await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id=${candidate.prospectId} OR id IN (SELECT prospect_id FROM prospect_contact_bindings WHERE endpoint_id=ANY(${endpoints}::text[]) UNION SELECT prospect_id FROM campaign_recipients WHERE endpoint_id=ANY(${endpoints}::text[])) ORDER BY id FOR UPDATE`;
   const prospect=await tx.platformProspect.findUnique({where:{id:candidate.prospectId}});
   if(!prospect || prospect.piiDiscardedAt)return;
   await this.lead(tx,candidate.prospectId);
   for(const endpoint of endpoints)await lockEndpoint(tx,endpoint);
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('sales-billing-account'),hashtext(${account.merchantId}))::text`;
   if(f.state==="allocation_unknown"){
    const id=createHash("sha256").update(JSON.stringify([f.provider,f.eventId,candidate.id])).digest("hex");
    await tx.prospectAuditEvent.createMany({data:[{id:"allocation."+id,action:"billing.allocation_unknown",
     resourceType:"prospect",resourceId:prospect.id,resourceVersion:prospect.version,correlationId:id,
     outcome:"allocation_coverage_unknown",details:{proposalId:candidate.id,provider:f.provider},occurredAt:f.occurredAt}],skipDuplicates:true});
    return;
   }
   const data={provider:f.provider,eventId:f.eventId,proposalId:candidate.id,subscriptionId:f.subscriptionId,paymentRef:f.paymentRef,state:f.state,amountCents:BigInt(f.amountCents),occurredAt:f.occurredAt};
   await tx.prospectBillingReceipt.createMany({data:[data],skipDuplicates:true});
   const receipts=await tx.prospectBillingReceipt.findMany({where:{proposalId:candidate.id,provider:f.provider,subscriptionId:f.subscriptionId,paymentRef:f.paymentRef},orderBy:[{occurredAt:"asc"},{eventId:"asc"}]});
   const previous=await tx.prospectConversion.findFirst({where:{provider:f.provider,subscriptionId:f.subscriptionId,state:"paid"}});
   const paid=receipts.find(r=>r.state==="paid" && (!previous || previous.providerEventId===r.eventId));if(!paid)return;
   const refund=receipts.find(r=>r.state==="refunded"&&r.amountCents>=paid.amountCents);
   const rows=[paid,...(refund?[refund]:[])].map(r=>({prospectId:candidate.prospectId,proposalId:candidate.id,merchantId:account.merchantId,provider:r.provider,providerEventId:r.eventId,subscriptionId:r.subscriptionId,state:r.state,occurredAt:r.occurredAt}));
   await tx.prospectConversion.createMany({data:rows,skipDuplicates:true});
   if(!previous){
    await tx.platformProspect.update({where:{id:candidate.prospectId},data:{stage:"converted",convertedAt:paid.occurredAt,version:{increment:1}}});
    const reserved=await tx.outreachAttempt.findMany({where:{sequence:{endpointId:{in:endpoints}},state:"reserved"},include:{recipient:true}});
    for(const a of reserved)if(a.recipient)await releasePreSubmission(tx,a,a.recipient.campaignId,"converted");
    await tx.prospectSequence.updateMany({where:{endpointId:{in:endpoints},state:"active"},data:{state:"cancelled",cancelReason:"converted",cancelledAt:this.clock(),followUpDueAt:null}});
   }
  });
 }
}
