import {Prisma,type PrismaClient} from "@prisma/client";
import type {ProspectConversationQuery} from "@zyon/shared-types";
import {releasePreSubmission} from "../campaigns/prisma-campaign.repository.js";
import {append,ensureConversation,changed,lockEndpoint,publicConversation,publicMessage,type Tx} from "./conversation-timeline.js";
import type {InboundPayload} from "./prisma-prospect-meta-inbox.js";

const earliest=(old:Date|null,at:Date|null)=>old&&at?(old<at?old:at):old??at;
const latest=(old:Date|null,at:Date|null)=>old&&at?(old>at?old:at):old??at;
export class PrismaProspectConversationRepository{
 constructor(readonly db:PrismaClient){}
 async processInbound(inboxId:string){
  return this.db.$transaction(async tx=>{
   const initial=await tx.prospectInboxEvent.findUniqueOrThrow({where:{id:inboxId}});
   if(initial.state==="processed")return "processed";
   const payload=initial.payload as unknown as InboundPayload;if(initial.eventKind!=="inbound"||!payload.endpointId)throw Error("inbound_endpoint_missing");
   await lockEndpoint(tx,payload.endpointId);
   const event=await tx.prospectInboxEvent.findUniqueOrThrow({where:{id:inboxId}});
   if(event.state==="processed")return "processed";
   const ep=await tx.prospectEndpoint.findUniqueOrThrow({where:{id:payload.endpointId},include:{aliases:true}});
   if(!ep.normalizedValue){
    await tx.prospectInboxEvent.update({where:{id:event.id},data:{state:"processed",payload:{redacted:true},processedAt:new Date()}});return "processed";
   }
   const c=await ensureConversation(tx,ep.id),at=event.providerOccurredAt;
   const msg=await append(tx,c.id,{direction:"inbound",authorType:"prospect",senderBindingId:event.senderBindingId,content:payload.body,state:"received",providerId:payload.providerId,providerOccurredAt:at});
   const ids=[...new Set([...event.resourceIds,ep.id,c.id,msg.id,...c.prospectId?[c.prospectId]:[],...c.ambiguousBindings])];
   const newer=at&&(!c.lastInboundAt||at>c.lastInboundAt||at.getTime()===c.lastInboundAt.getTime()&&event.eventId>(c.lastInboundEventId??""));
   const refuse=/^(?:pare|parar|stop|sair|cancelar|n?o tenho interesse|nao tenho interesse|n?o quero(?: receber (?:mais )?mensagens)?|nao quero)[.!\s]*$/iu.test(payload.body.trim());
   const preview=Array.from(payload.body).slice(0,240).join("");
   const updated=await tx.prospectConversation.update({where:{id:c.id},data:{...(newer?{lastInboundAt:at,lastInboundEventId:event.eventId,lastInboundPreview:preview,serviceWindowEndsAt:new Date(at.getTime()+86400000)}:{}),
    ...(refuse?{mode:"human",controlEpoch:{increment:1},serviceWindowEndsAt:null}:{})}});
   const pending=await tx.outreachAttempt.findMany({where:{sequence:{endpointId:ep.id},state:"reserved"},include:{recipient:true}});
   for(const attempt of pending)if(attempt.recipient)await releasePreSubmission(tx,attempt,attempt.recipient.campaignId,refuse?"refused":"customer_replied");
   await tx.prospectSequence.updateMany({where:{endpointId:ep.id,state:"active"},data:{state:"cancelled",cancelReason:refuse?"refused":"customer_replied",cancelledAt:event.receivedAt,followUpDueAt:null}});
   if(refuse){
    for(const k of [ep,...ep.aliases]){
     const key={senderScope:"zyon_platform",protectedLookup:k.protectedLookup,keyVersion:k.keyVersion};
     await tx.contactSuppression.upsert({where:{senderScope_protectedLookup_keyVersion:key},create:{...key,reason:"opt_out",occurredAt:event.receivedAt},update:{}});
    }
    await tx.contactPermissionReceipt.create({data:{endpointId:ep.id,senderBindingId:event.senderBindingId,purpose:"zyon_sales",status:"revoked",source:"zyon_platform",occurredAt:event.receivedAt}});
    await tx.prospectMessage.updateMany({where:{conversationId:c.id,clientRequestId:{not:null},state:"prepared"},data:{state:"cancelled_before_submit",errorCode:"suppressed"}});
   }
   if(c.prospectId){
    const lead=await tx.platformProspect.findUniqueOrThrow({where:{id:c.prospectId}});
    if(!lead.piiDiscardedAt)await tx.platformProspect.update({where:{id:lead.id},data:{lastBusinessActivityAt:latest(lead.lastBusinessActivityAt,event.receivedAt)!,version:{increment:1},
     ...(!["converted","do_not_contact","lost"].includes(lead.stage)?{stage:refuse?"do_not_contact":"responded"}:{}),
     ...(newer&&(!lead.lastReplyAt||at>=lead.lastReplyAt)?{lastReplyAt:at,lastReplyPreview:preview}:{})}});
   }
   if(newer||refuse)await tx.prospectOutbox.updateMany({where:{kind:"prospect.ai.reply",resourceIds:{has:c.id},state:{in:["pending","leased"]}},data:{state:"cancelled",leaseToken:null,leaseExpiresAt:null}});
   const suppressed=await tx.contactSuppression.findFirst({where:{senderScope:{in:["zyon_platform",event.senderBindingId]},OR:[ep,...ep.aliases].map(k=>({protectedLookup:k.protectedLookup,keyVersion:k.keyVersion}))}});
   if(newer&&!refuse&&!suppressed&&updated.mode==="ai"&&updated.serviceWindowEndsAt&&updated.serviceWindowEndsAt>new Date()&&payload.body){
    await tx.prospectOutbox.create({data:{eventId:"ai."+event.id,kind:"prospect.ai.reply",resourceIds:ids,payload:{conversationId:c.id,messageId:msg.id,controlEpoch:updated.controlEpoch}}});
   }
   await tx.prospectInboxEvent.update({where:{id:event.id},data:{state:"processed",processedAt:new Date(),resourceIds:ids}});
   return "processed";
  });
 }
 async processStatus(inboxId:string){
  return this.db.$transaction(async tx=>{
   const event=await tx.prospectInboxEvent.findUniqueOrThrow({where:{id:inboxId}});
   if(event.state==="processed")return "processed";
   const p=event.payload as unknown as InboundPayload;
   if(event.eventKind!=="status")throw Error("unexpected_event");
   const match={senderBindingId:event.senderBindingId,direction:"outbound",OR:[{providerId:p.providerId},...(p.opaque?[{id:p.opaque},{attemptId:p.opaque}]:[])]};
   const candidates=await tx.prospectMessage.findMany({where:match,include:{conversation:true},take:2});
   if(candidates.length!==1)return "unmatched";
   const ref=candidates[0],endpointId=ref.conversation.endpointId;
   if(p.endpointId&&p.endpointId!==endpointId||ref.providerId&&ref.providerId!==p.providerId||p.opaque&&p.opaque!==ref.id&&p.opaque!==ref.attemptId)return "unmatched";
   await lockEndpoint(tx,endpointId);
   const current=await tx.prospectInboxEvent.findUniqueOrThrow({where:{id:inboxId}});if(current.state==="processed")return "processed";
   const msg=await tx.prospectMessage.findUniqueOrThrow({where:{id:ref.id}});
   if(msg.providerId&&msg.providerId!==p.providerId||!msg.submittedAt)return "unmatched";
   const at=event.providerOccurredAt;
   if(["sent","read","delivered"].includes(p.status??"")){
    const isRead=p.status==="read",isDelivered=isRead||p.status==="delivered";
    const state=msg.state==="read"||isRead?"read":msg.state==="delivered"||isDelivered?"delivered":"provider_accepted";
    const evidence={state,acceptedAt:earliest(msg.acceptedAt,p.status==="sent"?at:null),deliveredAt:earliest(msg.deliveredAt,isDelivered?at:null),readAt:earliest(msg.readAt,isRead?at:null)};
    if(msg.attemptId){
     const attempt=await tx.outreachAttempt.findUniqueOrThrow({where:{id:msg.attemptId},include:{recipient:true}});
     if(attempt.providerMessageId&&attempt.providerMessageId!==p.providerId)return "unmatched";
     if(attempt.recipient){
      const r=attempt.recipient;
      if(attempt.costState==="reserved"){
       if(!attempt.reservationDay)throw Error("reservation_day_missing");
       await tx.prospectCampaign.update({where:{id:r.campaignId},data:{reservedCents:{decrement:attempt.reservedAmount},spentCents:{increment:attempt.reservedAmount}}});
       await tx.prospectCampaignDailyUsage.update({where:{campaignId_day:{campaignId:r.campaignId,day:attempt.reservationDay}},data:{reservedRecipients:{decrement:1},submittedRecipients:{increment:1}}});
      }
      await tx.campaignRecipient.update({where:{id:r.id},data:{state}});
      if(isDelivered&&at){
       const lead=await tx.platformProspect.findUniqueOrThrow({where:{id:r.prospectId}});
       await tx.platformProspect.update({where:{id:r.prospectId},data:{firstDeliveredAt:earliest(lead.firstDeliveredAt,at),lastDeliveredAt:latest(lead.lastDeliveredAt,at)}});
      }
     }
     await tx.outreachAttempt.update({where:{id:attempt.id},data:{...evidence,providerMessageId:p.providerId,costState:"committed",errorCode:null}});
     if(attempt.ordinal===0&&evidence.deliveredAt)await tx.prospectSequence.update({where:{id:attempt.sequenceId},data:{deliveredAt:evidence.deliveredAt}});
     await tx.prospectOutbox.updateMany({where:{eventId:attempt.id},data:{state:"completed",leaseToken:null,leaseExpiresAt:null}});
    }else if(msg.costState==="reserved"&&msg.campaignId){
     await tx.prospectCampaign.update({where:{id:msg.campaignId},data:{reservedCents:{decrement:msg.reservedAmount},spentCents:{increment:msg.reservedAmount}}});
    }
    await tx.prospectMessage.update({where:{id:msg.id},data:{...evidence,providerId:p.providerId,...(!msg.attemptId?{costState:"committed"}:{}),errorCode:null}});
    await changed(tx,msg.conversationId,"delivery",msg.sequence);
   }else if(p.status==="failed"){
    // Failure to deliver does not establish that a submitted request was never accepted.
    await tx.prospectMessage.update({where:{id:msg.id},data:{errorCode:"provider_delivery_failed"}});
    await changed(tx,msg.conversationId,"delivery",msg.sequence);
   }
   const ids=[...new Set([...current.resourceIds,endpointId,msg.id,msg.conversationId,...msg.attemptId?[msg.attemptId]:[]])];
   await tx.prospectInboxEvent.update({where:{id:inboxId},data:{state:"processed",processedAt:new Date(),resourceIds:ids}});return "processed";
  });
 }
 async summary(tx:Tx,id:string,operatorId:string){
  const c=await tx.prospectConversation.findUnique({where:{id},include:{reads:{where:{operatorId}}}});
  if(!c)throw Error("conversation_not_found");
  const read=c.reads[0]?.readSequence??0;
  const unread=await tx.prospectMessage.count({where:{conversationId:id,direction:"inbound",sequence:{gt:read}}});
  return publicConversation(c,read,unread);
 }
 history(id:string,page:{before?:number;after?:number;limit?:number},actor:{operatorId:string}){
  return this.db.$transaction(async tx=>{
   const conversation=await this.summary(tx,id,actor.operatorId);
   const limit=page.limit??50,forward=page.after!==undefined;
   const rows=await tx.prospectMessage.findMany({where:{conversationId:id,sequence:forward?{gt:page.after}:{lt:page.before}},orderBy:{sequence:forward?"asc":"desc"},take:limit+1});
   const selected=rows.slice(0,limit),cursor=selected.at(-1)?.sequence;
   return {conversation,messages:(forward?selected:selected.reverse()).map(publicMessage),hasMore:rows.length>limit,nextCursor:rows.length>limit?String(cursor):null};
  },{isolationLevel:"RepeatableRead"});
 }
 async notes(id:string,cursor:string|undefined,limit:number){
  if(!await this.db.prospectConversation.count({where:{id}}))throw Error("conversation_not_found");
  const rows=await this.db.prospectNote.findMany({where:{conversationId:id,id:cursor?{lt:cursor}:undefined},orderBy:{id:"desc"},take:limit+1,select:{id:true,content:true,conversationId:true,operatorId:true,createdAt:true}});
  return {items:rows.slice(0,limit).map(n=>({...n,createdAt:n.createdAt.toISOString()})),nextCursor:rows.length>limit?rows[limit-1].id:null};
 }
 async list(query:ProspectConversationQuery,actor:{operatorId:string}){
  const limit=query.limit??50;
  return this.db.$transaction(async tx=>{
   const filters:Prisma.Sql[]=[Prisma.sql`TRUE`];
   if(query.cursor)filters.push(Prisma.sql`c.id>${query.cursor}`);
   if(query.assignedOperatorId)filters.push(Prisma.sql`c.assigned_operator_id=${query.assignedOperatorId}`);
   if(query.campaignId)filters.push(Prisma.sql`EXISTS(SELECT 1 FROM campaign_recipients r WHERE r.endpoint_id=c.endpoint_id AND r.campaign_id=${query.campaignId})`);
   if(query.search)filters.push(Prisma.sql`(strpos(lower(c.last_inbound_preview),lower(${query.search}))>0 OR strpos(p.cnpj,${query.search})>0)`);
   if(query.unread)filters.push(Prisma.sql`EXISTS(SELECT 1 FROM prospect_messages m WHERE m.conversation_id=c.id AND m.direction='inbound'
     AND m.sequence>COALESCE((SELECT read_sequence FROM prospect_reads WHERE conversation_id=c.id AND operator_id=${actor.operatorId}),0))`);
   const rows=await tx.$queryRaw<{id:string}[]>(Prisma.sql`SELECT c.id FROM prospect_conversations c LEFT JOIN platform_prospects p ON p.id=c.prospect_id
     WHERE ${Prisma.join(filters," AND ")} ORDER BY c.id LIMIT ${limit+1}`);
   const result=await Promise.all(rows.map(row=>this.summary(tx,row.id,actor.operatorId)));
   return {items:result.slice(0,limit),nextCursor:result.length>limit?result[limit-1].id:null};
  },{isolationLevel:"RepeatableRead"});
 }
}
