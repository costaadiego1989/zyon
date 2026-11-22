import {type PrismaClient} from "@prisma/client";
import type {ProspectConversationQuery} from "@zyon/shared-types";
import {changed,lockEndpoint,publicConversation,publicMessage,type Tx} from "./conversation-timeline.js";
import type {InboundPayload} from "./prisma-prospect-meta-inbox.js";

const earliest=(old:Date|null,at:Date|null)=>old&&at?(old<at?old:at):old??at;
const latest=(old:Date|null,at:Date|null)=>old&&at?(old>at?old:at):old??at;
export class PrismaProspectConversationRepository{
 constructor(readonly db:PrismaClient){}
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
 async list(query:ProspectConversationQuery,actor:{operatorId:string}){
  const limit=query.limit??50;
  return this.db.$transaction(async tx=>{
   const rows=await tx.prospectConversation.findMany({where:{assignedOperatorId:query.assignedOperatorId,id:query.cursor?{gt:query.cursor}:undefined,
    ...(query.campaignId?{endpoint:{recipients:{some:{campaignId:query.campaignId}}}}:{}),
    ...(query.search?{OR:[{prospect:{cnpj:{contains:query.search}}},{lastInboundPreview:{contains:query.search,mode:"insensitive"}}]}:{})},
    orderBy:{id:"asc"},select:{id:true},...(!query.unread?{take:limit+1}:{})});
   const result=[];
   for(const row of rows){const c=await this.summary(tx,row.id,actor.operatorId);if(!query.unread||c.unreadCount>0)result.push(c);if(result.length>limit)break;}
   return {items:result.slice(0,limit),nextCursor:result.length>limit?result[limit-1].id:null};
  },{isolationLevel:"RepeatableRead"});
 }
}
