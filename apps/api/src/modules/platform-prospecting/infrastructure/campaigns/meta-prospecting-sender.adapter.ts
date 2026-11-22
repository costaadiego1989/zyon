import type {PlatformSenderBinding} from "@zyon/shared-types";
import type {StrictWhatsAppResult} from "../../../whatsapp-channel/domain/ports/whatsapp-sender.port.js";
import type {ProspectSendPacket,ProspectSendResult} from "../../domain/prospecting.ports.js";
import type {SenderObservationStore} from "../../application/campaigns/sender-readiness.service.js";
import {platformGraph} from "./platform-meta-authorization.js";

const rejected=(errorCode:string):ProspectSendResult=>({state:"not_accepted",errorCode});
type OfficialResult=StrictWhatsAppResult & {contacts?:{input?:string;user_id?:string}[]};
async function postOfficial(fetcher:typeof fetch,phoneId:string,token:string,body:unknown):Promise<OfficialResult>{
 try{
  const response=await fetcher(platformGraph+phoneId+"/messages",{method:"POST",redirect:"error",signal:AbortSignal.timeout(15_000),headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(body)});
  const value=await response.json() as {messages?:{id?:unknown}[];contacts?:OfficialResult['contacts'];error?:{code?:number}};
  if(!response.ok){
   if(response.status>=400&&response.status<500&&![408,409].includes(response.status)&&Number.isSafeInteger(value?.error?.code))return {status:"failed",acceptance:"not_accepted",messageId:""};
   return {status:"uncertain",messageId:""};
  }
  const id=value?.messages?.[0]?.id;
  if(typeof id==="string"&&id.trim()&&id.length<=512)return {status:"sent",messageId:id,contacts:Array.isArray(value.contacts)?value.contacts:undefined};
 }catch{ /* A dispatched request can have been accepted even when reading its response fails. */ }
 return {status:"uncertain",messageId:""};
}
export class MetaProspectingSenderAdapter {
 constructor(private readonly store:Pick<SenderObservationStore,"credential">,private readonly transport?:typeof fetch){}
 static official(store:Pick<SenderObservationStore,"credential">,config:{enabled:boolean;metaSendEnabled:boolean}){
  return new MetaProspectingSenderAdapter(store,config.enabled&&config.metaSendEnabled?fetch:undefined);
 }
 async send(packet:ProspectSendPacket,expected:PlatformSenderBinding):Promise<ProspectSendResult>{
  if(!this.transport)return rejected("sender_unavailable");
  const credentials=await this.store.credential().catch(()=>null);if(!credentials)return rejected("sender_unavailable");
  const {binding,accessToken,businessId}=credentials;
  if(binding.id!==packet.senderBindingId||binding.version!==packet.senderVersion||binding.id!==expected.id||binding.version!==expected.version||binding.appId!==expected.appId||binding.wabaId!==expected.wabaId||binding.phoneNumberId!==expected.phoneNumberId||!/^\d+$/.test(binding.phoneNumberId))return rejected("sender_identity_mismatch");
  const {identity,template}=packet;
  if(!identity||identity.value!==packet.normalizedEndpoint||!packet.attempt.id||!/^[-A-Za-z0-9_]{1,128}$/.test(packet.attempt.id))return rejected("sender_identity_mismatch");
  let address:{recipient:string}|{to:string};
  if(identity.kind==="bsuid"&&identity.businessScope===businessId&&identity.value.length<=320&&identity.value&&!/\s|[\x00-\x1f]/.test(identity.value))address={recipient:identity.value};
  else if(identity.kind==="phone"&&identity.businessScope===null&&/^\+[1-9]\d{7,14}$/.test(identity.value))address={to:identity.value};
  else return rejected("sender_identity_mismatch");
  if(template&&(template.wabaId!==binding.wabaId||template.status!=="APPROVED"||!template.revision||!template.name||!template.language))return rejected("template_binding_mismatch");
  if(template && template.requiresParameters!==false)return rejected("template_unavailable");
  if(template && (!template.previewText||template.previewText!==packet.content))return rejected("template_binding_mismatch");
  if(!template&&(!packet.content?.trim()||Array.from(packet.content).length>4096))return rejected("invalid_message");
  const message=template?{type:"template",template:{name:template.name,language:{code:template.language}}}:{type:"text",text:{body:packet.content,preview_url:false}};
  const result=await postOfficial(this.transport,binding.phoneNumberId,accessToken,{messaging_product:"whatsapp",recipient_type:"individual",...address,...message,biz_opaque_callback_data:packet.attempt.id});
  if(result.status==="sent"){
    const contact=result.contacts?.length===1?result.contacts[0]:undefined;
    const confirmed=identity.kind==="phone"&&typeof contact?.input==="string"&&/^\+?\d{8,15}$/.test(contact.input)&&contact.input.replace(/^\+/,"")===identity.value.slice(1)&&typeof contact.user_id==="string"&&contact.user_id.length>0&&contact.user_id.length<=320&&!/\s|[\x00-\x1f]/.test(contact.user_id);
    return {state:"provider_accepted",providerMessageId:result.messageId,acceptedAt:new Date(),...(confirmed?{confirmedBsuid:{value:contact.user_id!,businessScope:businessId}}:{})};
  }
  return result.acceptance==="not_accepted"?rejected("provider_rejected"):{state:"outcome_unknown",errorCode:"provider_acceptance_unknown"};
 }
}
