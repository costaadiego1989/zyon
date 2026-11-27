import type {Prisma} from "@prisma/client";

export async function receiptReference(tx:Prisma.TransactionClient,senderBindingId:string,providerId:string,opaque:string|null){
 if(typeof providerId!=="string"||!providerId)return null;
 const messages=await tx.prospectMessage.findMany({where:{senderBindingId,direction:"outbound",submittedAt:{not:null},
  OR:[{providerId},...(opaque?[{id:opaque},{attemptId:opaque}]:[])]},include:{conversation:true},take:2});
 if(messages.length>1)throw Error("receipt_identity_conflict");
 const msg=messages[0];
 if(msg){
  if(msg.providerId&&msg.providerId!==providerId||opaque&&opaque!==msg.id&&opaque!==msg.attemptId)throw Error("receipt_identity_conflict");
  return {endpointId:msg.conversation.endpointId,messageId:msg.id,conversationId:msg.conversationId,attemptId:msg.attemptId};
 }
 // Previously submitted automatic attempts can predate the creation of the chat timeline.
 const attempts=await tx.outreachAttempt.findMany({where:{sequence:{senderBindingId},submittedAt:{not:null},
  state:{in:["submitting","outcome_unknown","provider_accepted","delivered","read"]},
  OR:[{providerMessageId:providerId},...(opaque?[{id:opaque}]:[])]},include:{sequence:true},take:2});
 if(attempts.length>1)throw Error("receipt_identity_conflict");
 const a=attempts[0];if(!a)return null;
 if(a.providerMessageId&&a.providerMessageId!==providerId||opaque&&a.id!==opaque)throw Error("receipt_identity_conflict");
 return {endpointId:a.sequence.endpointId,messageId:null,conversationId:a.conversationId,attemptId:a.id};
}
