import {Prisma,type PrismaClient,type ProspectCampaign} from "@prisma/client";
import type {CreateProspectCampaignDraft,EditProspectCampaignDraft,ProspectCampaignDraft,CampaignCompanyReference} from "@zyon/shared-types";
import type {CampaignDraftStore} from "../../application/campaigns/campaign-drafts.js";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {prospectAudit,prospectCommand} from "../crm/prospect-command.js";
import {resolveDirectoryStorage} from "../company-directory/directory-storage.js";
import {campaignContentHash} from "../../domain/campaigns/prospecting-campaign.js";
import {storedReview} from "./prisma-campaign.repository.js";
export type DraftTx=Prisma.TransactionClient;
export const draftInvalidation={state:"draft",audienceHash:null,contentHash:null,selectionId:null,approvedRevision:null,approvedHash:null,approvedBy:null,approvedAt:null};
export async function lockDraft(tx:DraftTx,id:string,revision:number){
 await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${id} FOR UPDATE`;
 const c=await tx.prospectCampaign.findUnique({where:{id}});if(!c||c.setupVersion!==2)throw Error("campaign_not_found");if(c.revision!==revision)throw Error("version_conflict");
 if(!["draft","review_ready","approved","paused"].includes(c.state)||await tx.outreachAttempt.count({where:{recipient:{campaignId:id}}}))throw Error("campaign_state_conflict");return c;
}
export async function projectDraft(tx:DraftTx,c:ProspectCampaign):Promise<ProspectCampaignDraft>{
 const review=storedReview(c);
 return {id:c.id,name:c.name,revision:c.revision,state:c.state as ProspectCampaignDraft["state"],setupVersion:2,businessContext:c.businessContext,offerPolicy:c.offerPolicy as unknown as ProspectCampaignDraft["offerPolicy"],message:c.message,offer:c.offerSnapshot as unknown as ProspectCampaignDraft["offer"],senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template as unknown as ProspectCampaignDraft["template"],limits:review.limits,sendWindow:c.sendWindow as unknown as ProspectCampaignDraft["sendWindow"],audienceHash:c.audienceHash,contentHash:campaignContentHash(review),selectionId:c.selectionId,approvedRevision:c.approvedRevision,approvedBy:c.approvedBy,approvedAt:c.approvedAt?.toISOString()??null,blockers:c.blockers as ProspectCampaignDraft["blockers"],recipientCount:c.recipientCount,reservedCents:Number(c.reservedCents),spentCents:Number(c.spentCents),createdAt:c.createdAt.toISOString(),updatedAt:c.updatedAt.toISOString(),directorySnapshotId:c.directorySnapshotId,audienceCriteria:c.audienceCriteria as ProspectCampaignDraft["audienceCriteria"],planningMode:c.planningMode as ProspectCampaignDraft["planningMode"],manualCompanyCount:await tx.prospectCampaignCompany.count({where:{campaignId:c.id,removedAt:null}})};
}
export async function sourceCompanies(tx:DraftTx,snapshotId:string,cnpjs:string[]){
 const storage=await resolveDirectoryStorage(tx,snapshotId);
 const rows=await tx.$queryRaw<Omit<CampaignCompanyReference,"snapshotId"|"competence"|"addedAt">[]>`SELECT e.cnpj,c.legal_name AS "legalName",e.trade_name AS "tradeName",e.main_cnae AS "mainCnae",e.city_code AS "cityCode",e.uf FROM company_directory.company_establishments e JOIN company_directory.company_entities c ON c.snapshot_id=e.snapshot_id AND c.base_cnpj=e.base_cnpj WHERE e.snapshot_id=${storage.storageSnapshotId} AND e.cnpj IN (${Prisma.join(cnpjs)}) ${storage.maximumCnpj?Prisma.sql`AND e.cnpj COLLATE "C"<=${storage.maximumCnpj}`:Prisma.empty}`;
 if(rows.length!==cnpjs.length)throw Error("company_not_found");return rows.map(row=>({...row,snapshotId,competence:storage.snapshot.competence}));
}
export async function appendDraftCompanies(tx:DraftTx,c:ProspectCampaign,snapshotId:string,cnpjs:string[],actor:ProspectingActor){
 if(c.directorySnapshotId&&c.directorySnapshotId!==snapshotId)throw Error("snapshot_conflict");
 const rows=await sourceCompanies(tx,snapshotId,cnpjs);let added=0;
 for(const row of rows){const key={campaignId:c.id,cnpj:row.cnpj};const existing=await tx.prospectCampaignCompany.findUnique({where:{campaignId_cnpj:key}});
  if(existing){if(existing.snapshotId!==snapshotId)throw Error("snapshot_conflict");if(existing.removedAt){await tx.prospectCampaignCompany.update({where:{campaignId_cnpj:key},data:{removedAt:null}});added++;}}
  else {await tx.prospectCampaignCompany.create({data:{...key,snapshotId,publicSnapshot:row,addedBy:actor.operatorId}});added++;}}
 return {added,existing:rows.length-added};
}
export class PrismaCampaignDrafts implements CampaignDraftStore {
 constructor(readonly db:PrismaClient){}
 create(cmd:CreateProspectCampaignDraft,actor:ProspectingActor){return prospectCommand(this.db,"campaign.draft.create",cmd,actor,async tx=>{
  let c=await tx.prospectCampaign.create({data:{setupVersion:2,name:cmd.name.trim(),businessContext:cmd.businessContext?.trim()??null,offerPolicy:{mode:"catalog"},createdBy:actor.operatorId}});
  if(cmd.companies){await appendDraftCompanies(tx,c,cmd.companies.snapshotId,cmd.companies.cnpjs,actor);c=await tx.prospectCampaign.update({where:{id:c.id},data:{directorySnapshotId:cmd.companies.snapshotId}});}
  await prospectAudit(tx,actor,"campaign.draft.create","campaign",c.id,c.revision);return {result:await projectDraft(tx,c),resourceIds:[c.id]};});}
 edit(id:string,cmd:EditProspectCampaignDraft,actor:ProspectingActor){return prospectCommand(this.db,"campaign.draft.edit",{...cmd,id},actor,async tx=>{
  const c=await lockDraft(tx,id,cmd.expectedRevision);const data:Prisma.ProspectCampaignUpdateInput={...draftInvalidation,revision:{increment:1}};
  if(cmd.name!==undefined)data.name=cmd.name.trim();
  for(const field of ["businessContext","message"] as const)if(cmd[field]!==undefined)data[field]=cmd[field]?.trim()??null;
  if(cmd.offerPolicy)data.offerPolicy=cmd.offerPolicy;
  if(cmd.businessContext!==undefined&&cmd.businessContext!==c.businessContext){data.audienceCriteria=Prisma.DbNull;data.planningMode=null;}
  if(cmd.senderBindingId!==undefined||cmd.senderVersion!==undefined){
   const senderId=cmd.senderBindingId===undefined?c.senderBindingId:cmd.senderBindingId,version=cmd.senderVersion===undefined?c.senderVersion:cmd.senderVersion;
   if((senderId===null)!==(version===null))throw Error("invalid_command:sender");
   if(senderId&&!await tx.platformProspectSenderBinding.findFirst({where:{id:senderId,version:version!,scope:"zyon_platform",active:true}}))throw Error("sender_identity_mismatch");
   data.sender=senderId?{connect:{id:senderId}}:{disconnect:true};data.senderVersion=version;data.template=Prisma.DbNull;
  }
  if(cmd.template===null)data.template=Prisma.DbNull;
  if(cmd.limits!==undefined){if((cmd.limits?.budget.amountCents??0)<Number(c.reservedCents+c.spentCents))throw Error("budget_conflict");data.dailyRecipientLimit=cmd.limits?.dailyRecipients??null;data.budgetCents=cmd.limits?BigInt(cmd.limits.budget.amountCents):null;}
  if(cmd.sendWindow!==undefined)data.sendWindow=cmd.sendWindow?JSON.parse(JSON.stringify(cmd.sendWindow)):Prisma.DbNull;
  const updated=await tx.prospectCampaign.update({where:{id},data});await prospectAudit(tx,actor,"campaign.draft.edit","campaign",id,updated.revision);return {result:await projectDraft(tx,updated),resourceIds:[id]};});}
 find(id:string){return this.db.$transaction(async tx=>{const c=await tx.prospectCampaign.findUnique({where:{id}});if(!c||c.setupVersion!==2)throw Error("campaign_not_found");return projectDraft(tx,c);});}
 list(cursor?:string){return this.db.$transaction(async tx=>{const rows=await tx.prospectCampaign.findMany({where:{setupVersion:2,...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:"asc"},take:51});return {items:await Promise.all(rows.slice(0,50).map(c=>projectDraft(tx,c))),nextCursor:rows.length>50?rows[49].id:null};});}
}
