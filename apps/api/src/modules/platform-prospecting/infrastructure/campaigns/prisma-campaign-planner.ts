import {createHash,randomUUID} from "node:crypto";
import {Prisma,type PrismaClient,type ProspectCampaignPlanningJob} from "@prisma/client";
import type {CampaignPlanningJob,PrepareCampaignContext} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import type {CampaignPlannerStore} from "../../application/campaigns/campaign-planner.js";
import {resolveCampaignRules,validatePlanningCriteria,type CampaignPlanningScope,type CampaignPlanningModel} from "../../domain/campaigns/campaign-planning.js";
import {prospectAudit,prospectCommand} from "../crm/prospect-command.js";
import {draftInvalidation,lockDraft,type DraftTx} from "./prisma-campaign-drafts.js";
import {resolveDirectoryStorage} from "../company-directory/directory-storage.js";
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const project=(j:ProspectCampaignPlanningJob):CampaignPlanningJob=>({id:j.id,campaignId:j.campaignId,expectedRevision:j.expectedRevision,mode:j.mode as CampaignPlanningJob["mode"],state:j.state as CampaignPlanningJob["state"],criteria:j.criteria as CampaignPlanningJob["criteria"],errorCode:j.errorCode,reservedCents:Number(j.reservedCents),spentCents:Number(j.spentCents)});
async function scope(tx:DraftTx,snapshotId:string):Promise<CampaignPlanningScope>{
 const s=await resolveDirectoryStorage(tx,snapshotId),coverage=(s.snapshot.counts as {coverage?:{ufs?:string[];mainCnaes?:string[]}})?.coverage;
 const regions=await tx.$queryRaw<{uf:string}[]>`SELECT DISTINCT uf FROM company_directory.company_establishments WHERE snapshot_id=${s.storageSnapshotId} AND uf IS NOT NULL ${s.maximumCnpj?Prisma.sql`AND cnpj COLLATE "C"<=${s.maximumCnpj}`:Prisma.empty} ORDER BY uf LIMIT 28`;
 const cnaes=await tx.$queryRaw<{code:string;label:string}[]>`SELECT code,label FROM company_directory.source_domains WHERE snapshot_id=${s.storageSnapshotId} AND kind='cnaes' ORDER BY code LIMIT 4097`;
 const cities=await tx.$queryRaw<{code:string;uf:string;label:string}[]>`SELECT DISTINCT e.city_code AS code,e.uf,d.label FROM company_directory.company_establishments e JOIN company_directory.source_domains d ON d.snapshot_id=e.snapshot_id AND d.kind='municipios' AND d.code=e.city_code WHERE e.snapshot_id=${s.storageSnapshotId} ${s.maximumCnpj?Prisma.sql`AND e.cnpj COLLATE "C"<=${s.maximumCnpj}`:Prisma.empty} AND e.uf IS NOT NULL ORDER BY code,uf LIMIT 6001`;
 const ufs=coverage?.ufs??regions.map(r=>r.uf),available=coverage?.mainCnaes?cnaes.filter(c=>coverage.mainCnaes!.includes(c.code)):cnaes;
 if(!ufs.length||!available.length||cnaes.length>4096||cities.length>6000||ufs.some(v=>!"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").includes(v))||coverage?.mainCnaes?.some(v=>!available.some(c=>c.code===v)))throw Error("context_scope_unavailable");
 return {ufs,cnaes:available,cities:cities.filter(c=>ufs.includes(c.uf))};
}
export class PrismaCampaignPlanner implements CampaignPlannerStore {
 constructor(private readonly db:PrismaClient,private readonly model:CampaignPlanningModel){}
 prepare(id:string,cmd:PrepareCampaignContext,actor:ProspectingActor){return prospectCommand(this.db,"campaign.context.prepare",{...cmd,id},actor,async tx=>{
  const c=await lockDraft(tx,id,cmd.expectedRevision);if(!c.businessContext)throw Error("invalid_command:businessContext");if(c.directorySnapshotId&&c.directorySnapshotId!==cmd.snapshotId)throw Error("snapshot_conflict");
  const contextHash=hash(c.businessContext),prior=await tx.prospectCampaignPlanningJob.findFirst({where:{campaignId:id,contextHash,snapshotId:cmd.snapshotId,OR:[{state:{in:["processing","outcome_unknown"]}},{expectedRevision:c.revision,state:{not:"blocked"}}]},orderBy:{createdAt:"desc"}});if(prior)return {result:project(prior),resourceIds:[id,prior.id]};
  const available=await scope(tx,cmd.snapshotId),request={requestId:cmd.clientRequestId,context:c.businessContext,scope:available};let criteria;let errorCode:string|null=null;
  try{criteria=resolveCampaignRules(c.businessContext,available);}catch{errorCode="context_scope_unsupported";}
  if(!criteria&&!errorCode){if(!this.model.enabled)errorCode="model_disabled";else if(!c.budgetCents)errorCode="planning_budget_missing";else {const q=this.model.quote(request);if(q===null||!Number.isSafeInteger(q)||q<1)errorCode="cost_unknown";else if(c.reservedCents+c.spentCents+BigInt(q)>c.budgetCents)errorCode="budget_conflict";}}
  const job=await tx.prospectCampaignPlanningJob.create({data:{id:randomUUID(),campaignId:id,expectedRevision:c.revision,contextHash,snapshotId:cmd.snapshotId,mode:criteria?"rules":null,state:criteria?"completed":errorCode?"blocked":"pending",errorCode,criteria:criteria?JSON.parse(JSON.stringify(criteria)):Prisma.DbNull}});
  if(criteria)await tx.prospectCampaign.update({where:{id},data:{...draftInvalidation,revision:{increment:1},audienceCriteria:JSON.parse(JSON.stringify(criteria)),directorySnapshotId:cmd.snapshotId,planningMode:"rules"}});
  await prospectAudit(tx,actor,"campaign.context.prepare","campaign",id,c.revision+(criteria?1:0),{jobId:job.id,mode:job.mode,state:job.state,errorCode});return {result:project(job),resourceIds:[id,job.id]};});}
 async poll(campaignId:string,id:string){const j=await this.db.prospectCampaignPlanningJob.findFirst({where:{id,campaignId}});if(!j)throw Error("selection_not_found");return project(j);}
 async processNext():Promise<CampaignPlanningJob|null>{
  const candidate=await this.db.prospectCampaignPlanningJob.findFirst({where:{OR:[{state:"pending"},{state:"processing",leaseExpiresAt:{lte:new Date()}}]},orderBy:{createdAt:"asc"}});if(!candidate)return null;
  const claim=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${candidate.campaignId} FOR UPDATE`;
   const job=await tx.prospectCampaignPlanningJob.findUniqueOrThrow({where:{id:candidate.id}});
   if(job.state==="processing"&&job.leaseExpiresAt!<=new Date()){await tx.prospectCampaignPlanningJob.update({where:{id:job.id},data:{state:"outcome_unknown",errorCode:"planning_outcome_unknown",leaseToken:null,leaseExpiresAt:null}});return null;}
   if(job.state!=="pending")return null;
   const c=await tx.prospectCampaign.findUniqueOrThrow({where:{id:job.campaignId}});let errorCode:string|null=null;
   if(c.revision!==job.expectedRevision||hash(c.businessContext??"")!==job.contextHash||!['draft','review_ready','approved','paused'].includes(c.state))errorCode="approval_stale";
   const request={requestId:job.id,context:c.businessContext??"",scope:await scope(tx,job.snapshotId)},quote=this.model.quote(request);
   if(!errorCode){if(!this.model.enabled)errorCode="model_disabled";else if(!c.budgetCents)errorCode="planning_budget_missing";else if(quote===null||!Number.isSafeInteger(quote)||quote<1)errorCode="cost_unknown";else if(c.reservedCents+c.spentCents+BigInt(quote)>c.budgetCents)errorCode="budget_conflict";}
   if(errorCode){await tx.prospectCampaignPlanningJob.update({where:{id:job.id},data:{state:"blocked",errorCode}});return null;}
   const leaseToken=randomUUID();await tx.prospectCampaignPlanningJob.update({where:{id:job.id},data:{state:"processing",mode:"model",reservedCents:quote!,leaseToken,leaseExpiresAt:new Date(Date.now()+60000)}});await tx.prospectCampaign.update({where:{id:c.id},data:{reservedCents:{increment:quote!}}});return {request,quote:quote!,leaseToken};
  });
  if(!claim)return null;
  let criteria:unknown,unknown=false,errorCode:string|null=null;
  try{criteria=validatePlanningCriteria(await this.model.interpret(claim.request),claim.request.scope);}catch(e){if(e instanceof Error&&e.message==="context_scope_unsupported")errorCode=e.message;else {unknown=true;errorCode="planning_outcome_unknown";}}
  return this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${candidate.campaignId} FOR UPDATE`;
   const job=await tx.prospectCampaignPlanningJob.findUniqueOrThrow({where:{id:candidate.id}});if(job.state!=="processing"||job.leaseToken!==claim.leaseToken)return project(job);
   const c=await tx.prospectCampaign.findUniqueOrThrow({where:{id:job.campaignId}});if(c.revision!==job.expectedRevision&&!unknown)errorCode="approval_stale";
   if(!unknown)await tx.prospectCampaign.update({where:{id:c.id},data:{reservedCents:{decrement:claim.quote},spentCents:{increment:claim.quote},...(!errorCode?{...draftInvalidation,revision:{increment:1},audienceCriteria:JSON.parse(JSON.stringify(criteria)),directorySnapshotId:job.snapshotId,planningMode:"model"}:{})}});
   const final=await tx.prospectCampaignPlanningJob.update({where:{id:job.id},data:{state:unknown?"outcome_unknown":errorCode?"failed":"completed",errorCode,criteria:criteria?JSON.parse(JSON.stringify(criteria)):Prisma.DbNull,reservedCents:unknown?claim.quote:0,spentCents:unknown?0:claim.quote,leaseToken:null,leaseExpiresAt:null}});return project(final);
  });
 }
}
