import {test} from "node:test";
import assert from "node:assert/strict";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {createCampaignFixture} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaCampaignDrafts} from "../../infrastructure/campaigns/prisma-campaign-drafts.js";
import {CampaignDraftService} from "./campaign-drafts.js";
import {CampaignDraftAudience} from "./campaign-draft-audience.js";
import {PrismaCampaignDraftAudience} from "../../infrastructure/campaigns/prisma-campaign-draft-audience.js";
import {PrismaAudienceRepository} from "../../infrastructure/campaigns/prisma-audience.repository.js";
import {canonicalCnpj} from "../../domain/company-directory/cnpj.js";
const actor={operatorId:"operator",correlationId:"companies"};
test("CAMP-02 append unique public companies incrementally without sender, preserving provenance, replay and removal history",async()=>{
 const f=await createProspectCrmFixture();try{
  await f.prisma.platformProspectSenderBinding.deleteMany();const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma)),audience=new CampaignDraftAudience(new PrismaCampaignDraftAudience(f.prisma));
  const c=await drafts.create({name:"Research",clientRequestId:"draft"},actor);
  const first={expectedRevision:1,snapshotId:"search-old",cnpjs:["00000000000191"],clientRequestId:"append"};const a=await audience.append(c.id,first,actor);assert.equal(a.added,1);assert.equal(a.existing,0);assert.equal(a.campaign.revision,2);assert.equal(a.campaign.senderBindingId,null);
  assert.deepEqual(await audience.append(c.id,first,actor),a);
  const b=await audience.append(c.id,{...first,expectedRevision:2,cnpjs:["00000000000191","12ABC34501DE35"],clientRequestId:"append-two"},actor);assert.equal(b.added,1);assert.equal(b.existing,1);assert.equal(b.campaign.manualCompanyCount,2);
  const page=await audience.list(c.id);assert.equal(page.count,2);assert.deepEqual(page.items.map(r=>r.cnpj),["00000000000191","12ABC34501DE35"]);assert.equal(page.items[0].snapshotId,"search-old");assert.equal(page.items[0].competence,"2026-10");assert.equal(page.items[0].legalName,"Maçã Comércio");
  await assert.rejects(audience.append(c.id,{...first,expectedRevision:3,snapshotId:"missing",clientRequestId:"bad-source"},actor),/snapshot_conflict/);
  await assert.rejects(audience.append(c.id,{...first,expectedRevision:3,cnpjs:["123"],clientRequestId:"bad-id"},actor),/invalid_cnpj/);
  await assert.rejects(audience.append(c.id,{...first,expectedRevision:2,clientRequestId:"stale"},actor),/version_conflict/);
  const original=await f.prisma.prospectCampaignCompany.findFirstOrThrow({where:{campaignId:c.id,cnpj:first.cnpjs[0]}});
  const removed=await audience.remove(c.id,{...first,expectedRevision:3,clientRequestId:"remove"},actor);assert.equal(removed.removed,1);assert.equal(removed.campaign.manualCompanyCount,1);
  const readded=await audience.append(c.id,{...first,expectedRevision:4,clientRequestId:"readd"},actor);assert.equal(readded.added,1);const persisted=await f.prisma.prospectCampaignCompany.findFirstOrThrow({where:{campaignId:c.id,cnpj:first.cnpjs[0]}});assert.deepEqual(persisted.publicSnapshot,original.publicSnapshot);assert.deepEqual(persisted.addedAt,original.addedAt);
  assert.equal(await f.prisma.prospectConversation.count(),0);assert.equal(await f.prisma.campaignRecipient.count(),0);assert.equal(await f.prisma.contactPermissionReceipt.count(),0);
 }finally{await f.close();}
});
test("CAMP-02 union preview keeps twenty rows per page without copying virtual companies into campaign members",async()=>{
 const f=await createProspectCrmFixture();try{
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma)),audience=new CampaignDraftAudience(new PrismaCampaignDraftAudience(f.prisma));
  const c=await drafts.create({name:"Pages",clientRequestId:"pages"},actor);
  for(let branch=2;branch<=22;branch++){
   const prefix="00000000"+String(branch).padStart(4,"0");let cnpj="";
   for(let suffix=0;suffix<100;suffix++){try{cnpj=canonicalCnpj(prefix+String(suffix).padStart(2,"0"));break;}catch{}}
   await f.client.companyEstablishment.create({data:{snapshotId:"search-old",cnpj,baseCnpj:"00000000",uf:"SP",mainCnae:"0111301"}});
  }
  await f.prisma.prospectCampaign.update({where:{id:c.id},data:{directorySnapshotId:"search-old",audienceCriteria:{ufs:["SP"]}}});
  const first=await audience.list(c.id);assert.equal(first.items.length,20);assert.equal(first.count,23);assert.ok(first.nextCursor);
  const second=await audience.list(c.id,first.nextCursor!);assert.equal(second.items.length,3);assert.equal(second.nextCursor,null);assert.equal(second.count,23);
  assert.equal(new Set([...first.items,...second.items].map(r=>r.cnpj)).size,23);assert.equal(await f.prisma.prospectCampaignCompany.count(),0);assert.equal(await f.prisma.campaignRecipient.count(),0);
 }finally{await f.close();}
});
test("CAMP-02 union virtual criteria/manual references count, paginate and materialize the same deduplicated immutable audience; attempts remain immutable",async()=>{
 const f=await createCampaignFixture();try{
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma)),audience=new CampaignDraftAudience(new PrismaCampaignDraftAudience(f.prisma));
  const c=await drafts.create({name:"Union",clientRequestId:"union",companies:{snapshotId:"search-old",cnpjs:["00000000000191","11222333000181"]}},actor);
  await f.prisma.prospectCampaign.update({where:{id:c.id},data:{audienceCriteria:{ufs:["SP"]},planningMode:"rules",senderBindingId:"sender",senderVersion:1}});
  const p=await audience.list(c.id);assert.equal(p.count,3);assert.equal(p.manualCount,2);assert.deepEqual(p.items.map(r=>r.cnpj),["00000000000191","11222333000181","12ABC34501DE35"]);
  const freezer=new PrismaAudienceRepository(f.prisma,f.keys);const job=await freezer.enqueueDraft(c.id,{expectedRevision:1,clientRequestId:"freeze-union"},actor);
  assert.equal(job.state,"pending");let result=job;while(result.state!=="complete")result=(await freezer.processNext(1))!;
  assert.equal(result.companyCount,3);const members=await f.pg.query("SELECT cnpj FROM prospect_audience_members WHERE selection_id=$1 ORDER BY cnpj",[job.selectionId]);assert.deepEqual(members.rows.map(r=>r.cnpj),p.items.map(r=>r.cnpj));
  assert.equal((await drafts.find(c.id)).state,"review_ready");assert.equal(await f.prisma.contactPermissionReceipt.count(),1);
  const recipient=await f.prisma.campaignRecipient.findFirstOrThrow({where:{campaignId:c.id}});const sequence=await f.prisma.prospectSequence.create({data:{senderBindingId:"sender",endpointId:recipient.endpointId}});
  await f.prisma.outreachAttempt.create({data:{sequenceId:sequence.id,recipientId:recipient.id,ordinal:0,clientRequestId:"attempt",requestHash:"review",state:"not_accepted",controlEpoch:0,senderVersion:1}});
  const latest=await drafts.find(c.id);await assert.rejects(audience.remove(c.id,{expectedRevision:latest.revision,snapshotId:"search-old",cnpjs:["00000000000191"],clientRequestId:"unsafe"},actor),/campaign_state_conflict/);
  assert.equal(await f.prisma.outreachAttempt.count(),1);assert.equal(await f.prisma.prospectCampaignCompany.count({where:{campaignId:c.id,removedAt:null}}),2);
  await f.prisma.prospectCampaign.update({where:{id:c.id},data:{state:"draft"}});await assert.rejects(freezer.enqueueDraft(c.id,{expectedRevision:latest.revision,clientRequestId:"unsafe-freeze"},actor),/campaign_state_conflict/);
  // More than a page stays virtual; the HTTP-facing service fixes page size at twenty.
  const empty=await drafts.create({name:"No source",clientRequestId:"empty"},actor);assert.deepEqual((await audience.list(empty.id)).items,[]);
 }finally{await f.close();}
});
