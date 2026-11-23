import { createHash,randomUUID } from "node:crypto";
import { Prisma,type PrismaClient } from "@prisma/client";
import type { CompanyFilters, ContactPermissionStatus, FreezeCampaignAudience, ProspectAudienceJob, ProspectingBlocker } from "@zyon/shared-types";
import type { CampaignAudienceStore } from "../../application/campaigns/freeze-campaign-audience.js";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
import { canonicalCnpj } from "../../domain/company-directory/cnpj.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";
import { validateCompanyFilters } from "../../domain/company-directory/company-filters.js";
import { contactPermission, normalizeContactIdentity, sequenceIdentity } from "../../domain/crm/prospect-contact.js";
import { directorySelectionSql } from "../company-directory/directory-search.sql.js";
import {resolveDirectoryStorage} from "../company-directory/directory-storage.js";
import { protectedContactLookups,type SuppressionKeyRing } from "../crm/prisma-prospect-privacy.repository.js";
import { prospectAudit,prospectCommand } from "../crm/prospect-command.js";
import {draftAudienceSql} from "./prisma-campaign-draft-audience.js";

type Tx=Prisma.TransactionClient;
type Job={id:string; campaign_id:string; snapshot_id:string; filters:CompanyFilters; explicit_cnpjs:string[]|null; state:ProspectAudienceJob["state"]; hash:string; cursor_cnpj:string|null; company_count:number; recipient_count:number; missing_endpoint_count:number; error_code:string|null};
const hash=(input:string)=>createHash("sha256").update(input).digest("hex");
const project=(j:Job):ProspectAudienceJob=>({selectionId:j.id,campaignId:j.campaign_id,state:j.state,companyCount:j.company_count,recipientCount:j.recipient_count,missingEndpointCount:j.missing_endpoint_count,audienceHash:j.state==="complete"?j.hash:null,errorCode:j.error_code});
async function readJob(tx:Tx,id:string):Promise<ProspectAudienceJob|null>{
  const [job]=await tx.$queryRaw<Job[]>`SELECT * FROM prospect_audience_jobs WHERE id=${id}`;
  if(!job)return null;
  const result=project(job);
  if(job.state==="complete"){
    result.eligibilityBlockers=await tx.$queryRaw<{reason:ProspectingBlocker;recipients:number}[]>`SELECT b.reason,count(*)::int AS recipients
      FROM prospect_campaigns c JOIN campaign_recipients r ON r.campaign_id=c.id
      CROSS JOIN LATERAL jsonb_array_elements_text(r.blockers) AS b(reason)
      WHERE c.id=${job.campaign_id} AND c.selection_id=${id} GROUP BY b.reason ORDER BY b.reason`;
  }
  return result;
}

export class PrismaAudienceRepository implements CampaignAudienceStore {
  constructor(private readonly prisma:PrismaClient,private readonly keys:SuppressionKeyRing){}
  poll(id:string){return readJob(this.prisma,id);}
  enqueue(id:string,cmd:FreezeCampaignAudience,actor:ProspectingActor) {
    return this.enqueueSelection(id,cmd,actor,false);
  }
  enqueueDraft(id:string,cmd:{clientRequestId:string;expectedRevision:number},actor:ProspectingActor){
    return this.enqueueSelection(id,{...cmd,snapshotId:""},actor,true);
  }
  private enqueueSelection(id:string,cmd:FreezeCampaignAudience,actor:ProspectingActor,draft:boolean) {
    return prospectCommand(this.prisma,draft?"campaign.draft.freeze":"campaign.freeze",{...cmd,id},actor,async tx=>{
      await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${id} FOR UPDATE`;
      const c=await tx.prospectCampaign.findUnique({where:{id}});
      if(!c)throw new Error("campaign_not_found");
      if(c.revision!==cmd.expectedRevision)throw new Error("version_conflict");
      if(!["draft","review_ready","approved"].includes(c.state)||await tx.outreachAttempt.count({where:{recipient:{campaignId:id}}}))throw new Error("campaign_state_conflict");
      const sender=await tx.platformProspectSenderBinding.findFirst({where:{id:c.senderBindingId??"",active:true,scope:"zyon_platform",version:c.senderVersion??0}});
      if(!sender)throw new Error("sender_identity_mismatch");
      const snapshotId=draft?c.directorySnapshotId:cmd.snapshotId;
      if(!snapshotId||draft&&c.setupVersion!==2)throw Error("snapshot_unavailable");
      const storage=await resolveDirectoryStorage(tx,snapshotId);
      const segment=cmd.segmentId?await tx.savedProspectSegment.findFirst({where:{id:cmd.segmentId,deletedAt:null}}):null;
      if(cmd.segmentId&&(!segment||segment.version!==cmd.segmentVersion||segment.filterVersion!==1))throw new Error("version_conflict");
      const filters=validateCompanyFilters(draft?(c.audienceCriteria??{}):(segment?.filterJson??{}));
      const explicit=cmd.cnpjs?[...new Set(cmd.cnpjs.map(canonicalCnpj))].sort():null;
      if(explicit){
        const [{count}]=await tx.$queryRaw<{count:bigint}[]>`SELECT count(*) FROM company_directory.company_establishments WHERE snapshot_id=${storage.storageSnapshotId} AND cnpj IN (${Prisma.join(explicit)}) ${storage.maximumCnpj?Prisma.sql`AND cnpj COLLATE "C"<=${storage.maximumCnpj}`:Prisma.empty}`;
        if(Number(count)!==explicit.length)throw new Error("company_not_found");
      }
      const selectionId=randomUUID();
      const changed=await tx.prospectCampaign.updateMany({where:{id,revision:cmd.expectedRevision,state:c.state},data:{revision:{increment:1},state:"freezing",selectionId,segmentId:cmd.segmentId??null,segmentVersion:segment?.version??null,filterSnapshot:JSON.parse(JSON.stringify(filters)),approvedRevision:null,approvedBy:null,approvedAt:null,approvedHash:null,contentHash:null,audienceHash:null,recipientCount:0}});
      if(!changed.count)throw new Error("version_conflict");
      await tx.campaignRecipient.deleteMany({where:{campaignId:id}});
      const seed=hash(stableDirectoryJson({snapshotId,filters,filterVersion:segment?.filterVersion??1,segmentVersion:segment?.version??null,...(draft?{setupVersion:2,revision:c.revision}: {})}));
      await tx.$executeRaw`INSERT INTO prospect_audience_jobs(id,campaign_id,snapshot_id,segment_version,filter_version,filters,explicit_cnpjs,hash)
        VALUES (${selectionId},${id},${snapshotId},${segment?.version??null},1,${JSON.stringify(filters)}::jsonb,${explicit}::text[],${seed})`;
      await prospectAudit(tx,actor,"campaign.freeze","campaign",id,c.revision+1);
      return {result:(await readJob(tx,selectionId))!,resourceIds:[id,selectionId]};
    });
  }
  processNext(size:number){
    // Each claim, cursor and its outputs commit together. A dead worker releases its row lock.
    return this.prisma.$transaction(async tx=>{
      const [job]=await tx.$queryRaw<Job[]>`SELECT * FROM prospect_audience_jobs WHERE state IN ('pending','processing') ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if(!job)return null;
      const c=await tx.prospectCampaign.findUniqueOrThrow({where:{id:job.campaign_id}});
      if(c.selectionId!==job.id||c.state!=="freezing"||!await tx.platformProspectSenderBinding.findFirst({where:{id:c.senderBindingId??"",active:true,version:c.senderVersion??0,scope:"zyon_platform"}})){
        await tx.$executeRaw`UPDATE prospect_audience_jobs SET state='failed',error_code='approval_stale' WHERE id=${job.id}`;
        await tx.prospectCampaign.updateMany({where:{id:c.id,selectionId:job.id,state:"freezing"},data:{state:"draft",blockers:["approval_stale"]}});
        return readJob(tx,job.id);
      }
      const storage=await resolveDirectoryStorage(tx,job.snapshot_id);
      if(job.state==="pending"){
       if(c.setupVersion===2){
        const {join,where}=await draftAudienceSql(tx,c);
        await tx.$executeRaw`INSERT INTO prospect_audience_members(selection_id,cnpj) SELECT ${job.id},e.cnpj ${join} WHERE ${where}`;
       }else{
        const {join,where}=directorySelectionSql(storage.storageSnapshotId,job.filters,storage.maximumCnpj);
        // One MVCC statement fixes every matching CRM/directory member before bounded application work.
        await tx.$executeRaw`INSERT INTO prospect_audience_members(selection_id,cnpj) SELECT ${job.id},e.cnpj ${Prisma.sql(join.strings,...join.values)} WHERE ${Prisma.sql(where.strings,...where.values)} ${job.explicit_cnpjs?Prisma.sql`AND e.cnpj IN (${Prisma.join(job.explicit_cnpjs)})`:Prisma.empty}`;
       }
      }
      const members=await tx.$queryRaw<{cnpj:string}[]>`SELECT cnpj FROM prospect_audience_members WHERE selection_id=${job.id} AND cnpj>${job.cursor_cnpj??""} ORDER BY cnpj LIMIT ${size+1}`;
      const batch=members.slice(0,size); let digest=job.hash,created=0,missing=0;
      for(const {cnpj} of batch){
        if(storage.maximumCnpj&&cnpj>storage.maximumCnpj)throw new Error("company_not_found");
        const member=await this.materializeMember(tx,job,cnpj,c.senderBindingId!,storage.storageSnapshotId);
        created+=member.created; if(!member.ids.length)missing++;
        digest=hash(stableDirectoryJson([digest,cnpj,member.ids]));
      }
      const finished=members.length<=size;
      await tx.$executeRaw`UPDATE prospect_audience_jobs SET state=${finished?"complete":"processing"},cursor_cnpj=${batch.at(-1)?.cnpj??job.cursor_cnpj},hash=${digest},company_count=company_count+${batch.length},missing_endpoint_count=missing_endpoint_count+${missing},recipient_count=recipient_count+${created} WHERE id=${job.id}`;
      if(finished)await tx.prospectCampaign.update({where:{id:c.id},data:{state:"review_ready",recipientCount:job.recipient_count+created,audienceHash:digest}});
      return readJob(tx,job.id);
    },{timeout:120_000});
  }
  private async materializeMember(tx:Tx,job:Job,cnpj:string,senderBindingId:string,storageSnapshotId:string){
    const reference=await tx.platformProspect.upsert({where:{cnpj},create:{cnpj,sourceSnapshotId:job.snapshot_id},update:{}});
    await tx.$queryRaw`SELECT id FROM platform_prospects WHERE id=${reference.id} FOR UPDATE`;
    const lead=await tx.platformProspect.findUniqueOrThrow({where:{id:reference.id}});
    if(lead.piiDiscardedAt || lead.stage==="do_not_contact"){
      await tx.$executeRaw`UPDATE prospect_audience_members SET prospect_id=${lead.id} WHERE selection_id=${job.id} AND cnpj=${cnpj}`;
      return {ids:[] as string[],created:0};
    }
    const phones=await tx.$queryRaw<{value:string}[]>`SELECT COALESCE(normalized_value,original_value) AS value FROM company_directory.company_public_contacts WHERE snapshot_id=${storageSnapshotId} AND cnpj=${cnpj} AND channel='phone' ORDER BY original_value`;
    const candidates=phones.flatMap(phone=>{
      try{return [normalizeContactIdentity({kind:"phone",value:phone.value})];}catch{return [];}
    });
    const hashes=candidates.flatMap(i=>protectedContactLookups(i,this.keys).map(k=>k.protectedLookup));
    // Acquire both bound and shared directory endpoints together in the privacy repository's lock order.
    await tx.$queryRaw`SELECT ep.id FROM prospect_endpoints ep WHERE ep.sender_binding_id=${senderBindingId}
      AND (EXISTS(SELECT 1 FROM prospect_contact_bindings b WHERE b.prospect_id=${lead.id} AND b.endpoint_id=ep.id)
      OR ep.protected_lookup=ANY(${hashes}::text[])) ORDER BY ep.id FOR UPDATE`;
    const existing=await tx.prospectContactBinding.findMany({where:{prospectId:lead.id,endpoint:{senderBindingId,channel:"whatsapp",normalizedValue:{not:null}}},include:{endpoint:true}});
    const endpoints=new Map(existing.map(b=>[b.endpointId,b.endpoint]));
    for(const identity of candidates){
        const versions=await tx.contactSuppression.findMany({where:{senderScope:{in:["zyon_platform",senderBindingId]}},distinct:["keyVersion"],select:{keyVersion:true}});
        if(versions.some(v=>!this.keys.keys[v.keyVersion]))throw new Error("suppression_key_version_unavailable");
        const lookups=protectedContactLookups(identity,this.keys);
        const blocked=await tx.contactSuppression.findFirst({where:{senderScope:{in:["zyon_platform",senderBindingId]},OR:lookups}});
        if(blocked)continue;
        const current=lookups.find(k=>k.keyVersion===this.keys.currentVersion)!;
        const key={senderBindingId,channel:"whatsapp",...current};
        const endpoint=await tx.prospectEndpoint.findFirst({where:{senderBindingId,channel:"whatsapp",OR:lookups}})??await tx.prospectEndpoint.upsert({where:{senderBindingId_channel_protectedLookup_keyVersion:key},create:{...key,normalizedValue:identity.value,identityKind:"phone"},update:{}});
        if(!endpoint.normalizedValue)continue;
        await tx.prospectContactBinding.upsert({where:{prospectId_endpointId:{prospectId:lead.id,endpointId:endpoint.id}},create:{prospectId:lead.id,endpointId:endpoint.id},update:{}});
        endpoints.set(endpoint.id,endpoint);
    }
    const ids=[...endpoints.keys()].sort(); let created=0;
    for(const id of ids){
      const ep=endpoints.get(id)!;
      const scope={senderBindingId,endpointId:id,purpose:"zyon_sales"};
      const receipts=await tx.contactPermissionReceipt.findMany({where:scope});
      const eligibility=contactPermission(scope,receipts.map(r=>({...r,status:r.status as ContactPermissionStatus})));
      const blockers:ProspectingBlocker[]=eligibility==="opted_in"?[]:["no_opt_in","provider_policy_blocked"];
      if(lead.stage==="do_not_contact"||lead.piiDiscardedAt)blockers.push("suppressed");
      const sequenceKey=sequenceIdentity(senderBindingId,normalizeContactIdentity({kind:ep.identityKind==="bsuid"?"bsuid":"phone",value:ep.normalizedValue!,businessScope:ep.businessScope}));
      const result=await tx.campaignRecipient.createMany({data:[{campaignId:job.campaign_id,prospectId:lead.id,endpointId:id,sequenceKey,eligibility,blockers,state:blockers.length?"blocked":"pending",frozenSnapshot:{snapshotId:job.snapshot_id,cnpj}}],skipDuplicates:true});
      created+=result.count;
    }
    await tx.$executeRaw`UPDATE prospect_audience_members SET prospect_id=${lead.id},endpoint_ids=${ids}::text[] WHERE selection_id=${job.id} AND cnpj=${cnpj}`;
    return {ids,created};
  }
}
