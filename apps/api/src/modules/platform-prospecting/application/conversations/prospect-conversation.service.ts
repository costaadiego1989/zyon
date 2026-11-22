import type {ChangeProspectOwnership,PlatformSenderBinding,ProspectConversation,ProspectMessage,ProspectNote,ProspectRealtimeEvent,SendProspectMessage} from "@zyon/shared-types";
import type {ConversationRepositoryPort,PlatformSenderPort,ProspectingActor,ProspectSendPacket,ProspectSendResult} from "../../domain/prospecting.ports.js";

export type ReplyQuote=(context:{campaignId:string|null;endpointId:string;now:Date})=>{amountCents:number;currency:"BRL";validUntil:Date}|null;
export interface ConversationReadStore extends Pick<ConversationRepositoryPort,"list"|"history">{
 notes(id:string,cursor:string|undefined,limit:number):Promise<{items:ProspectNote[];nextCursor:string|null}>;
 changes(id:string,after:number,limit:number):Promise<{items:ProspectRealtimeEvent[];nextCursor:string;hasMore:boolean}>;
}
export interface ConversationCommandStore{
 ownership(id:string,cmd:ChangeProspectOwnership,actor:ProspectingActor):Promise<ProspectConversation>;
 prepareManual(id:string,cmd:SendProspectMessage,actor:ProspectingActor):Promise<ProspectMessage>;
 prepareAi(id:string,cmd:SendProspectMessage):Promise<ProspectMessage>;
 addNote(id:string,cmd:{content:string;clientRequestId:string},actor:ProspectingActor):Promise<ProspectNote>;
 markRead(id:string,cmd:{sequence:number;clientRequestId:string},actor:ProspectingActor):Promise<{readSequence:number}>;
 reply(messageId:string):Promise<ProspectMessage>;
 beginSubmission(messageId:string,binding:PlatformSenderBinding):Promise<ProspectSendPacket|null>;
 settleReply(messageId:string,binding:PlatformSenderBinding,result:ProspectSendResult):Promise<ProspectMessage>;
}
function content(value:string){if(typeof value!=="string"||!value.trim()||Array.from(value).length>4000)throw Error("invalid_command:content");}
function epoch(n:number){if(!Number.isSafeInteger(n)||n<0)throw Error("invalid_command:expectedEpoch");}
export class ProspectConversationService{
 constructor(readonly repository:ConversationReadStore,private readonly commands:ConversationCommandStore,private readonly health:Pick<PlatformSenderPort,"readiness">,private readonly sender:Pick<PlatformSenderPort,"send">){}
 ownership(id:string,cmd:ChangeProspectOwnership,actor:ProspectingActor){
  epoch(cmd.expectedEpoch);if(!["assume","release"].includes(cmd.action))throw Error("invalid_command:action");
  return this.commands.ownership(id,cmd,actor);
 }
 prepareManual(id:string,cmd:SendProspectMessage,actor:ProspectingActor){
  content(cmd.content);epoch(cmd.expectedEpoch);return this.commands.prepareManual(id,cmd,actor);
 }
 prepareAi(id:string,cmd:SendProspectMessage){
  content(cmd.content);epoch(cmd.expectedEpoch);return this.commands.prepareAi(id,cmd);
 }
 addNote(id:string,cmd:{content:string;clientRequestId:string},actor:ProspectingActor){
  content(cmd.content);return this.commands.addNote(id,cmd,actor);
 }
 markRead(id:string,cmd:{sequence:number;clientRequestId:string},actor:ProspectingActor){
  if(!Number.isSafeInteger(cmd.sequence)||cmd.sequence<0)throw Error("invalid_command:sequence");
  return this.commands.markRead(id,cmd,actor);
 }
 async dispatch(messageId:string){
  const current=await this.commands.reply(messageId);
  if(current.state!=="prepared"||current.attemptId)return current;
  const health=await this.health.readiness(),binding=health.binding;
  if(health.status!=="ready"||health.blockers.length||!binding)throw Error(health.blockers[0]??"sender_unavailable");
  const packet=await this.commands.beginSubmission(messageId,binding);
  if(!packet)return this.commands.reply(messageId);
  let result:ProspectSendResult;
  try{result=await this.sender.send(packet,binding);}
  catch{result={state:"outcome_unknown",errorCode:"provider_acceptance_unknown"};}
  if(result.state==="provider_accepted"&&!result.providerMessageId?.trim())result={state:"outcome_unknown",errorCode:"missing_message_id"};
  return this.commands.settleReply(messageId,binding,result);
 }
}
