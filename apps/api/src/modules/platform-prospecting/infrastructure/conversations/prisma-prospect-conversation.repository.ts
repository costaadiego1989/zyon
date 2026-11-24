import {Prisma,type PrismaClient} from "@prisma/client";
import type {ProspectConversationQuery} from "@zyon/shared-types";
import {releasePreSubmission} from "../campaigns/prisma-campaign.repository.js";
import {append,ensureConversation,changed,lockEndpoint,publicConversation,publicMessage,type Tx} from "./conversation-timeline.js";
import {receiptReference} from "./prospect-receipt-reference.js";
import type {InboundPayload} from "./prisma-prospect-meta-inbox.js";
import {validateProspectingMaxPrice} from "@zyon/shared-types";

const earliest=(old:Date|null,at:Date|null)=>old&&at?(old<at?old:at):old??at;
const latest=(old:Date|null,at:Date|null)=>old&&at?(old>at?old:at):old??at;
export class PrismaProspectConversationRepository{
 constructor(readonly db:PrismaClient){}
 event(id:string){return this.db.prospectInboxEvent.findUniqueOrThrow({where:{id},select:{eventKind:true,state:true}});}
 due(limit:number){return this.db.prospectInboxEvent.findMany({where:{state:{in:["pending","awaiting_correlation"]},nextAttemptAt:{lte:new Date()}},orderBy:[{nextAttemptAt:"asc"},{id:"asc"}],take:limit,select:{id:true}});}
 async awaitCorrelation(id:string){await this.db.prospectInboxEvent.updateMany({where:{id,state:{in:["pending","awaiting_correlation"]}},data:{state:"awaiting_correlation",nextAttemptAt:new Date(Date.now()+60_000)}});}
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
   const normalizedReply=payload.body.trim().normalize("NFD").replace(/\p{M}/gu,"");
   const refuse=/^(?:pare|parar|stop|sair|cancelar|nao tenho interesse|nao quero(?: receber (?:mais )?mensagens)?)(?:(?:\s*[,!.]\s*|\s+)obrigad[oa])?[.!\s]*$/iu.test(normalizedReply);
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
   const ref=await receiptReference(tx,event.senderBindingId,p.providerId,p.opaque);
   if(!ref||p.endpointId&&p.endpointId!==ref.endpointId)return "unmatched";
   const endpointId=ref.endpointId;
   await lockEndpoint(tx,endpointId);
   const current=await tx.prospectInboxEvent.findUniqueOrThrow({where:{id:inboxId}});if(current.state==="processed")return "processed";
   const endpoint=await tx.prospectEndpoint.findUniqueOrThrow({where:{id:endpointId}});
   let msg=ref.messageId?await tx.prospectMessage.findUnique({where:{id:ref.messageId}}):await tx.prospectMessage.findFirst({where:{attemptId:ref.attemptId!}});
   if(!msg&&ref.attemptId){
    const a=await tx.outreachAttempt.findUniqueOrThrow({where:{id:ref.attemptId}});
    if(!a.submittedAt||a.providerMessageId&&a.providerMessageId!==p.providerId)return "unmatched";
    const c=await ensureConversation(tx,endpointId);
    msg=await append(tx,c.id,{senderBindingId:event.senderBindingId,authorType:"system",direction:"outbound",attemptId:a.id,state:a.state,
     content:endpoint.normalizedValue?a.content:null,providerId:a.providerMessageId,submittedAt:a.submittedAt,acceptedAt:a.acceptedAt,deliveredAt:a.deliveredAt,readAt:a.readAt,createdAt:a.submittedAt});
    await tx.outreachAttempt.update({where:{id:a.id},data:{conversationId:c.id}});
   }
   if(!msg||msg.providerId&&msg.providerId!==p.providerId||!msg.submittedAt)return "unmatched";
   const at=event.providerOccurredAt;
   if(["sent","read","delivered"].includes(p.status??"")){
    const isRead=p.status==="read",isDelivered=isRead||p.status==="delivered";
    const state=msg.state==="read"||isRead?"read":msg.state==="delivered"||isDelivered?"delivered":"provider_accepted";
    const evidence={state,acceptedAt:earliest(msg.acceptedAt,p.status==="sent"?at:null),deliveredAt:earliest(msg.deliveredAt,isDelivered?at:null),readAt:earliest(msg.readAt,isRead?at:null),errorCode:null as string|null};
    if(msg.attemptId){
     const attempt=await tx.outreachAttempt.findUniqueOrThrow({where:{id:msg.attemptId},include:{recipient:{include:{campaign:true}}}});
     if(attempt.providerMessageId&&attempt.providerMessageId!==p.providerId)return "unmatched";
     if(attempt.errorCode==="provider_cost_exceeds_cap")evidence.errorCode=attempt.errorCode;
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
      if(isDelivered&&p.providerCost?.currency==="BRL"&&/^\d+$/.test(p.providerCost.amountMicros)&&["reserved","committed"].includes(attempt.costState)){
       let cap;try{cap=validateProspectingMaxPrice((r.campaign.template as {maxPrice?:unknown}|null)?.maxPrice);}catch{/* Preserve the conservative reservation when the stored cap is invalid. */}
       if(cap){
        const reported=BigInt(p.providerCost.amountMicros),prior=attempt.providerCostMicros;
        const observed=prior!==null&&prior>reported?prior:reported;
        const rounded=(observed+9999n)/10000n,previous=prior===null?attempt.reservedAmount:(prior+9999n)/10000n;
        const exceeded=observed>BigInt(cap.amountPerThousandMinor)*10n;
        if(prior===null||observed!==prior){
         await tx.prospectCampaign.update({where:{id:r.campaignId},data:{spentCents:{increment:rounded-previous},...(exceeded&&r.campaign.state==="running"?{state:"paused"}:{})}});
         await tx.outreachAttempt.update({where:{id:attempt.id},data:{providerCostMicros:observed}});
        }
        if(exceeded)evidence.errorCode="provider_cost_exceeds_cap";
       }
      }
     }
     await tx.outreachAttempt.update({where:{id:attempt.id},data:{...evidence,providerMessageId:p.providerId,costState:"committed",errorCode:evidence.errorCode??null}});
     if(attempt.ordinal===0&&evidence.deliveredAt)await tx.prospectSequence.update({where:{id:attempt.sequenceId},data:{deliveredAt:evidence.deliveredAt}});
     await tx.prospectOutbox.updateMany({where:{eventId:attempt.id},data:{state:"completed",leaseToken:null,leaseExpiresAt:null}});
    }else {
     await tx.prospectOutbox.updateMany({where:{eventId:"chat."+msg.id},data:{state:"completed",leaseToken:null,leaseExpiresAt:null}});
     if(msg.costState==="reserved"&&msg.campaignId)
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
   await tx.prospectInboxEvent.update({where:{id:inboxId},data:{state:"processed",processedAt:new Date(),resourceIds:ids,...(!endpoint.normalizedValue?{payload:{redacted:true}}:{})}});return "processed";
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
 async changes(id:string,after:number,limit:number){
  const c=await this.db.prospectConversation.findUnique({where:{id},select:{revision:true}});if(!c)throw Error("conversation_not_found");
  if(after>c.revision)throw Error("invalid_filter:change_cursor");
  const rows=await this.db.prospectConversationChange.findMany({where:{conversationId:id,revision:{gt:after}},orderBy:{revision:"asc"},take:limit+1});
  const items=rows.slice(0,limit).map(r=>({id:r.id,conversationId:id,kind:r.kind as import("@zyon/shared-types").ProspectRealtimeEvent["kind"],cursor:String(r.revision),sequence:r.sequence,occurredAt:r.occurredAt.toISOString()}));
  return {items,nextCursor:items.at(-1)?.cursor??String(after),hasMore:rows.length>limit};
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
