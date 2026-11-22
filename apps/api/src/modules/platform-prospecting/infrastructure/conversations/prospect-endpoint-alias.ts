import type {Prisma} from "@prisma/client";
import {normalizeContactIdentity,type ContactIdentity} from "../../domain/crm/prospect-contact.js";
import {protectedContactLookups,type SuppressionKeyRing} from "../crm/prisma-prospect-privacy.repository.js";

export async function authenticatedEndpoint(tx:Prisma.TransactionClient,senderBindingId:string,keys:SuppressionKeyRing,
  identities:ContactIdentity[],confirmedEndpointId:string|null){
 const lookup=identities.flatMap(identity=>protectedContactLookups(identity,keys));
 const ids=new Set<string>(confirmedEndpointId?[confirmedEndpointId]:[]);
 if(lookup.length){
  // Serialize simultaneous first sightings of the same authenticated address across messages.
  for(const key of lookup.map(k=>k.protectedLookup).sort())await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${senderBindingId}),hashtext(${key}))::text`;
  for(const ep of await tx.prospectEndpoint.findMany({where:{senderBindingId,channel:"whatsapp",OR:lookup},select:{id:true}}))ids.add(ep.id);
  for(const alias of await tx.prospectEndpointAlias.findMany({where:{senderBindingId,OR:lookup}}))ids.add(alias.endpointId);
 }
 if(ids.size>1)throw Error("receipt_identity_conflict");
 const id=[...ids][0],identity=identities[0];
 let ep=id?await tx.prospectEndpoint.findFirstOrThrow({where:{id,senderBindingId}}):null;
 if(!ep&&identity){
  const key={senderBindingId,channel:"whatsapp",...lookup.find(k=>k.keyVersion===keys.currentVersion)!};
  ep=await tx.prospectEndpoint.upsert({where:{senderBindingId_channel_protectedLookup_keyVersion:key},create:{...key,identityKind:identity.kind,businessScope:identity.businessScope,normalizedValue:identity.value},update:{}});
 }
 if(!ep)return null;
 await tx.$queryRaw`SELECT id FROM prospect_endpoints WHERE id=${ep.id} ORDER BY id FOR UPDATE`;
 const endpoint=await tx.prospectEndpoint.findUniqueOrThrow({where:{id:ep.id},include:{bindings:true,conversations:true}});
 for(const identity of identities){
  if(endpoint.normalizedValue&&endpoint.identityKind===identity.kind&&(endpoint.normalizedValue!==identity.value||endpoint.businessScope!==identity.businessScope))throw Error("receipt_identity_conflict");
  const key=protectedContactLookups(identity,keys).find(k=>k.keyVersion===keys.currentVersion)!;
  await tx.prospectEndpointAlias.upsert({where:{senderBindingId_protectedLookup_keyVersion:{senderBindingId,...key}},create:{senderBindingId,endpointId:endpoint.id,...key},update:{}});
 }
 return endpoint;
}
export const observedBsuid=(value:string,scope:string|null)=>normalizeContactIdentity({kind:"bsuid",value,businessScope:scope});
