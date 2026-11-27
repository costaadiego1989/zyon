import type {PrismaClient,PlatformProspectTemplate} from "@prisma/client";
import type {CreatePlatformProspectTemplate,PlatformProspectTemplateDraft,PlatformSenderBinding,SubmitPlatformProspectTemplate} from "@zyon/shared-types";
import type {PlatformTemplateStore,TemplateObservation} from "../../application/campaigns/platform-template.service.js";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {prospectAudit,prospectCommand} from "../crm/prospect-command.js";
import {validateProspectingMaxPrice} from "@zyon/shared-types";
const project=(d:PlatformProspectTemplate):PlatformProspectTemplateDraft=>({id:d.id,purpose:"zyon_sales",name:d.name,language:d.language,body:d.body,maxPrice:validateProspectingMaxPrice(d.maxPrice),revision:d.revision,contentHash:d.contentHash,bindingId:d.bindingId,bindingVersion:d.bindingVersion,wabaId:d.wabaId,providerId:d.providerId,providerRevision:d.providerRevision,state:d.state as PlatformProspectTemplateDraft["state"],reason:d.reason,submittedAt:d.submittedAt?.toISOString()??null,observedAt:d.observedAt?.toISOString()??null});
export class PrismaPlatformTemplateStore implements PlatformTemplateStore {
 constructor(private readonly db:PrismaClient){}
 create(cmd:CreatePlatformProspectTemplate,contentHash:string,actor:ProspectingActor){return prospectCommand(this.db,"template.draft",cmd,actor,async tx=>{
  const d=await tx.platformProspectTemplate.create({data:{purpose:"zyon_sales",name:(cmd.name+"_"+contentHash.slice(0,10)).slice(0,120),language:cmd.language,body:cmd.body,...(cmd.maxPrice?{maxPrice:JSON.parse(JSON.stringify(cmd.maxPrice))}:{}),contentHash,createdBy:actor.operatorId}});await prospectAudit(tx,actor,"template.draft","platform_template",d.id,1);return {result:project(d),resourceIds:[d.id]};});}
 async find(id:string){const d=await this.db.platformProspectTemplate.findFirst({where:{id,purpose:"zyon_sales"}});if(!d)throw Error("template_unavailable");return project(d);}
 async list(){return (await this.db.platformProspectTemplate.findMany({where:{purpose:"zyon_sales"},orderBy:[{createdAt:"desc"},{id:"asc"}],take:100})).map(project);}
 async authorize(binding:PlatformSenderBinding){return !!await this.db.platformProspectSenderBinding.findFirst({where:{id:binding.id,version:binding.version,scope:"zyon_platform",active:true,wabaId:binding.wabaId,phoneNumberId:binding.phoneNumberId,appId:binding.appId,authorizationVersion:binding.authorizationVersion}});}
 async claim(id:string,cmd:SubmitPlatformProspectTemplate,b:PlatformSenderBinding,actor:ProspectingActor){
  let acquired=false;
  const draft=await prospectCommand(this.db,"template.submit",{...cmd,id},actor,async tx=>{
   await tx.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('zyon_platform_sender'))::text`;
   await tx.$queryRaw`SELECT id FROM platform_prospect_templates WHERE id=${id} FOR UPDATE`;
   const d=await tx.platformProspectTemplate.findFirst({where:{id,purpose:"zyon_sales"}});if(!d)throw Error("template_unavailable");if(d.revision!==cmd.expectedRevision)throw Error("version_conflict");
   if(!await tx.platformProspectSenderBinding.findFirst({where:{id:b.id,scope:"zyon_platform",active:true,version:b.version,wabaId:b.wabaId}}))throw Error("sender_identity_mismatch");
   if(d.state!=="draft")return {result:project(d),resourceIds:[id]};
   const updated=await tx.platformProspectTemplate.update({where:{id},data:{state:"submitting",bindingId:b.id,bindingVersion:b.version,wabaId:b.wabaId,submissionId:cmd.clientRequestId,submittedAt:new Date(),reason:null}});acquired=true;
   await prospectAudit(tx,actor,"template.submit","platform_template",id,d.revision);return {result:project(updated),resourceIds:[id]};});return {draft,acquired};
 }
 observe(id:string,cmd:SubmitPlatformProspectTemplate,b:PlatformSenderBinding,o:TemplateObservation,actor:ProspectingActor){return this.db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM platform_prospect_templates WHERE id=${id} FOR UPDATE`;const d=await tx.platformProspectTemplate.findUniqueOrThrow({where:{id}});
  if(d.purpose!=="zyon_sales"||d.revision!==cmd.expectedRevision||d.bindingId!==b.id||d.bindingVersion!==b.version||d.wabaId!==b.wabaId)throw Error("template_binding_mismatch");
  if(cmd.clientRequestId===d.submissionId&&d.observedAt&&d.state!=="submitting")return project(d);
  const updated=await tx.platformProspectTemplate.update({where:{id},data:{state:o.state,reason:o.reason?.slice(0,500)??null,providerId:o.providerId,providerRevision:o.providerRevision,observedAt:new Date()}});
  await prospectAudit(tx,actor,"template.observed","platform_template",id,d.revision,{state:o.state,reason:o.reason});return project(updated);
 });}
}
