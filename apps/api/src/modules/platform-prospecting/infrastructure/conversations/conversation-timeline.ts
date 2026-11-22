import {Prisma,type ProspectConversation,type ProspectMessage} from "@prisma/client";
import type {ProspectConversation as PublicConversation,ProspectMessage as PublicMessage,ProspectRealtimeEvent} from "@zyon/shared-types";
import {resolveContactAttribution} from "../../domain/crm/prospect-contact.js";

export type Tx=Prisma.TransactionClient;
export async function lockEndpoint(tx:Tx,endpointId:string){
  // Privacy, inbound, submission and ownership use lead -> endpoint ordering.
  await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id IN
    (SELECT prospect_id FROM prospect_contact_bindings WHERE endpoint_id=${endpointId}
     UNION SELECT prospect_id FROM campaign_recipients WHERE endpoint_id=${endpointId})
    ORDER BY id FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${endpointId} ORDER BY id FOR UPDATE`;
}
export async function ensureConversation(tx:Tx,endpointId:string){
  const links=await tx.prospectContactBinding.findMany({where:{endpointId,prospect:{piiDiscardedAt:null}}});
  const attribution=resolveContactAttribution(links.map(l=>({prospectId:l.prospectId,confirmed:l.confirmationState==="confirmed"})));
  return tx.prospectConversation.upsert({where:{endpointId},create:{endpointId,...attribution},update:attribution});
}
export async function changed(tx:Tx,conversationId:string,kind:ProspectRealtimeEvent["kind"],sequence:number|null){
  const c=await tx.prospectConversation.update({where:{id:conversationId},data:{revision:{increment:1}}});
  return tx.prospectConversationChange.create({data:{conversationId,revision:c.revision,kind,sequence}});
}
export async function append(tx:Tx,conversationId:string,data:Omit<Prisma.ProspectMessageUncheckedCreateInput,"conversationId"|"sequence">){
  const c=await tx.prospectConversation.update({where:{id:conversationId},data:{lastSequence:{increment:1}}});
  const m=await tx.prospectMessage.create({data:{...data,conversationId,sequence:c.lastSequence}});
  await changed(tx,c.id,"message",m.sequence);
  return m;
}
export function publicMessage(row:ProspectMessage):PublicMessage{
  return {id:row.id,conversationId:row.conversationId,sequence:row.sequence,authorType:row.authorType as PublicMessage["authorType"],authorId:row.authorId,direction:row.direction as PublicMessage["direction"],content:row.content,providerId:row.providerId,attemptId:row.attemptId,state:row.state as PublicMessage["state"],providerOccurredAt:row.providerOccurredAt?.toISOString()??null,createdAt:row.createdAt.toISOString()};
}
export function publicConversation(row:ProspectConversation,readSequence:number,unreadCount:number):PublicConversation{
  return {id:row.id,endpointId:row.endpointId,prospectId:row.prospectId,ambiguousBindings:row.ambiguousBindings,mode:row.mode as PublicConversation["mode"],assignedOperatorId:row.assignedOperatorId,controlEpoch:row.controlEpoch,lastSequence:row.lastSequence,revision:row.revision,readSequence,unreadCount,lastInboundMessageId:row.lastInboundEventId,lastInboundAt:row.lastInboundAt?.toISOString()??null,lastInboundPreview:row.lastInboundPreview,serviceWindowEndsAt:row.serviceWindowEndsAt?.toISOString()??null};
}
