import type {ProspectConversation} from "@prisma/client";
import type {ChangeProspectOwnership,ContactPermissionStatus,SendProspectMessage,PlatformSenderBinding} from "@zyon/shared-types";
import type {ProspectingActor,ProspectSendPacket,ProspectSendResult} from "../../domain/prospecting.ports.js";
import {contactPermission,normalizeContactIdentity} from "../../domain/crm/prospect-contact.js";
import {campaignContentHash} from "../../domain/campaigns/prospecting-campaign.js";
import {storedReview,releasePreSubmission} from "../campaigns/prisma-campaign.repository.js";
import {prospectCommand,prospectAudit,validateCommandId} from "../crm/prospect-command.js";
import {protectedContactLookups,type SuppressionKeyRing} from "../crm/prisma-prospect-privacy.repository.js";
import {authenticatedEndpoint,observedBsuid} from "./prospect-endpoint-alias.js";
import {append,changed,ensureConversation,lockEndpoint,publicMessage,type Tx} from "./conversation-timeline.js";
import type {PrismaProspectConversationRepository} from "./prisma-prospect-conversation.repository.js";

import type {ReplyQuote,ConversationCommandStore} from "../../application/conversations/prospect-conversation.service.js";
const resources=(c:ProspectConversation)=>[c.id,c.endpointId,...c.prospectId?[c.prospectId]:[],...c.ambiguousBindings];
export class PrismaProspectConversationCommands implements ConversationCommandStore{
 constructor(readonly repository:PrismaProspectConversationRepository,private readonly keys:SuppressionKeyRing,private readonly quote:ReplyQuote){}
 private async locked(tx:Tx,id:string){
  const ref=await tx.prospectConversation.findUnique({where:{id},select:{endpointId:true}});if(!ref)throw Error("conversation_not_found");
  await lockEndpoint(tx,ref.endpointId);
  await ensureConversation(tx,ref.endpointId);
  return tx.prospectConversation.findUniqueOrThrow({where:{id},include:{endpoint:{include:{sender:true,permissions:true,aliases:true}},prospect:true}});
 }
 private async manualActivity(tx:Tx,c:ProspectConversation){
  const now=new Date();
  await tx.prospectEndpoint.updateMany({where:{id:c.endpointId,lastContactActivityAt:{lt:now}},data:{lastContactActivityAt:now}});
  if(c.prospectId)await tx.platformProspect.updateMany({where:{id:c.prospectId,piiDiscardedAt:null,lastBusinessActivityAt:{lt:now}},data:{lastBusinessActivityAt:now,version:{increment:1}}});
 }
 private assertOwner(c:ProspectConversation,expected:number,operator:string|null){
  if(c.controlEpoch!==expected)throw Error("epoch_conflict");
  if(operator===null?c.mode!=="ai":c.mode!=="human"||c.assignedOperatorId!==operator)throw Error("ownership_conflict");
 }
 private async eligible(tx:Tx,c:Awaited<ReturnType<PrismaProspectConversationCommands["locked"]>>,now:Date){
  const ep=c.endpoint;
  if(!ep.normalizedValue||ep.channel!=="whatsapp"||!["bsuid","phone"].includes(ep.identityKind)||!ep.sender.active||ep.sender.scope!=="zyon_platform")throw Error("sender_unavailable");
  if(c.prospect?.piiDiscardedAt||["do_not_contact","lost"].includes(c.prospect?.stage??""))throw Error("suppressed");
  const identity=normalizeContactIdentity({kind:ep.identityKind==="bsuid"?"bsuid":"phone",value:ep.normalizedValue,businessScope:ep.businessScope});
  const where={senderScope:{in:["zyon_platform",ep.senderBindingId]}};
  const versions=await tx.contactSuppression.findMany({where,select:{keyVersion:true},distinct:["keyVersion"]});
  if(versions.some(v=>!this.keys.keys[v.keyVersion]))throw Error("suppression_key_version_unavailable");
  if(await tx.contactSuppression.findFirst({where:{...where,OR:[...protectedContactLookups(identity,this.keys),...ep.aliases.map(a=>({protectedLookup:a.protectedLookup,keyVersion:a.keyVersion}))]}}))throw Error("suppressed");
  const permission=contactPermission({endpointId:ep.id,senderBindingId:ep.senderBindingId,purpose:"zyon_sales"},ep.permissions.map(p=>({...p,status:p.status as ContactPermissionStatus})));
  if(permission==="revoked")throw Error("suppressed");
  if(!c.lastInboundAt||!c.lastInboundEventId||!c.serviceWindowEndsAt||c.serviceWindowEndsAt<=now||c.lastInboundAt.getTime()+86400000<=now.getTime()||c.lastInboundAt>now)throw Error("outside_send_window");
  return identity;
 }
 ownership(id:string,cmd:ChangeProspectOwnership,actor:ProspectingActor){
  return prospectCommand(this.repository.db,"conversation.ownership",{...cmd,id},actor,async tx=>{
   const c=await this.locked(tx,id);
   if(c.controlEpoch!==cmd.expectedEpoch)throw Error("epoch_conflict");
   if(cmd.action==="release"&&(c.mode!=="human"||c.assignedOperatorId!==actor.operatorId)||cmd.action==="assume"&&c.mode==="human"&&c.assignedOperatorId===actor.operatorId)throw Error("ownership_conflict");
   const next=await tx.prospectConversation.update({where:{id},data:{mode:cmd.action==="assume"?"human":"ai",assignedOperatorId:cmd.action==="assume"?actor.operatorId:null,controlEpoch:{increment:1}}});
   await tx.prospectMessage.updateMany({where:{conversationId:id,clientRequestId:{not:null},state:"prepared"},data:{state:"cancelled_before_submit",errorCode:"epoch_conflict"}});
   await tx.prospectOutbox.updateMany({where:{kind:{in:["prospect.ai.reply","prospect.chat.dispatch"]},resourceIds:{has:id},state:{in:["pending","leased"]}},data:{state:"cancelled",leaseToken:null,leaseExpiresAt:null}});
   if(cmd.action==="assume"){
    const pending=await tx.outreachAttempt.findMany({where:{sequence:{endpointId:c.endpointId},state:"reserved"},include:{recipient:true}});
    for(const a of pending)if(a.recipient)await releasePreSubmission(tx,a,a.recipient.campaignId,"human_handoff");
    await tx.prospectSequence.updateMany({where:{endpointId:c.endpointId,state:"active"},data:{state:"cancelled",cancelReason:"human_handoff",cancelledAt:new Date(),followUpDueAt:null}});
   }
   await this.manualActivity(tx,c);await changed(tx,id,"ownership",null);await prospectAudit(tx,actor,"conversation."+cmd.action,"conversation",id,next.controlEpoch);
   return {result:await this.repository.summary(tx,id,actor.operatorId),resourceIds:resources(c)};
  });
 }
 private async funding(tx:Tx,endpointId:string,senderBindingId:string,senderVersion:number,now:Date){
  const automatic=await tx.outreachAttempt.findFirst({where:{ordinal:0,sequence:{endpointId,senderBindingId}},include:{recipient:{include:{campaign:true}}}});
  const campaign=automatic?.recipient?.campaign,campaignId=campaign?.id??null;
  const quote=this.quote({campaignId,endpointId,now});
  if(!quote||!Number.isSafeInteger(quote.amountCents)||quote.amountCents<0||quote.currency!=="BRL"||!(quote.validUntil>now))throw Error("cost_unknown");
  const amount=BigInt(quote.amountCents);
  if(amount){
   if(!campaign)throw Error("reply_budget_unavailable");
   if(!campaign.budgetCents||!["running","paused","completed"].includes(campaign.state)||campaign.approvedRevision!==campaign.revision||
      campaign.approvedHash!==campaignContentHash(storedReview(campaign))||campaign.senderBindingId!==senderBindingId||
      campaign.senderVersion!==senderVersion||campaign.spentCents+campaign.reservedCents+amount>campaign.budgetCents)throw Error("budget_conflict");
  }
  return {campaignId,amount};
 }
 private async prepare(tx:Tx,id:string,cmd:SendProspectMessage,operator:string|null){
  const c=await this.locked(tx,id);this.assertOwner(c,cmd.expectedEpoch,operator);
  const now=new Date();await this.eligible(tx,c,now);await this.funding(tx,c.endpointId,c.endpoint.senderBindingId,c.endpoint.sender.version,now);
  const m=await append(tx,id,{senderBindingId:c.endpoint.senderBindingId,senderVersion:c.endpoint.sender.version,clientRequestId:cmd.clientRequestId,controlEpoch:cmd.expectedEpoch,
   direction:"outbound",authorType:operator?"operator":"ai",authorId:operator,state:"prepared",content:cmd.content});
  if(operator)await this.manualActivity(tx,c);
  const ids=[...resources(c),m.id];await tx.prospectOutbox.create({data:{kind:"prospect.chat.dispatch",eventId:"chat."+m.id,payload:{messageId:m.id,conversationId:id},resourceIds:ids}});
  return {result:publicMessage(m),resourceIds:ids};
 }
 prepareManual(id:string,cmd:SendProspectMessage,actor:ProspectingActor){
  
  return prospectCommand(this.repository.db,"conversation.message",{...cmd,id},actor,async tx=>{
   const result=await this.prepare(tx,id,cmd,actor.operatorId);await prospectAudit(tx,actor,"conversation.message","conversation",id,cmd.expectedEpoch);return result;
  });
 }
 prepareAi(id:string,cmd:SendProspectMessage){
  validateCommandId(cmd.clientRequestId);
  return this.repository.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${cmd.clientRequestId}))::text`;
   const previous=await tx.prospectMessage.findUnique({where:{clientRequestId:cmd.clientRequestId}});
   if(previous){
    if(previous.authorType!=="ai"||previous.conversationId!==id||previous.controlEpoch!==cmd.expectedEpoch||previous.content!==cmd.content)throw Error("idempotency_conflict");
    return publicMessage(previous);
   }
   return (await this.prepare(tx,id,cmd,null)).result;
  });
 }
 async reply(id:string){return publicMessage(await this.repository.db.prospectMessage.findUniqueOrThrow({where:{id}}));}
 async beginSubmission(messageId:string,binding:PlatformSenderBinding){
  const initial=await this.repository.db.prospectMessage.findUniqueOrThrow({where:{id:messageId}});
  if(!initial.clientRequestId||initial.state!=="prepared")return null;
  return this.repository.db.$transaction(async tx=>{
   const origin=await tx.outreachAttempt.findFirst({where:{ordinal:0,sequence:{endpoint:{conversations:{some:{id:initial.conversationId}}}}},select:{recipient:{select:{campaignId:true}}}});
   if(origin?.recipient)await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('prospect.dispatch'),hashtext(${origin.recipient.campaignId}))::text`;
   await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('zyon_platform_sender'))::text`;
   const c=await this.locked(tx,initial.conversationId),m=await tx.prospectMessage.findUniqueOrThrow({where:{id:messageId}});
   if(m.state!=="prepared")return null;
   this.assertOwner(c,m.controlEpoch!,m.authorType==="operator"?m.authorId:null);
   const originId=origin?.recipient?.campaignId??null;
   if(originId)await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${originId} FOR UPDATE`;
   const now=new Date(),identity=await this.eligible(tx,c,now);
   if(binding.id!==m.senderBindingId||binding.version!==m.senderVersion||c.endpoint.sender.version!==m.senderVersion)throw Error("sender_identity_mismatch");
   const {campaignId,amount}=await this.funding(tx,c.endpointId,binding.id,binding.version,now);
   if(campaignId!==originId)throw Error("campaign_state_conflict");
   if(amount&&campaignId)await tx.prospectCampaign.update({where:{id:campaignId},data:{reservedCents:{increment:amount}}});
   await tx.prospectMessage.update({where:{id:m.id},data:{state:"submitting",submittedAt:now,campaignId,reservedAmount:amount,costState:"reserved"}});
   await tx.prospectOutbox.update({where:{eventId:"chat."+m.id},data:{state:"held"}});
   await changed(tx,c.id,"delivery",m.sequence);
   return {attempt:{id:m.id},senderBindingId:binding.id,senderVersion:binding.version,identity,normalizedEndpoint:identity.value,template:null,content:m.content!} satisfies ProspectSendPacket;
  });
 }
 async settleReply(messageId:string,binding:PlatformSenderBinding,final:ProspectSendResult){
  const initial=await this.repository.db.prospectMessage.findUniqueOrThrow({where:{id:messageId}});
  return this.repository.db.$transaction(async tx=>{
   if(final.state==="provider_accepted"&&final.confirmedBsuid){
    const ep=await tx.prospectConversation.findUniqueOrThrow({where:{id:initial.conversationId},include:{endpoint:{include:{sender:true}}}});
    if((ep.endpoint.sender.grantedAssets as {businessId?:string})?.businessId===final.confirmedBsuid.businessScope)await authenticatedEndpoint(tx,binding.id,this.keys,[observedBsuid(final.confirmedBsuid.value,final.confirmedBsuid.businessScope)],ep.endpointId);
   }
   const ref=await tx.prospectConversation.findUniqueOrThrow({where:{id:initial.conversationId}});
   await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ref.endpointId} FOR UPDATE`;
   const m=await tx.prospectMessage.findUniqueOrThrow({where:{id:messageId}});
   if(m.state!=="submitting"){
    if(final.state==="provider_accepted"&&m.providerId===final.providerMessageId&&!m.acceptedAt)await tx.prospectMessage.update({where:{id:m.id},data:{acceptedAt:final.acceptedAt}});
    return publicMessage(m);
   }
   const accepted=final.state==="provider_accepted",unknown=final.state==="outcome_unknown";
   if(!unknown&&m.campaignId&&m.reservedAmount)await tx.prospectCampaign.update({where:{id:m.campaignId},data:{reservedCents:{decrement:m.reservedAmount},...(accepted?{spentCents:{increment:m.reservedAmount}}:{})}});
   const updated=await tx.prospectMessage.update({where:{id:m.id},data:{state:final.state,providerId:accepted?final.providerMessageId:null,acceptedAt:accepted?final.acceptedAt:null,errorCode:accepted?null:final.errorCode,costState:unknown?"reserved":accepted?"committed":"released"}});
   await tx.prospectOutbox.update({where:{eventId:"chat."+m.id},data:{state:unknown?"held":"completed"}});await changed(tx,m.conversationId,"delivery",m.sequence);
   return publicMessage(updated);
  });
 }
 addNote(id:string,cmd:{content:string;clientRequestId:string},actor:ProspectingActor){
  return prospectCommand(this.repository.db,"conversation.note",{...cmd,id},actor,async tx=>{
   const c=await this.locked(tx,id);if(!c.endpoint.normalizedValue)throw Error("suppressed");
   const n=await tx.prospectNote.create({data:{conversationId:id,operatorId:actor.operatorId,content:cmd.content,clientRequestId:cmd.clientRequestId}});
   await this.manualActivity(tx,c);await changed(tx,id,"note",null);await prospectAudit(tx,actor,"conversation.note","conversation",id,c.controlEpoch);
   return {result:{id:n.id,conversationId:id,operatorId:n.operatorId,content:n.content,createdAt:n.createdAt.toISOString()},resourceIds:[...resources(c),n.id]};
  });
 }
 markRead(id:string,cmd:{sequence:number;clientRequestId:string},actor:ProspectingActor){
  return prospectCommand(this.repository.db,"conversation.read",{...cmd,id},actor,async tx=>{
   const c=await this.locked(tx,id);if(cmd.sequence>c.lastSequence)throw Error("invalid_command:sequence");
   const key={conversationId:id,operatorId:actor.operatorId};
   const previous=await tx.prospectRead.findUnique({where:{conversationId_operatorId:key}});
   const sequence=Math.max(previous?.readSequence??0,cmd.sequence);
   await tx.prospectRead.upsert({where:{conversationId_operatorId:key},create:{...key,readSequence:sequence},update:{readSequence:sequence}});
   await changed(tx,id,"read",sequence);await prospectAudit(tx,actor,"conversation.read","conversation",id,c.controlEpoch);
   return {result:{readSequence:sequence},resourceIds:resources(c)};
  });
 }
}
