import {createHash} from "node:crypto";
import type {CreatePlatformProspectTemplate,PlatformProspectTemplateDraft,PlatformSenderBinding,PlatformSenderReadiness,ProspectingTemplate,SubmitPlatformProspectTemplate} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import type {PlatformSenderCredential,SenderObservationStore} from "./sender-readiness.service.js";
import {prospectText,prospectVersion} from "../crm/prospect.service.js";
import {validateProspectingMaxPrice} from "@zyon/shared-types";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
export interface TemplateObservation {state:PlatformProspectTemplateDraft["state"];providerId:string|null;providerRevision:string|null;reason:string|null}
export interface PlatformTemplateGateway {submit(d:PlatformProspectTemplateDraft,c:PlatformSenderCredential):Promise<TemplateObservation>;sync(d:PlatformProspectTemplateDraft,c:PlatformSenderCredential):Promise<TemplateObservation|null>}
export interface PlatformTemplateStore {
 create(c:CreatePlatformProspectTemplate,hash:string,a:ProspectingActor):Promise<PlatformProspectTemplateDraft>;
 find(id:string):Promise<PlatformProspectTemplateDraft>;list():Promise<PlatformProspectTemplateDraft[]>;
 claim(id:string,c:SubmitPlatformProspectTemplate,b:PlatformSenderBinding,a:ProspectingActor):Promise<{draft:PlatformProspectTemplateDraft;acquired:boolean}>;
 observe(id:string,c:SubmitPlatformProspectTemplate,b:PlatformSenderBinding,o:TemplateObservation,a:ProspectingActor):Promise<PlatformProspectTemplateDraft>;
 authorize(binding:PlatformSenderBinding):Promise<boolean>;
}
export class PlatformTemplateService {
 constructor(private readonly store:PlatformTemplateStore,private readonly credentials:Pick<SenderObservationStore,"credential">,private readonly gateway:PlatformTemplateGateway,private readonly health:{readiness():Promise<PlatformSenderReadiness>}){}
 async create(c:CreatePlatformProspectTemplate,a:ProspectingActor){
  prospectText(c.body,"body",1024);if(c.body.includes("{{")||!/^[_a-z][_a-z0-9]{1,99}$/.test(c.name)||!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(c.language))throw Error("invalid_command:template");
  const maxPrice=validateProspectingMaxPrice(c.maxPrice);
  const hash=createHash("sha256").update(JSON.stringify({purpose:"zyon_sales",language:c.language,body:c.body,...(maxPrice?{maxPrice}:{})})).digest("hex");return this.store.create({...c,maxPrice},hash,a);
 }
 list(){return this.store.list();}
 find(id:string){return this.store.find(id);}
 private async credential(d:PlatformProspectTemplateDraft){
  const c=await this.credentials.credential();if(!c)throw Error("sender_unavailable");
  if(!await this.store.authorize(c.binding)||d.bindingId&&(d.bindingId!==c.binding.id||d.bindingVersion!==c.binding.version||d.wabaId!==c.binding.wabaId))throw Error("sender_identity_mismatch");return c;
 }
 async submit(id:string,cmd:SubmitPlatformProspectTemplate,a:ProspectingActor){
  prospectVersion(cmd.expectedRevision);const d=await this.store.find(id),credential=await this.credential(d);const claim=await this.store.claim(id,cmd,credential.binding,a);
  if(!claim.acquired)return this.store.find(id);
  let observation:TemplateObservation;
  try{if(!await this.store.authorize(credential.binding))throw Error();observation=await this.gateway.submit(claim.draft,credential);}catch{observation={state:"submission_unknown",reason:"create_outcome_unknown",providerId:null,providerRevision:null};}
  return this.store.observe(id,cmd,credential.binding,observation,a);
 }
 async sync(id:string,cmd:SubmitPlatformProspectTemplate,a:ProspectingActor){
  prospectVersion(cmd.expectedRevision);const d=await this.store.find(id);if(d.revision!==cmd.expectedRevision)throw Error("version_conflict");if(!d.bindingId)throw Error("template_unavailable");
  const c=await this.credential(d),result=await this.gateway.sync(d,c);
  return this.store.observe(id,cmd,c.binding,result??{state:"submission_unknown",providerId:d.providerId,providerRevision:null,reason:"template_not_found"},a);
 }
 async compatible(bindingId:string,version:number,registryId?:string,body?:string|null):Promise<ProspectingTemplate|null>{
  const h=await this.health.readiness();if(h.binding?.id!==bindingId||h.binding.version!==version)return null;
  for(const d of await this.store.list()){
   if(registryId&&d.id!==registryId||body&&d.body!==body||d.state!=="APPROVED"||d.bindingId!==bindingId||d.bindingVersion!==version||d.wabaId!==h.binding.wabaId)continue;
   const t=h.templates.find(t=>t.id===d.providerId&&t.wabaId===d.wabaId&&t.revision===d.providerRevision&&t.name===d.name&&t.language===d.language&&t.status==="APPROVED"&&t.category==="MARKETING"&&t.requiresParameters===false&&t.previewText===d.body);
   if(t&&stableDirectoryJson(t.maxPrice??null)===stableDirectoryJson(d.maxPrice??null))return t;
  }return null;
 }
}
