import {Prisma,type PrismaClient,type ProspectCampaign} from "@prisma/client";
import type {ChangeCampaignCompanies,CampaignCompanyPage,CampaignCompanyReference,CompanyFilters} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import type {CampaignDraftAudienceStore} from "../../application/campaigns/campaign-draft-audience.js";
import {appendDraftCompanies,draftInvalidation,lockDraft,projectDraft,sourceCompanies,type DraftTx} from "./prisma-campaign-drafts.js";
import {prospectAudit,prospectCommand} from "../crm/prospect-command.js";
import {directorySelectionSql} from "../company-directory/directory-search.sql.js";
import {resolveDirectoryStorage} from "../company-directory/directory-storage.js";
import {validateCompanyFilters} from "../../domain/company-directory/company-filters.js";
export async function draftAudienceSql(tx:DraftTx,c:ProspectCampaign){
 if(!c.directorySnapshotId)throw Error("snapshot_unavailable");
 const storage=await resolveDirectoryStorage(tx,c.directorySnapshotId);
 const [{missing}]=await tx.$queryRaw<{missing:bigint}[]>`SELECT count(*) AS missing FROM prospect_campaign_companies m WHERE m.campaign_id=${c.id} AND m.removed_at IS NULL AND (m.snapshot_id<>${c.directorySnapshotId} OR NOT EXISTS(SELECT 1 FROM company_directory.company_establishments e WHERE e.snapshot_id=${storage.storageSnapshotId} AND e.cnpj=m.cnpj ${storage.maximumCnpj?Prisma.sql`AND e.cnpj COLLATE "C"<=${storage.maximumCnpj}`:Prisma.empty}))`;
 if(missing)throw Error("company_not_found");
 const base=directorySelectionSql(storage.storageSnapshotId,{},storage.maximumCnpj);
 const criteria=c.audienceCriteria?validateCompanyFilters(c.audienceCriteria):null;
 const contextual=criteria?directorySelectionSql(storage.storageSnapshotId,criteria,storage.maximumCnpj).where:null;
 const join=Prisma.sql(base.join.strings,...base.join.values),scope=Prisma.sql(base.where.strings,...base.where.values);
 const manual=Prisma.sql`EXISTS(SELECT 1 FROM prospect_campaign_companies m WHERE m.campaign_id=${c.id} AND m.cnpj=e.cnpj AND m.snapshot_id=${c.directorySnapshotId} AND m.removed_at IS NULL)`;
 // Keep manual membership as a top-level EXISTS so PostgreSQL can use an indexed semijoin.
 const included=contextual?Prisma.sql`(${manual} OR ${Prisma.sql(contextual.strings,...contextual.values)})`:manual;
 const where=Prisma.sql`${scope} AND NOT EXISTS(SELECT 1 FROM prospect_campaign_companies excluded WHERE excluded.campaign_id=${c.id} AND excluded.cnpj=e.cnpj AND excluded.removed_at IS NOT NULL) AND ${included}`;
 return {join,where,storage,criteria};
}
export class PrismaCampaignDraftAudience implements CampaignDraftAudienceStore {
 constructor(private readonly db:PrismaClient){}
 change(id:string,cmd:ChangeCampaignCompanies,actor:ProspectingActor,remove:boolean){return prospectCommand(this.db,remove?"campaign.companies.remove":"campaign.companies.append",{...cmd,id},actor,async tx=>{
  const c=await lockDraft(tx,id,cmd.expectedRevision);if(c.directorySnapshotId&&c.directorySnapshotId!==cmd.snapshotId)throw Error("snapshot_conflict");
  let counts={added:0,existing:0,removed:0};
  if(remove){
   for(const row of await sourceCompanies(tx,cmd.snapshotId,cmd.cnpjs)){
    const key={campaignId:id,cnpj:row.cnpj},existing=await tx.prospectCampaignCompany.findUnique({where:{campaignId_cnpj:key}});
    if(existing?.removedAt)continue;
    if(existing)await tx.prospectCampaignCompany.update({where:{campaignId_cnpj:key},data:{removedAt:new Date()}});
    else await tx.prospectCampaignCompany.create({data:{...key,snapshotId:cmd.snapshotId,publicSnapshot:row,addedBy:actor.operatorId,removedAt:new Date()}});
    counts.removed++;
   }
  }
  else counts={...counts,...await appendDraftCompanies(tx,c,cmd.snapshotId,cmd.cnpjs,actor)};
  const updated=await tx.prospectCampaign.update({where:{id},data:{...draftInvalidation,directorySnapshotId:cmd.snapshotId,revision:{increment:1}}});
  await prospectAudit(tx,actor,remove?"campaign.companies.remove":"campaign.companies.append","campaign",id,updated.revision,{...counts,cnpjs:cmd.cnpjs,snapshotId:cmd.snapshotId});
  return {result:{campaign:await projectDraft(tx,updated),...counts},resourceIds:[id]};});}
 list(id:string,after?:string):Promise<CampaignCompanyPage>{return this.db.$transaction(async tx=>{
  const c=await tx.prospectCampaign.findUnique({where:{id}});if(!c||c.setupVersion!==2)throw Error("campaign_not_found");const manualCount=await tx.prospectCampaignCompany.count({where:{campaignId:id,removedAt:null}});
  if(!c.directorySnapshotId)return {items:[],nextCursor:null,count:0,manualCount,criteria:null,snapshotId:null};
  const {join,where,storage,criteria}=await draftAudienceSql(tx,c);
  const [{count}]=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) AS count ${join} WHERE ${where}`;
  const rows=await tx.$queryRaw<Omit<CampaignCompanyReference,"snapshotId"|"competence"|"addedAt">[]>`SELECT e.cnpj,c.legal_name AS "legalName",e.trade_name AS "tradeName",e.main_cnae AS "mainCnae",e.city_code AS "cityCode",e.uf ${join} WHERE ${where} ${after?Prisma.sql`AND e.cnpj COLLATE "C">${after}`:Prisma.empty} ORDER BY e.cnpj COLLATE "C" LIMIT 21`;
  return {items:rows.slice(0,20).map(row=>({...row,snapshotId:c.directorySnapshotId!,competence:storage.snapshot.competence,addedAt:null})),nextCursor:rows.length>20?rows[19].cnpj:null,count:Number(count),manualCount,criteria,snapshotId:c.directorySnapshotId};
 },{isolationLevel:"RepeatableRead"});}
}
