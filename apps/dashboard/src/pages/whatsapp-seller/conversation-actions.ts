import type {ConversationContext,ConversationDetail,ConversationDeliveryStatus} from "./conversation-types.js";

/** These controls explain canonical state; every API command still performs
 * its own actual principal/epoch/lease/window/config checks. */
export function conversationActions(context:ConversationContext|null,detail:ConversationDetail|null,connected:boolean){
  const none={claim:false,send:false,close:false};if(!context||!detail?.binding||!["OWNER","ADMIN","STAFF"].includes(context.role))return none;
  const {binding,ticket,channel}=detail;
  const own=binding.ticketId===ticket.id&&binding.mode==="human"&&ticket.status==="in_progress"&&binding.assignedOperatorId===context.user_id;
  return {claim:binding.ticketId===ticket.id&&binding.mode==="waiting_human"&&ticket.status==="open"&&binding.assignedOperatorId===null,
    send:Boolean(own&&connected&&channel?.enabled&&channel.status==="ACTIVE"),close:own};
}
export function conversationDeliveryLabel(status:ConversationDeliveryStatus):string{
  return {queued:"Na fila",accepted:"Aceita pelo canal",delivered:"Entregue",read:"Lida",failed:"Falhou",unknown:"Envio não confirmado"}[status];
}
