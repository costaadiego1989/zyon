import {createHash} from "node:crypto";
import {Prisma,type PrismaClient,type PlatformProspectSenderBinding} from "@prisma/client";
import type {ProspectMetaChange,ProspectMetaDispatchPort} from "../../../../shared/integrations/prospect-meta-dispatch.port.js";
import {normalizeContactIdentity} from "../../domain/crm/prospect-contact.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
import {receiptReference} from "./prospect-receipt-reference.js";
import {authenticatedEndpoint,observedBsuid} from "./prospect-endpoint-alias.js";
import {protectedContactLookups,type SuppressionKeyRing} from "../crm/prisma-prospect-privacy.repository.js";
import {prospectProviderCost,type ProspectProviderCost} from "../../domain/campaigns/prospect-message-cost.js";

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const str=(v:unknown,max:number)=>typeof v==="string"&&v.length>0&&v.length<=max?v:null;
export interface InboundPayload {endpointId:string|null;providerId:string;body:string;status:string|null;opaque:string|null;contextId:string|null;providerCost?:ProspectProviderCost|null;providerError?:{code:number;subcode?:number}|null}
export class PrismaProspectMetaInbox implements ProspectMetaDispatchPort{
 constructor(private readonly db:PrismaClient,private readonly keys:SuppressionKeyRing){}
 async accept(change:ProspectMetaChange){
  return this.db.$transaction(async tx=>{
   const binding=await tx.platformProspectSenderBinding.findFirst({where:{phoneNumberId:change.phoneNumberId,scope:"zyon_platform"},orderBy:[{active:"desc"},{version:"desc"}]});
   if(!binding)return false;
   if(binding.appId!==change.appId||binding.wabaId!==change.wabaId)throw Error("sender_identity_mismatch");
   const receivedAt=new Date();
   const shared=object(binding.grantedAssets).routingMode==="shared";
   if(!binding.active){if(shared)return {remainingValue:change.value};throw Error("sender_identity_mismatch");}
   const remainingMessages:unknown[]=[],remainingStatuses:unknown[]=[];
   for(const item of change.value.messages??[]){
    if(shared&&!await this.knownProspect(tx,binding,object(item),change)){remainingMessages.push(item);continue;}
    await this.persist(tx,binding,"inbound",object(item),change,receivedAt);
   }
   for(const item of change.value.statuses??[]){
    const raw=object(item);
    if(shared&&!await receiptReference(tx,binding.id,str(raw.id,512)??"",str(raw.biz_opaque_callback_data,128))){remainingStatuses.push(item);continue;}
    await this.persist(tx,binding,"status",raw,change,receivedAt);
   }
   return shared?{remainingValue:{...change.value,messages:remainingMessages,statuses:remainingStatuses}}:true;
  });
 }
 private async knownProspect(tx:Prisma.TransactionClient,binding:PlatformProspectSenderBinding,raw:Record<string,unknown>,change:ProspectMetaChange){
  const phone=str(raw.from,32),digits=(v:string)=>v.replace(/^\+/,"");
  const contacts=(change.value.contacts??[]).map(object),contact=phone?contacts.find(c=>typeof c.wa_id==="string"&&digits(c.wa_id)===digits(phone)):contacts.length===1&&(change.value.messages?.length??0)===1?contacts[0]:undefined;
  const providerPhone=phone??str(contact?.wa_id,32),bsuid=str(raw.from_user_id,320)??str(contact?.user_id,320),scope=str(object(binding.grantedAssets).businessId,200);
  const identities=[...providerPhone&&/^\+?[1-9]\d{7,14}$/.test(providerPhone)?[normalizeContactIdentity({kind:"phone",value:"+"+digits(providerPhone)})]:[],...bsuid?[observedBsuid(bsuid,scope)]:[]];
  const lookup=identities.flatMap(i=>protectedContactLookups(i,this.keys));if(!lookup.length)return false;
  const ids=new Set<string>();
  for(const ep of await tx.prospectEndpoint.findMany({where:{senderBindingId:binding.id,channel:"whatsapp",OR:lookup},select:{id:true}}))ids.add(ep.id);
  for(const alias of await tx.prospectEndpointAlias.findMany({where:{senderBindingId:binding.id,OR:lookup},select:{endpointId:true}}))ids.add(alias.endpointId);
  if(ids.size>1)throw Error("receipt_identity_conflict");const endpointId=[...ids][0];if(!endpointId)return false;
  const contextId=str(object(raw.context).id,512);
  if(contextId){const ref=await receiptReference(tx,binding.id,contextId,null);if(!ref)return false;if(ref.endpointId!==endpointId)throw Error("receipt_identity_conflict");return true;}
  if(await tx.prospectMessage.findFirst({where:{senderBindingId:binding.id,direction:"outbound",submittedAt:{not:null},conversation:{endpointId}},select:{id:true}}))return true;
  return !!await tx.outreachAttempt.findFirst({where:{sequence:{senderBindingId:binding.id,endpointId},submittedAt:{not:null},state:{in:["submitting","outcome_unknown","provider_accepted","delivered","read"]}},select:{id:true}});
 }
 private async persist(tx:Prisma.TransactionClient,binding:PlatformProspectSenderBinding,kind:"inbound"|"status",raw:Record<string,unknown>,change:ProspectMetaChange,receivedAt:Date){
  const providerId=str(raw.id,512);if(!providerId)throw Error("invalid_provider_id");
  const status=kind==="status"?str(raw.status,40):null;
  if(kind==="status"&&!status)throw Error("invalid_status");
  const eventId=status?JSON.stringify([providerId,status,raw.timestamp??null]):providerId;
  const senderPhone=str(kind==="inbound"?raw.from:raw.recipient_id,32);
  const digits=(s:string)=>s.replace(/^\+/,"");
  const contacts=(change.value.contacts??[]).map(object);
  const contact=senderPhone?contacts.find(c=>typeof c.wa_id==="string"&&digits(c.wa_id)===digits(senderPhone)):contacts.length===1&&(change.value.messages?.length??0)===1?contacts[0]:undefined;
  const providerPhone=senderPhone??(kind==="inbound"?str(contact?.wa_id,32):null);
  if(providerPhone&&!/^\+?[1-9]\d{7,14}$/.test(providerPhone))throw Error("invalid_contact:provider_phone");
  const phone=providerPhone?"+"+digits(providerPhone):null;
  const bsuid=str(kind==="inbound"?raw.from_user_id:raw.recipient_user_id,320)??(kind==="inbound"?str(contact?.user_id,320):null);
  const hash=createHash("sha256").update(stableDirectoryJson({raw,bsuid})).digest("hex");
  const unique={senderBindingId:binding.id,eventKind:kind,eventId};
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${binding.id}),hashtext(${eventId}))::text`;
  const existing=await tx.prospectInboxEvent.findUnique({where:{senderBindingId_eventKind_eventId:unique}});
  if(existing){if(existing.payloadHash!==hash)throw Error("inbox_replay_conflict");return;}
  const scope=str(object(binding.grantedAssets).businessId,200);
  const identities=[...phone?[normalizeContactIdentity({kind:"phone",value:phone})]:[],...bsuid?[observedBsuid(bsuid,scope)]:[]];
  if(kind==="inbound"&&!identities.length)throw Error("inbound_identity_missing");
  const opaque=str(raw.biz_opaque_callback_data,128),contextId=str(object(raw.context).id,512);
  const ref=kind==="status"?await receiptReference(tx,binding.id,providerId,opaque):null;
  const endpoint=await authenticatedEndpoint(tx,binding.id,this.keys,identities,ref?.endpointId??null);
  const ids=[binding.id,...endpoint?[endpoint.id,...endpoint.bindings.map(b=>b.prospectId),...endpoint.conversations.map(c=>c.id)]:[],
   ...[ref?.messageId,ref?.conversationId,ref?.attemptId].filter((id):id is string=>!!id)];
  const stamp=typeof raw.timestamp==="string"&&/^\d{10}$/.test(raw.timestamp)?new Date(Number(raw.timestamp)*1000):null;
  const providerOccurredAt=stamp&&stamp<=receivedAt?stamp:null;
  const body=str(object(raw.text).body,16000)??str(object(raw.button).text,256)??str(object(raw.image).caption,4096)??"";
  const error=Array.isArray(raw.errors)?raw.errors.map(object).find(e=>Number.isSafeInteger(e.code)):undefined;
  const providerError=error?{code:error.code as number,...(Number.isSafeInteger(error.error_subcode)?{subcode:error.error_subcode as number}:{})}:null;
  const payload:InboundPayload={endpointId:endpoint?.id??null,providerId,body,status,opaque,contextId,...(kind==="status"?{providerCost:prospectProviderCost(raw.pricing),...(status==="failed"?{providerError}:{})}:{})};
  const erased=endpoint?.normalizedValue===null&&kind==="inbound";
  if(endpoint&&!erased&&kind==="inbound")await tx.prospectEndpoint.update({where:{id:endpoint.id},data:{lastContactActivityAt:receivedAt}});
  await tx.prospectInboxEvent.create({data:{...unique,payloadHash:hash,providerOccurredAt,receivedAt,resourceIds:ids,payload:erased?{redacted:true}:{...payload},state:erased?"processed":"pending",processedAt:erased?receivedAt:null}});
 }
}
