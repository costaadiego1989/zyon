import {prospectFollowUpAt} from "../../domain/campaigns/prospect-follow-up.js";
import { randomUUID } from "node:crypto";
import { type OutreachAttempt, type Prisma, type PrismaClient, type ProspectCampaign } from "@prisma/client";
import type { ContactPermissionStatus, OutreachAttemptRecord, ProspectingTemplate } from "@zyon/shared-types";
import type { AttemptReservation, ProspectSendResult } from "../../domain/prospecting.ports.js";
import { publicSender } from "./prisma-sender-binding.repository.js";
import type {PlatformSenderReadiness,ProspectOffer,ProspectingSendWindow} from "@zyon/shared-types";
import { campaignContentHash } from "../../domain/campaigns/prospecting-campaign.js";
import { contactPermission, normalizeContactIdentity } from "../../domain/crm/prospect-contact.js";
import { protectedContactLookups, type SuppressionKeyRing } from "../crm/prisma-prospect-privacy.repository.js";

import {authenticatedEndpoint,observedBsuid} from "../conversations/prospect-endpoint-alias.js";
import {campaignSelectionBlockers} from "../../application/campaigns/sender-readiness.service.js";
import {append,changed,ensureConversation,lockEndpoint} from "../conversations/conversation-timeline.js";

type Tx=Prisma.TransactionClient;
function dueFor(deliveredAt:Date,hasReply:boolean,ep:{timezone:string|null;timezoneSource:string|null},window:ProspectingSendWindow){
 const trusted=["contact_confirmed","operator_confirmed","provider_verified"].includes(ep.timezoneSource??"");
 return prospectFollowUpAt({deliveredAt,hasReply,trustedTimezone:trusted?ep.timezone:null,window});
}
export type CostQuote=(context:{campaignId:string;recipientId:string;template:ProspectingTemplate|null;now:Date})=>{amountCents:number;currency:"BRL";validUntil:Date}|null;
export function storedReview(c:ProspectCampaign){
  return {message:c.message,offer:c.offerSnapshot,senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template,audienceHash:c.audienceHash,sendWindow:c.sendWindow,...(c.setupVersion===2?{setupVersion:2,businessContext:c.businessContext,offerPolicy:c.offerPolicy}:{}),
    limits:c.dailyRecipientLimit&&c.budgetCents?{dailyRecipients:c.dailyRecipientLimit,budget:{amountCents:Number(c.budgetCents),currency:c.currency}}:null};
}
export function projectAttempt(row:OutreachAttempt):OutreachAttemptRecord {
  const iso=(d:Date|null)=>d?.toISOString()??null;
  return {id:row.id,sequenceId:row.sequenceId,ordinal:row.ordinal as 0|1,clientRequestId:row.clientRequestId,state:row.state as OutreachAttemptRecord["state"],controlEpoch:row.controlEpoch,providerMessageId:row.providerMessageId,...(row.providerCostMicros!==null?{reportedCost:{amountMicros:row.providerCostMicros.toString(),currency:"BRL" as const}}:{}),reservedAmount:{amountCents:Number(row.reservedAmount),currency:row.currency},submittedAt:iso(row.submittedAt),acceptedAt:iso(row.acceptedAt),deliveredAt:iso(row.deliveredAt),readAt:iso(row.readAt),errorCode:row.errorCode};
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
    await lockEndpoint(tx,ids.endpointId);
    await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${ids.campaignId} FOR UPDATE`;
    const r=await tx.campaignRecipient.findUniqueOrThrow({where:{id:recipientId},include:{prospect:true,campaign:true,endpoint:{include:{sender:true,permissions:true,conversations:true,aliases:true}}}});
    const c=r.campaign,ep=r.endpoint,conversation=ep.conversations[0];
    if(!c.message||!c.sendWindow||c.state!=="running"||c.approvedRevision!==c.revision||!c.approvedHash||c.approvedHash!==campaignContentHash(storedReview(c))||!c.audienceHash) return null;
    if(!ep.sender.active||ep.sender.scope!=="zyon_platform"||c.senderBindingId!==ep.senderBindingId||c.senderVersion!==ep.sender.version||!ep.normalizedValue||ep.channel!=="whatsapp"||!(["phone","bsuid"].includes(ep.identityKind))) return null;
    if(["converted","do_not_contact","lost"].includes(r.prospect.stage)||r.prospect.piiDiscardedAt||conversation?.mode==="human")return null;
    const identity=normalizeContactIdentity({kind:ep.identityKind==="bsuid"?"bsuid":"phone",value:ep.normalizedValue,businessScope:ep.businessScope});
    const scopes={in:["zyon_platform",ep.senderBindingId]};
    const versions=await tx.contactSuppression.findMany({where:{senderScope:scopes},distinct:["keyVersion"],select:{keyVersion:true}});
    if(versions.some(v=>!this.keys.keys[v.keyVersion]))throw new Error("suppression_key_version_unavailable");
    if(await tx.contactSuppression.findFirst({where:{senderScope:scopes,OR:[...protectedContactLookups(identity,this.keys),...ep.aliases.map(a=>({keyVersion:a.keyVersion,protectedLookup:a.protectedLookup}))]}}))return null;
    const permission=contactPermission({senderBindingId:ep.senderBindingId,endpointId:ep.id,purpose:"zyon_sales"},ep.permissions.map(p=>({...p,status:p.status as ContactPermissionStatus})));
    if(permission!=="opted_in"){
      await tx.campaignRecipient.updateMany({where:{id:r.id,state:{in:["pending","blocked"]}},data:{eligibility:permission,blockers:["provider_policy_blocked"]}});
      return null;
    }
    return {r,c,ep,conversation,identity,template:c.template as unknown as ProspectingTemplate|null};
  }
  async followUpCandidates(now:Date,after:string|undefined,limit:number){
    const rows=await this.prisma.prospectSequence.findMany({where:{state:"active",followUpCount:0,deliveredAt:{not:null},...(after?{id:{gt:after}}:{}),
      OR:[{followUpDueAt:null},{followUpDueAt:{lte:now}}],attempts:{some:{ordinal:0,recipient:{campaign:{state:"running"}}}}},
      select:{id:true,attempts:{where:{ordinal:0},select:{recipientId:true}}},orderBy:{id:"asc"},take:limit});
    return rows.flatMap(s=>s.attempts[0]?.recipientId?[{id:s.id,recipientId:s.attempts[0].recipientId}]:[]);
  }
  reserveAttempt(recipientId:string,ownerToken:string,now:Date,ordinal:0|1=0):Promise<AttemptReservation|null>{
    if(!ownerToken || ownerToken.length>200 || !Number.isFinite(now.getTime()))throw new Error("invalid_command:lease");
    return this.prisma.$transaction(async tx=>{
      const context=await this.lockedContext(tx,recipientId); if(!context)return null;
      const {r,c,ep,conversation,identity,template}=context;
      const scope={senderBindingId:ep.senderBindingId,endpointId:ep.id};
      const previous=await tx.prospectSequence.findUnique({where:{senderBindingId_endpointId:scope},include:{attempts:true}});
      if(previous && previous.state!=="active")return null;
      const leaseExpiresAt=new Date(now.getTime()+60_000);
      const controlEpoch=conversation?.controlEpoch??0;
      if(ordinal===1){
        const initial=previous?.attempts.find(a=>a.ordinal===0);
        if(!previous || previous.followUpCount || !initial?.deliveredAt || !previous.deliveredAt || initial.recipientId!==r.id || !template || conversation?.lastInboundAt)return null;
        const window=c.sendWindow as unknown as ProspectingSendWindow;
        const due=dueFor(previous.deliveredAt,false,ep,window)!;
        const opening=due>now?due:dueFor(new Date(now.getTime()-48*3600000),false,ep,window)!;
        await tx.prospectSequence.update({where:{id:previous.id},data:{followUpDueAt:opening}});
        if(opening>now)return null;
      }
      const existing=previous?.attempts.find(a=>a.ordinal===ordinal); let attempt:OutreachAttempt;
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
      attempt=existing?await tx.outreachAttempt.update({where:{id:existing.id},data}):await tx.outreachAttempt.create({data:{...data,sequenceId:sequence.id,ordinal,clientRequestId:randomUUID(),createdAt:now}});
      if(!existing&&ordinal===0)await tx.prospectSequence.update({where:{id:sequence.id},data:{firstAttemptId:attempt.id}});
      await tx.prospectCampaign.update({where:{id:c.id},data:{reservedCents:{increment:amount}}});
      await tx.prospectCampaignDailyUsage.upsert({where:{campaignId_day:{campaignId:c.id,day}},create:{campaignId:c.id,day,reservedRecipients:1},update:{reservedRecipients:{increment:1}}});
      await tx.campaignRecipient.update({where:{id:r.id},data:{state:"reserved",eligibility:"opted_in",blockers:[]}});
      const payload={attemptId:attempt.id,endpointId:ep.id},resourceIds=[r.prospectId,ep.id,c.id,r.id,attempt.id,...(conversation?[conversation.id]:[])];
      await tx.prospectOutbox.upsert({where:{eventId:attempt.id},create:{eventId:attempt.id,kind:"prospect.attempt.reserved",payload,resourceIds},update:{state:"pending",availableAt:now,leaseToken:null,leaseExpiresAt:null,payload,resourceIds}});
      return {attempt:projectAttempt(attempt),ownerToken,campaignId:c.id,recipientId,senderBindingId:ep.senderBindingId,senderVersion:c.senderVersion!,endpointId:ep.id,normalizedEndpoint:identity.value,identity,template,content:c.message!,expectedEpoch:controlEpoch};
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
    return {binding:publicSender(c.sender),hash:c.approvedHash,offer:c.setupVersion===2?null:c.offerSnapshot as unknown as ProspectOffer|null,...(c.setupVersion===2?{executionSnapshot:c.offerSnapshot}:{}),
      campaign:{senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template as unknown as ProspectingTemplate|null,message:c.message!}};
  }
  markSubmitting(attemptId:string,ownerToken:string,instant:Date|(()=>Date),verifiedHash?:string,offerStillCurrent?:()=>Promise<boolean>){
    return this.prisma.$transaction(async tx=>{
      const initial=await tx.outreachAttempt.findUnique({where:{id:attemptId}}); if(!initial?.recipientId)return false;
      const ctx=await this.lockedContext(tx,initial.recipientId); if(!ctx)return false;
      const {c,conversation,template}=ctx;
      if(verifiedHash!==undefined){
        // Take the sender read lock after the endpoint fence. Observe the latest committed health
        // and hold authorization stable until this transaction durably marks the submission.
        await tx.$queryRaw`SELECT id FROM platform_prospect_sender_bindings WHERE id=${ctx.ep.senderBindingId} FOR SHARE`;
        const sender=await tx.platformProspectSenderBinding.findUniqueOrThrow({where:{id:ctx.ep.senderBindingId}});
        const health=sender.health as unknown as PlatformSenderReadiness|null;
        if(!sender.active||sender.version!==c.senderVersion||!health||!Array.isArray(health.blockers)||
          campaignSelectionBlockers(health,sender.id,sender.version,template,c.message).length||!offerStillCurrent||!await offerStillCurrent())return false;
      }
      const now=typeof instant==="function"?instant():instant;
      if(verifiedHash!==undefined){
        if(c.approvedHash!==verifiedHash||initial.requestHash!==verifiedHash)return false;
        if(!template&&(!conversation?.serviceWindowEndsAt||conversation.serviceWindowEndsAt<=now))return false;
        const window=c.sendWindow as unknown as ProspectingSendWindow;
        const parts=new Intl.DateTimeFormat("en-GB",{timeZone:window.timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
        const part=(name:string)=>parts.find(p=>p.type===name)?.value;
        const weekday=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].indexOf(part("weekday")??"")+1;
        const time=part("hour")+":"+part("minute");
        if(initial.ordinal===1){
          const seq=await tx.prospectSequence.findUniqueOrThrow({where:{id:initial.sequenceId}});
          if(!seq.deliveredAt||seq.followUpCount||conversation?.lastInboundAt||!template)return false;
          const due=dueFor(seq.deliveredAt,false,ctx.ep,window)!;
          if(due>now||dueFor(new Date(now.getTime()-48*3600000),false,ctx.ep,window)!>now)return false;
        } else if(!window.weekdays.includes(weekday)||time<window.start||time>=window.end)return false;
      }
      if(initial.controlEpoch!==(conversation?.controlEpoch??0)||initial.approvedRevision!==c.revision||initial.senderVersion!==c.senderVersion||!c.budgetCents||c.spentCents+c.reservedCents>c.budgetCents)return false;
      const day=initial.reservationDay??initial.createdAt.toISOString().slice(0,10); if(day!==now.toISOString().slice(0,10))return false;
      const usage=await tx.prospectCampaignDailyUsage.findUnique({where:{campaignId_day:{campaignId:c.id,day}}});
      if(!usage||usage.reservedRecipients<1||usage.reservedRecipients+usage.submittedRecipients>(c.dailyRecipientLimit??0))return false;
      const quote=this.quote({campaignId:c.id,recipientId:initial.recipientId,template,now});
      if(!quote||quote.currency!=="BRL"||!Number.isSafeInteger(quote.amountCents)||quote.amountCents<=0||!(quote.validUntil>now)||BigInt(quote.amountCents)>initial.reservedAmount)throw new Error("cost_unknown");
      const changed=await tx.outreachAttempt.updateMany({where:{id:attemptId,state:"reserved",leaseToken:ownerToken,leaseExpiresAt:{gt:now},sequence:{state:"active"}},data:{state:"submitting",submittedAt:now}});
      if(changed.count){
        if(initial.ordinal===1)await tx.prospectSequence.update({where:{id:initial.sequenceId},data:{followUpCount:1,state:"completed",followUpDueAt:null}});
        const chat=await ensureConversation(tx,ctx.ep.id);
        await append(tx,chat.id,{senderBindingId:ctx.ep.senderBindingId,authorType:"system",direction:"outbound",attemptId,state:"submitting",content:initial.content,submittedAt:now});
        await tx.outreachAttempt.update({where:{id:attemptId},data:{conversationId:chat.id}});
        await tx.campaignRecipient.update({where:{id:initial.recipientId},data:{state:"submitting"}});
        const lead=ctx.r.prospect;
        await tx.platformProspect.update({where:{id:lead.id},data:{firstAttemptAt:lead.firstAttemptAt??now,lastAttemptAt:now,version:{increment:1}}});
      }
      return changed.count===1;
    });
  }
  recordResult(attemptId:string,ownerToken:string,result:ProspectSendResult){
    return this.prisma.$transaction(async tx=>{
      const ref=await tx.outreachAttempt.findUniqueOrThrow({where:{id:attemptId},include:{sequence:true,recipient:true}});
      if(result.state==="provider_accepted"&&result.confirmedBsuid){
        const binding=await tx.platformProspectSenderBinding.findUniqueOrThrow({where:{id:ref.sequence.senderBindingId}});
        if((binding.grantedAssets as {businessId?:string})?.businessId===result.confirmedBsuid.businessScope&&ref.leaseToken===ownerToken){
          await authenticatedEndpoint(tx,binding.id,this.keys,[observedBsuid(result.confirmedBsuid.value,result.confirmedBsuid.businessScope)],ref.sequence.endpointId);
        }
      }
      await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ref.sequence.endpointId} ORDER BY id FOR UPDATE`;
      const row=await tx.outreachAttempt.findUniqueOrThrow({where:{id:attemptId}});
      if(row.leaseToken!==ownerToken)throw new Error("lease_conflict");
      const lateAcceptance=row.state==="outcome_unknown"&&result.state==="provider_accepted"&&!!result.providerMessageId?.trim();
      if(!lateAcceptance&&["delivered","read","provider_accepted","outcome_unknown","not_accepted"].includes(row.state)){
        if(result.state==="provider_accepted"&&row.providerMessageId===result.providerMessageId&&(!row.acceptedAt||result.acceptedAt<row.acceptedAt)){
          const updated=await tx.outreachAttempt.update({where:{id:row.id},data:{acceptedAt:result.acceptedAt}});
          await tx.prospectMessage.updateMany({where:{attemptId},data:{acceptedAt:result.acceptedAt}});
          return projectAttempt(updated);
        }
        return projectAttempt(row);
      }
      if((row.state!=="submitting"&&!lateAcceptance)||!ref.recipient)throw new Error("attempt_state_conflict");
      const safe:ProspectSendResult=result.state==="provider_accepted"&&!result.providerMessageId?.trim()?{state:"outcome_unknown",errorCode:"missing_message_id"}:result;
      const accepted=safe.state==="provider_accepted";const unknown=safe.state==="outcome_unknown";
      const updated=await tx.outreachAttempt.update({where:{id:row.id},data:{state:safe.state,providerMessageId:accepted?safe.providerMessageId:null,acceptedAt:accepted?safe.acceptedAt:null,errorCode:accepted?null:safe.errorCode,costState:unknown?"reserved":accepted?"committed":"released"}});
      if(!unknown){
        await tx.prospectCampaign.update({where:{id:ref.recipient.campaignId},data:{reservedCents:{decrement:row.reservedAmount},...(accepted?{spentCents:{increment:row.reservedAmount}}:{})}});
        await tx.prospectCampaignDailyUsage.update({where:{campaignId_day:{campaignId:ref.recipient.campaignId,day:row.reservationDay??row.createdAt.toISOString().slice(0,10)}},data:{reservedRecipients:{decrement:1},submittedRecipients:{increment:accepted?1:0}}});
      }
      await tx.campaignRecipient.update({where:{id:ref.recipient.id},data:{state:safe.state}});
      await tx.prospectOutbox.updateMany({where:{eventId:row.id},data:{state:unknown?"held":"completed",leaseToken:null,leaseExpiresAt:null}});
      const message=await tx.prospectMessage.findFirst({where:{attemptId}});
      if(message){
        await tx.prospectMessage.update({where:{id:message.id},data:{state:updated.state,providerId:updated.providerMessageId,acceptedAt:updated.acceptedAt}});
        await changed(tx,message.conversationId,"delivery",message.sequence);
      }
      return projectAttempt(updated);
    });
  }
}
