import {createHash} from "node:crypto";
import type {PlatformProspectTemplateDraft} from "@zyon/shared-types";
import type {PlatformTemplateGateway,TemplateObservation} from "../../application/campaigns/platform-template.service.js";
import type {PlatformSenderCredential} from "../../application/campaigns/sender-readiness.service.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
import {platformGraph} from "./platform-meta-authorization.js";
import {observedMaxPrice,optimizationSpec,verifyMaxPriceEnrollment} from "./meta-max-price.js";
const states=["PENDING","APPROVED","REJECTED","PAUSED","DISABLED"];
export class MetaPlatformTemplateAdapter implements PlatformTemplateGateway {
 constructor(private readonly transport:typeof fetch=fetch){}
 private async json(response:Response){
  if(!response.body)throw Error("template_unavailable");const r=response.body.getReader(),parts:Uint8Array[]=[];let size=0;try{for(;;){const p=await r.read();if(p.done)break;size+=p.value.length;if(size>262144){await r.cancel();throw Error("template_unavailable");}parts.push(p.value);}}finally{r.releaseLock();}return JSON.parse(Buffer.concat(parts).toString("utf8"));
 }
 private observation(t:any,d:PlatformProspectTemplateDraft,c:PlatformSenderCredential):TemplateObservation{
  let maxPrice;
  try{maxPrice=observedMaxPrice(t.optimization_spec);if(stableDirectoryJson(maxPrice)!==stableDirectoryJson(d.maxPrice??null))throw Error();}
  catch{return {state:states.includes(t.status)?t.status:"submission_unknown",providerId:typeof t.id==="string"?t.id:null,providerRevision:null,reason:"template_pricing_mismatch"};}
  if(typeof t.id!=="string"||t.name!==d.name||t.language!==d.language||t.category!=="MARKETING"||!Array.isArray(t.components)||t.components.length!==1||t.components[0]?.type!=="BODY"||t.components[0]?.text!==d.body||d.body.includes("{{"))return {state:states.includes(t.status)?t.status:"submission_unknown",providerId:typeof t.id==="string"?t.id:null,providerRevision:null,reason:"template_content_mismatch"};
  const state=states.includes(t.status)?t.status:"submission_unknown";
  return {state,providerId:t.id,providerRevision:createHash("sha256").update(stableDirectoryJson({id:t.id,name:t.name,language:t.language,category:t.category,wabaId:c.binding.wabaId,components:t.components,...(maxPrice?{optimization_spec:optimizationSpec(maxPrice)}:{})})).digest("hex"),reason:typeof t.rejected_reason==="string"?t.rejected_reason.slice(0,500):null};
 }
 async sync(d:PlatformProspectTemplateDraft,c:PlatformSenderCredential):Promise<TemplateObservation|null>{
  if(d.maxPrice)await verifyMaxPriceEnrollment(c,this.transport);
  const url=new URL(c.binding.wabaId+"/message_templates",platformGraph);url.searchParams.set("fields","id,name,language,category,status,components,rejected_reason,optimization_spec");url.searchParams.set("limit","100");
  for(let page=0;page<20;page++){
   const response=await this.transport(url,{redirect:"error",signal:AbortSignal.timeout(5000),headers:{Authorization:"Bearer "+c.accessToken}});if(!response.ok)throw Error("template_unavailable");const payload=await this.json(response);if(!Array.isArray(payload.data))throw Error("template_unavailable");
   const found=payload.data.find((t:any)=>t.name===d.name&&t.language===d.language);if(found)return this.observation(found,d,c);
   if(!payload.paging?.next)return null;const after=payload.paging.cursors?.after;if(typeof after!=="string"||after===url.searchParams.get("after"))throw Error("template_unavailable");url.searchParams.set("after",after);
  }throw Error("template_unavailable");
 }
 async submit(d:PlatformProspectTemplateDraft,c:PlatformSenderCredential):Promise<TemplateObservation>{
  let existing:TemplateObservation|null;
  try{existing=await this.sync(d,c);}catch(error){return {state:"draft",providerId:null,providerRevision:null,reason:error instanceof Error&&/^max_price_/.test(error.message)?error.message:"provider_lookup_unavailable"};}if(existing)return existing;
  const unknown=(reason:string):TemplateObservation=>({state:"submission_unknown",providerId:null,providerRevision:null,reason});
  try{
   const response=await this.transport(new URL(c.binding.wabaId+"/message_templates",platformGraph),{method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),headers:{Authorization:"Bearer "+c.accessToken,"Content-Type":"application/json"},body:JSON.stringify({name:d.name,language:d.language,category:"MARKETING",components:[{type:"BODY",text:d.body}],...(d.maxPrice?{optimization_spec:optimizationSpec(d.maxPrice)}:{})})});
   const payload=await this.json(response);
   if(!response.ok){if(response.status>=400&&response.status<500&&![408,429].includes(response.status))return {state:"draft",providerId:null,providerRevision:null,reason:"create_failed_"+response.status};return unknown("create_outcome_unknown");}
   if(typeof payload.id!=="string"||!payload.id)return unknown("provider_identifier_missing");
   return {state:states.includes(payload.status)?payload.status:"PENDING",providerId:payload.id,providerRevision:null,reason:typeof payload.rejected_reason==="string"?payload.rejected_reason.slice(0,500):null};
  }catch{return unknown("create_outcome_unknown");}
 }
}
