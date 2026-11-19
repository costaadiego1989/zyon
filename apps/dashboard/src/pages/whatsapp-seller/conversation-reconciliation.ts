import type {ConversationMessage} from "./conversation-types.js";

/** Reconciliation only. Server revision is authoritative; the UI does not
 * rank accepted as delivered, reinterpret unknown, or initiate any resend. */
export function mergeConversationMessages(current:readonly ConversationMessage[],incoming:readonly ConversationMessage[],ticketId:string):ConversationMessage[]{
  const rows=[...current];
  for(const value of incoming){
    if(value.ticketId!==ticketId||!value.id)throw Error("conversation_scope_mismatch");
    const index=rows.findIndex(old=>old.id===value.id||Boolean(value.clientMessageId&&old.clientMessageId===value.clientMessageId&&old.ticketId===ticketId));
    if(index<0){rows.push(value);continue;}
    const old=rows[index]!;
    if(old.ticketId!==ticketId||old.content!==value.content||old.senderType!==value.senderType)throw Error("conversation_message_changed");
    const previous=old.delivery?.revision??-1,next=value.delivery?.revision??-1;
    if(next<previous)continue;
    if(next===previous&&old.delivery?.status!==value.delivery?.status)throw Error("conversation_projection_changed");
    rows[index]=value;
  }
  return rows.sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
}
