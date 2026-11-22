import { randomUUID } from "node:crypto";
import { type OutreachAttempt, type Prisma, type PrismaClient, type ProspectCampaign } from "@prisma/client";
import type { ContactPermissionStatus, OutreachAttemptRecord, ProspectingTemplate } from "@zyon/shared-types";
import type { AttemptReservation, ProspectSendResult } from "../../domain/prospecting.ports.js";
import { publicSender } from "./prisma-sender-binding.repository.js";
import type {ProspectOffer,ProspectingSendWindow} from "@zyon/shared-types";
import { campaignContentHash } from "../../domain/campaigns/prospecting-campaign.js";
import { contactPermission, normalizeContactIdentity } from "../../domain/crm/prospect-contact.js";
import { protectedContactLookups, type SuppressionKeyRing } from "../crm/prisma-prospect-privacy.repository.js";

type Tx=Prisma.TransactionClient;
export type CostQuote=(context:{campaignId:string;recipientId:string;template:ProspectingTemplate|null;now:Date})=>{amountCents:number;currency:"BRL";validUntil:Date}|null;
export function storedReview(c:ProspectCampaign){
  return {message:c.message,offer:c.offerSnapshot,senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template,audienceHash:c.audienceHash,sendWindow:c.sendWindow,
    limits:c.dailyRecipientLimit&&c.budgetCents?{dailyRecipients:c.dailyRecipientLimit,budget:{amountCents:Number(c.budgetCents),currency:c.currency}}:null};
}
export function projectAttempt(row:OutreachAttempt):OutreachAttemptRecord {
  const iso=(d:Date|null)=>d?.toISOString()??null;
  return {id:row.id,sequenceId:row.sequenceId,ordinal:row.ordinal as 0|1,clientRequestId:row.clientRequestId,state:row.state as OutreachAttemptRecord["state"],controlEpoch:row.controlEpoch,providerMessageId:row.providerMessageId,reservedAmount:{amountCents:Number(row.reservedAmount),currency:row.currency},submittedAt:iso(row.submittedAt),acceptedAt:iso(row.acceptedAt),deliveredAt:iso(row.deliveredAt),readAt:iso(row.readAt),errorCode:row.errorCode};
}
export async function releasePreSubmission(tx:Tx,row:OutreachAttempt,campaignId:string,reason:string){
  if(row.state!=="reserved"||row.costState!=="reserved")return;
  const day=row.reservationDay??row.createdAt.toISOString().slice(0,10);
  await tx.prospectCampaign.update({where:{id:campaignId},data:{reservedCents:{decrement:row.reservedAmount}}});
  await tx.prospectCampaignDailyUsage.update({where:{campaignId_day:{campaignId,day}},data:{reservedRecipients:{decrement:1}}});
  await tx.outreachAttempt.update({where:{id:row.id},data:{state:"cancelled_before_submit",costState:"released",errorCode:reason,leaseToken:null,leaseExpiresAt:null}});
  await tx.prospectOutbox.updateMany({where:{eventId:row.id},data:{state:"held",leaseToken:null,leaseExpiresAt:null}});
  if(row.recipientId)await tx.campaignRecipient.update({where:{id:row.recipientId},data:{state:"pending"}});
}
export class PrismaCampaignRepository {
  constructor(private readonly prisma:PrismaClient,private readonly keys:SuppressionKeyRing,private readonly quote:CostQuote){}
  private async lockedContext(tx:Tx,recipientId:string){
    const ids=await tx.campaignRecipient.findUnique({where:{id:recipientId},select:{endpointId:true,campaignId:true}});
    if(!ids)return null;
    // A pause closes new reservations before fencing its existing owners; frozen nonparticipants stay unlocked.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('prospect.dispatch'), hashtext(${ids.campaignId}))::text`;
    await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ids.endpointId} ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${ids.campaignId} FOR UPDATE`;
    const r=await tx.campaignRecipient.findUniqueOrThrow({where:{id:recipientId},include:{prospect:true,campaign:true,endpoint:{include:{sender:true,permissions:true,conversations:true}}}});
    const c=r.campaign,ep=r.endpoint,conversation=ep.conversations[0];
    if(c.state!=="running"||c.approvedRevision!==c.revision||!c.approvedHash||c.approvedHash!==campaignContentHash(storedReview(c))||!c.audienceHash) return null;
    if(!ep.sender.active||ep.sender.scope!=="zyon_platform"||c.senderBindingId!==ep.senderBindingId||c.senderVersion!==ep.sender.version||!ep.normalizedValue||ep.channel!=="whatsapp"||!(["phone","bsuid"].includes(ep.identityKind))) return null;
    if(["converted","do_not_contact","lost"].includes(r.prospect.stage)||r.prospect.piiDiscardedAt||conversation?.mode==="human")return null;
    const identity=normalizeContactIdentity({kind:ep.identityKind==="bsuid"?"bsuid":"phone",value:ep.normalizedValue,businessScope:ep.businessScope});
    const scopes={in:["zyon_platform",ep.senderBindingId]};
    const versions=await tx.contactSuppression.findMany({where:{senderScope:scopes},distinct:["keyVersion"],select:{keyVersion:true}});
    if(versions.some(v=>!this.keys.keys[v.keyVersion]))throw new Error("suppression_key_version_unavailable");
    if(await tx.contactSuppression.findFirst({where:{senderScope:scopes,OR:protectedContactLookups(identity,this.keys)}}))return null;
    const permission=contactPermission({senderBindingId:ep.senderBindingId,endpointId:ep.id,purpose:"zyon_sales"},ep.permissions.map(p=>({...p,status:p.status as ContactPermissionStatus})));
    if(permission!=="opted_in"){
      await tx.campaignRecipient.updateMany({where:{id:r.id,state:{in:["pending","blocked"]}},data:{eligibility:permission,blockers:["provider_policy_blocked"]}});
      return null;
    }
    return {r,c,ep,conversation,identity,template:c.template as unknown as ProspectingTemplate|null};
  }
  reserveAttempt(recipientId:string,ownerToken:string,now:Date):Promise<AttemptReservation|null>{
    if(!ownerToken || ownerToken.length>200 || !Number.isFinite(now.getTime()))throw new Error("invalid_command:lease");
    return this.prisma.$transaction(async tx=>{
      const context=await this.lockedContext(tx,recipientId); if(!context)return null;
      const {r,c,ep,conversation,identity,template}=context;
      const scope={senderBindingId:ep.senderBindingId,endpointId:ep.id};
      const previous=await tx.prospectSequence.findUnique({where:{senderBindingId_endpointId:scope},include:{attempts:{where:{ordinal:0}}}});
      if(previous && previous.state!=="active")return null;
      const leaseExpiresAt=new Date(now.getTime()+60_000);
      const controlEpoch=conversation?.controlEpoch??0;
      const existing=previous?.attempts[0]; let attempt:OutreachAttempt;
      const day=now.toISOString().slice(0,10);
      const recoverable=existing?.state==="cancelled_before_submit" && ["campaign_paused","reservation_expired","dispatch_deferred"].includes(existing.errorCode??"");
      if(existing && (existing.recipientId!==recipientId || !recoverable && (existing.state!=="reserved" || existing.leaseExpiresAt && existing.leaseExpiresAt>now)))return null;
      const quote=this.quote({campaignId:c.id,recipientId,template,now});
      if(!quote||!Number.isSafeInteger(quote.amountCents)||quote.amountCents<=0||quote.currency!=="BRL"||!(quote.validUntil>now))throw new Error("cost_unknown");
      const amount=BigInt(quote.amountCents);
      const oldReserved=existing?.state==="reserved"?existing.reservedAmount:0n;
      if(existing?.state==="reserved")await releasePreSubmission(tx,existing,c.id,"reservation_expired");
      if(!c.budgetCents||c.spentCents+c.reservedCents-oldReserved+amount>c.budgetCents||!c.dailyRecipientLimit)return null;
      const usage=await tx.prospectCampaignDailyUsage.findUnique({where:{campaignId_day:{campaignId:c.id,day}}});
      if((usage?.submittedRecipients??0)+(usage?.reservedRecipients??0)>=c.dailyRecipientLimit)return null;
      const sequence=previous??await tx.prospectSequence.create({data:scope});
      const data={recipientId,conversationId:conversation?.id??null,requestHash:c.approvedHash!,state:"reserved",costState:"reserved",errorCode:null,leaseToken:ownerToken,leaseExpiresAt,controlEpoch,approvedRevision:c.revision,senderVersion:c.senderVersion!,reservedAmount:amount,reservationDay:day,content:c.message};
      attempt=existing?await tx.outreachAttempt.update({where:{id:existing.id},data}):await tx.outreachAttempt.create({data:{...data,sequenceId:sequence.id,ordinal:0,clientRequestId:randomUUID(),createdAt:now}});
      if(!existing)await tx.prospectSequence.update({where:{id:sequence.id},data:{firstAttemptId:attempt.id}});
      await tx.prospectCampaign.update({where:{id:c.id},data:{reservedCents:{increment:amount}}});
      await tx.prospectCampaignDailyUsage.upsert({where:{campaignId_day:{campaignId:c.id,day}},create:{campaignId:c.id,day,reservedRecipients:1},update:{reservedRecipients:{increment:1}}});
      await tx.campaignRecipient.update({where:{id:r.id},data:{state:"reserved",eligibility:"opted_in",blockers:[]}});
      const payload={attemptId:attempt.id,endpointId:ep.id},resourceIds=[r.prospectId,ep.id,c.id,r.id,attempt.id,...(conversation?[conversation.id]:[])];
      await tx.prospectOutbox.upsert({where:{eventId:attempt.id},create:{eventId:attempt.id,kind:"prospect.attempt.reserved",payload,resourceIds},update:{state:"pending",availableAt:now,leaseToken:null,leaseExpiresAt:null,payload,resourceIds}});
      return {attempt:projectAttempt(attempt),ownerToken,campaignId:c.id,recipientId,senderBindingId:ep.senderBindingId,senderVersion:c.senderVersion!,endpointId:ep.id,normalizedEndpoint:identity.value,identity,template,content:c.message,expectedEpoch:controlEpoch};
    });
  }
  async deferReservation(packet:AttemptReservation){
    if(!packet.campaignId)return;
    const campaignId=packet.campaignId;
    await this.prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('prospect.dispatch'),hashtext(${campaignId}))::text`;
      await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${packet.endpointId} ORDER BY id FOR UPDATE`;
      const row=await tx.outreachAttempt.findFirst({where:{id:packet.attempt.id,leaseToken:packet.ownerToken,state:"reserved"}});
      if(row)await releasePreSubmission(tx,row,campaignId,"dispatch_deferred");
    });
  }
  async dispatchReview(campaignId:string){
    const c=await this.prisma.prospectCampaign.findUniqueOrThrow({where:{id:campaignId},include:{sender:true}});
    if(!c.sender||!c.approvedHash)return null;
    return {binding:publicSender(c.sender),hash:c.approvedHash,offer:c.offerSnapshot as unknown as ProspectOffer|null,
      campaign:{senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template as unknown as ProspectingTemplate|null,message:c.message}};
  }
  markSubmitting(attemptId:string,ownerToken:string,instant:Date|(()=>Date),verifiedHash?:string){
    return this.prisma.$transaction(async tx=>{
      const initial=await tx.outreachAttempt.findUnique({where:{id:attemptId}}); if(!initial?.recipientId)return false;
      const ctx=await this.lockedContext(tx,initial.recipientId); if(!ctx)return false;
      const {c,conversation,template}=ctx;
      const now=typeof instant==="function"?instant():instant;
      if(verifiedHash!==undefined){
        if(c.approvedHash!==verifiedHash||initial.requestHash!==verifiedHash)return false;
        if(!template&&(!conversation?.serviceWindowEndsAt||conversation.serviceWindowEndsAt<=now))return false;
        const window=c.sendWindow as unknown as ProspectingSendWindow;
        const parts=new Intl.DateTimeFormat("en-GB",{timeZone:window.timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
        const part=(name:string)=>parts.find(p=>p.type===name)?.value;
        const weekday=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(part("weekday")??"")+1;
        const time=part("hour")+":"+part("minute");
        if(!window.weekdays.includes(weekday)||time<window.start||time>=window.end)return false;
      }
      if(initial.controlEpoch!==(conversation?.controlEpoch??0)||initial.approvedRevision!==c.revision||initial.senderVersion!==c.senderVersion||!c.budgetCents||c.spentCents+c.reservedCents>c.budgetCents)return false;
      const day=initial.reservationDay??initial.createdAt.toISOString().slice(0,10); if(day!==now.toISOString().slice(0,10))return false;
      const usage=await tx.prospectCampaignDailyUsage.findUnique({where:{campaignId_day:{campaignId:c.id,day}}});
      if(!usage||usage.reservedRecipients<1||usage.reservedRecipients+usage.submittedRecipients>(c.dailyRecipientLimit??0))return false;
      const quote=this.quote({campaignId:c.id,recipientId:initial.recipientId,template,now});
      if(!quote||quote.currency!=="BRL"||!Number.isSafeInteger(quote.amountCents)||quote.amountCents<=0||!(quote.validUntil>now)||BigInt(quote.amountCents)>initial.reservedAmount)throw new Error("cost_unknown");
      const changed=await tx.outreachAttempt.updateMany({where:{id:attemptId,state:"reserved",leaseToken:ownerToken,leaseExpiresAt:{gt:now},sequence:{state:"active"}},data:{state:"submitting",submittedAt:now}});
      if(changed.count)await tx.campaignRecipient.update({where:{id:initial.recipientId},data:{state:"submitting"}});
      return changed.count===1;
    });
  }
  recordResult(attemptId:string,ownerToken:string,result:ProspectSendResult){
    return this.prisma.$transaction(async tx=>{
      const ref=await tx.outreachAttempt.findUniqueOrThrow({where:{id:attemptId},include:{sequence:true,recipient:true}});
      await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ref.sequence.endpointId} ORDER BY id FOR UPDATE`;
      const row=await tx.outreachAttempt.findUniqueOrThrow({where:{id:attemptId}});
      if(row.leaseToken!==ownerToken)throw new Error("lease_conflict");
      if(["delivered","read","provider_accepted","outcome_unknown","not_accepted"].includes(row.state))return projectAttempt(row);
      if(row.state!=="submitting"||!ref.recipient)throw new Error("attempt_state_conflict");
      const safe:ProspectSendResult=result.state==="provider_accepted"&&!result.providerMessageId?.trim()?{state:"outcome_unknown",errorCode:"missing_message_id"}:result;
      const accepted=safe.state==="provider_accepted";const unknown=safe.state==="outcome_unknown";
      const updated=await tx.outreachAttempt.update({where:{id:row.id},data:{state:safe.state,providerMessageId:accepted?safe.providerMessageId:null,acceptedAt:accepted?safe.acceptedAt:null,errorCode:accepted?null:safe.errorCode,costState:unknown?"reserved":accepted?"committed":"released"}});
      if(!unknown){
        await tx.prospectCampaign.update({where:{id:ref.recipient.campaignId},data:{reservedCents:{decrement:row.reservedAmount},...(accepted?{spentCents:{increment:row.reservedAmount}}:{})}});
        await tx.prospectCampaignDailyUsage.update({where:{campaignId_day:{campaignId:ref.recipient.campaignId,day:row.reservationDay??row.createdAt.toISOString().slice(0,10)}},data:{reservedRecipients:{decrement:1},submittedRecipients:{increment:accepted?1:0}}});
      }
      await tx.campaignRecipient.update({where:{id:ref.recipient.id},data:{state:safe.state}});
      await tx.prospectOutbox.updateMany({where:{eventId:row.id},data:{state:unknown?"held":"completed",leaseToken:null,leaseExpiresAt:null}});
      return projectAttempt(updated);
    });
  }
}
