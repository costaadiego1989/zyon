import {createHash} from "node:crypto";
import {Prisma,type PrismaClient,type PlatformProspectSenderBinding} from "@prisma/client";
import type {ProspectMetaChange,ProspectMetaDispatchPort} from "../../../../shared/integrations/prospect-meta-dispatch.port.js";
import {normalizeContactIdentity} from "../../domain/crm/prospect-contact.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
import {protectedContactLookups,type SuppressionKeyRing} from "../crm/prisma-prospect-privacy.repository.js";

const object=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
const str=(v:unknown,max:number)=>typeof v==="string"&&v.length>0&&v.length<=max?v:null;
export interface InboundPayload {endpointId:string|null;providerId:string;body:string;status:string|null;opaque:string|null}
export class PrismaProspectMetaInbox implements ProspectMetaDispatchPort{
 constructor(private readonly db:PrismaClient,private readonly keys:SuppressionKeyRing){}
 async accept(change:ProspectMetaChange){
  return this.db.$transaction(async tx=>{
   const binding=await tx.platformProspectSenderBinding.findFirst({where:{phoneNumberId:change.phoneNumberId,scope:"zyon_platform"},orderBy:[{active:"desc"},{version:"desc"}]});
   if(!binding)return false;
   if(!binding.active||binding.appId!==change.appId||binding.wabaId!==change.wabaId)throw Error("sender_identity_mismatch");
   const receivedAt=new Date();
   for(const item of change.value.messages??[])await this.persist(tx,binding,"inbound",object(item),change,receivedAt);
   for(const item of change.value.statuses??[])await this.persist(tx,binding,"status",object(item),change,receivedAt);
   return true;
  });
 }
 private async persist(tx:Prisma.TransactionClient,binding:PlatformProspectSenderBinding,kind:"inbound"|"status",raw:Record<string,unknown>,change:ProspectMetaChange,receivedAt:Date){
  const providerId=str(raw.id,512);if(!providerId)throw Error("invalid_provider_id");
  const status=kind==="status"?str(raw.status,40):null;
  if(kind==="status"&&!status)throw Error("invalid_status");
  const eventId=status?JSON.stringify([providerId,status,raw.timestamp??null]):providerId;
  const phone=str(kind==="inbound"?raw.from:raw.recipient_id,32);
  const contacts=(change.value.contacts??[]).map(object);
  const contact=phone?contacts.find(c=>c.wa_id===phone):contacts.length===1&&(change.value.messages?.length??0)===1?contacts[0]:undefined;
  const bsuid=str(kind==="inbound"?raw.from_user_id:raw.recipient_user_id,320)??(kind==="inbound"?str(contact?.user_id,320):null);
  const hash=createHash("sha256").update(stableDirectoryJson({raw,bsuid})).digest("hex");
  const unique={senderBindingId:binding.id,eventKind:kind,eventId};
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${binding.id}),hashtext(${eventId}))::text`;
  const existing=await tx.prospectInboxEvent.findUnique({where:{senderBindingId_eventKind_eventId:unique}});
  if(existing){if(existing.payloadHash!==hash)throw Error("inbox_replay_conflict");return;}
  const scope=str(object(binding.grantedAssets).businessId,200);
  const identity=phone?normalizeContactIdentity({kind:"phone",value:phone}):bsuid?normalizeContactIdentity({kind:"bsuid",value:bsuid,businessScope:scope}):null;
  if(kind==="inbound"&&!identity)throw Error("inbound_identity_missing");
  const lookups=identity?protectedContactLookups(identity,this.keys):[];
  let ep=identity?await tx.prospectEndpoint.findFirst({where:{senderBindingId:binding.id,channel:"whatsapp",OR:lookups}}):null;
  const opaque=str(raw.biz_opaque_callback_data,128);
  const attempt=kind==="status"?await tx.outreachAttempt.findFirst({where:{sequence:{senderBindingId:binding.id},OR:[{providerMessageId:providerId},...(opaque?[{id:opaque}]:[])]},include:{sequence:true}}):null;
  if(ep&&attempt&&ep.id!==attempt.sequence.endpointId)throw Error("receipt_identity_conflict");
  if(!ep&&attempt&&!identity)ep=await tx.prospectEndpoint.findUnique({where:{id:attempt.sequence.endpointId}});
  if(!ep&&identity){
   const active=lookups.find(k=>k.keyVersion===this.keys.currentVersion)!;
   const key={senderBindingId:binding.id,channel:"whatsapp",...active};
   ep=await tx.prospectEndpoint.upsert({where:{senderBindingId_channel_protectedLookup_keyVersion:key},create:{...key,identityKind:identity.kind,businessScope:identity.businessScope,normalizedValue:identity.value},update:{}});
  }
  if(ep)await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ep.id} ORDER BY id FOR UPDATE`;
  const endpoint=ep?await tx.prospectEndpoint.findUniqueOrThrow({where:{id:ep.id},include:{bindings:true,conversations:true}}):null;
  const ids=[binding.id,...endpoint?[endpoint.id,...endpoint.bindings.map(b=>b.prospectId),...endpoint.conversations.map(c=>c.id)]:[],...attempt?[attempt.id]:[]];
  const stamp=typeof raw.timestamp==="string"&&/^\d{10}$/.test(raw.timestamp)?new Date(Number(raw.timestamp)*1000):null;
  const providerOccurredAt=stamp&&stamp<=receivedAt?stamp:null;
  const body=str(object(raw.text).body,16000)??str(object(raw.button).text,256)??str(object(raw.image).caption,4096)??"";
  const payload:InboundPayload={endpointId:endpoint?.id??null,providerId,body,status,opaque};
  const erased=endpoint?.normalizedValue===null;
  await tx.prospectInboxEvent.create({data:{...unique,payloadHash:hash,providerOccurredAt,receivedAt,resourceIds:ids,payload:erased?{redacted:true}:{...payload},state:erased?"processed":"pending",processedAt:erased?receivedAt:null}});
 }
}
