export interface ConversationContext {merchant_id:string;user_id:string;role:"OWNER"|"ADMIN"|"STAFF"}
export type ConversationStatus="open"|"in_progress"|"closed"|"resolved";
export interface ConversationBinding {id:string;ticketId:string;mode:"ai"|"waiting_human"|"human";epoch:number;assignedOperatorId:string|null}
export interface ConversationSummary {id:string;status:ConversationStatus;buyerMessage:string;createdAt:string;updatedAt:string;binding:ConversationBinding|null}
export type ConversationDeliveryStatus="queued"|"accepted"|"delivered"|"read"|"failed"|"unknown";
export interface ConversationMessage {id:string;ticketId:string;senderType:"buyer"|"merchant"|"system";content:string;createdAt:string;
  clientMessageId?:string;origin?:"text"|"button"|"voice"|"media";delivery?:{status:ConversationDeliveryStatus;revision:number}}
export interface ConversationPage {data:ConversationSummary[];has_more:boolean;next_cursor:string|null}
export interface ConversationDetail {ticket:Omit<ConversationSummary,"binding">;binding:(ConversationBinding&{configId:string;whatsappSessionId:string})|null;
  channel:{id:string;provider:string;status:string;enabled:boolean}|null;messages:ConversationMessage[];has_more:boolean;next_cursor:string|null}
export interface ConversationApi {
  getWhatsAppConversationContext():Promise<ConversationContext>;
  getWhatsAppConversations(query?:{limit?:number;cursor?:string;status?:ConversationStatus}):Promise<ConversationPage>;
  getWhatsAppConversation(ticketId:string,query?:{limit?:number;cursor?:string}):Promise<ConversationDetail>;
  claimWhatsAppConversation(ticketId:string,body:{expectedEpoch:number}):Promise<unknown>;
  closeWhatsAppConversation(ticketId:string,body:{expectedEpoch:number;status?:"closed"|"resolved"}):Promise<unknown>;
  sendWhatsAppConversationMessage(ticketId:string,body:{content:string;clientMessageId:string}):Promise<ConversationMessage>;
}
