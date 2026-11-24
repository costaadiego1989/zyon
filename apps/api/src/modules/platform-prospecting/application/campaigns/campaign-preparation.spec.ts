import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {campaignContentHash} from "../../domain/campaigns/prospecting-campaign.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
test("CAMP-05 review preserves legacy hash bytes while V2 context and offer policy change reviewed content identity",()=>{
 const legacy={message:"reviewed",offer:{planKey:"growth"},senderBindingId:"sender",senderVersion:1,template:{id:"body"},audienceHash:"members",sendWindow:{start:"09:00"},limits:{dailyRecipients:1}};
 assert.equal(campaignContentHash(legacy),createHash("sha256").update(stableDirectoryJson(legacy)).digest("hex"));assert.equal(campaignContentHash({...legacy,setupVersion:1,businessContext:"ignored legacy"}),campaignContentHash(legacy));
 const v2={...legacy,setupVersion:2,businessContext:"roupas SP",offerPolicy:{mode:"catalog"}};assert.notEqual(campaignContentHash(v2),campaignContentHash(legacy));assert.notEqual(campaignContentHash({...v2,businessContext:"roupas RJ"}),campaignContentHash(v2));assert.notEqual(campaignContentHash({...v2,offerPolicy:{mode:"fixed",planKey:"growth"}}),campaignContentHash(v2));
});

import {createCampaignFixture,fixtureOffer,fixtureTemplate,fixtureWindow} from "../../../../../tests/prospect-campaign-fixture.js";
import {CampaignDraftService} from "./campaign-drafts.js";
import {PrismaCampaignDrafts} from "../../infrastructure/campaigns/prisma-campaign-drafts.js";
import {PrismaAudienceRepository} from "../../infrastructure/campaigns/prisma-audience.repository.js";
import {PrismaCampaignPreparation} from "../../infrastructure/campaigns/prisma-campaign-preparation.js";
import {CampaignExecutionIdentity,CampaignPreparation} from "./campaign-preparation.js";
import {PrismaCampaignCommands} from "../../infrastructure/campaigns/prisma-campaign-commands.js";
import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import {ProspectDispatchWorker} from "./prospect-dispatch.worker.js";
const actor={operatorId:"operator",correlationId:"prepare"};
const limits={dailyRecipients:2,budget:{amountCents:100,currency:"BRL"}};
test("CAMP-06 prepare durably connects the union and registered template to catalog approval start pause resume and actual guarded dispatch",async()=>{
 const f=await createCampaignFixture();try{
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));
  const c=await drafts.create({name:"Context campaign",businessContext:"lojas de roupas em SP",companies:{snapshotId:"search-old",cnpjs:[f.lead.cnpj]},clientRequestId:"v2"},actor);
  const configured=await drafts.edit(c.id,{expectedRevision:c.revision,senderBindingId:"sender",senderVersion:1,limits,sendWindow:fixtureWindow,clientRequestId:"config"},actor);
  let knowledge="publication-1";const offers={current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true};
  const identity=new CampaignExecutionIdentity(offers,async()=>({knowledge,model:"controlled-test",quote:25}));
  const audience=new PrismaAudienceRepository(f.prisma,f.keys);
  const preparation=new CampaignPreparation(new PrismaCampaignPreparation(f.prisma,{compatible:async()=>fixtureTemplate},identity,audience));
  const cmd={expectedRevision:configured.revision,clientRequestId:"p".repeat(160)};
  const job=await preparation.prepare(c.id,cmd,actor);assert.equal(job.state,"pending");assert.deepEqual(await preparation.prepare(c.id,cmd,actor),job);
  assert.equal(await f.prisma.prospectCommand.count({where:{kind:"campaign.prepare"}}),1);
  while((await audience.poll(job.selectionId))?.state!=="complete")await audience.processNext(1);
  const ready=await drafts.find(c.id);assert.equal(ready.state,"review_ready");assert.equal(ready.offer,null);assert.equal(ready.message,fixtureTemplate.previewText);assert.equal(ready.recipientCount,1);
  const commands=new PrismaCampaignCommands(f.prisma,offers,async()=>[],identity.current.bind(identity));
  const approval={expectedRevision:ready.revision,audienceHash:ready.audienceHash!,contentHash:ready.contentHash!,clientRequestId:"approve-v2"};
  knowledge="withdrawn";await assert.rejects(commands.approve(c.id,approval,actor),/approval_stale/);knowledge="publication-1";
  const approved=await commands.approve(c.id,approval,actor);assert.equal(approved.state,"approved");assert.equal(approved.offer,null);
  await commands.changeState(c.id,{expectedRevision:ready.revision,action:"start",clientRequestId:"start-v2"},actor);
  await commands.changeState(c.id,{expectedRevision:ready.revision,action:"pause",clientRequestId:"pause-v2"},actor);
  knowledge="changed";await assert.rejects(commands.changeState(c.id,{expectedRevision:ready.revision,action:"resume",clientRequestId:"stale-resume"},actor),/approval_stale/);knowledge="publication-1";
  await commands.changeState(c.id,{expectedRevision:ready.revision,action:"resume",clientRequestId:"resume-v2"},actor);
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);const recipient=await f.prisma.campaignRecipient.findFirstOrThrow({where:{campaignId:c.id}});
  const {SenderReadinessService}=await import("./sender-readiness.service.js");
  const binding=(await repo.dispatchReview(c.id))!.binding;
  const health=new SenderReadinessService({credential:async()=>({binding,accessToken:"capture-only",businessId:"fixture"}),save:async()=>true,permission:async()=>"opted_in"},{read:async()=>({templates:[fixtureTemplate],portfolioLimit:100,portfolioTier:"fixture",blockers:[],entities:[]})});
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{health:{binding,status:"ready",templates:[fixtureTemplate],blockers:[]}}});
  let calls=0;const worker=new ProspectDispatchWorker(repo,health,offers,{send:async()=>{calls++;return {state:"provider_accepted",providerMessageId:"captured-only",acceptedAt:new Date()};}},()=>new Date("2026-11-23T15:00:00Z"),identity.current.bind(identity));
  knowledge="changed";assert.deepEqual(await worker.processRecipient(recipient.id),{blocked:"approval_stale"});assert.equal(calls,0);knowledge="publication-1";
  const sent=await worker.processRecipient(recipient.id);assert.equal('state' in sent&&sent.state,"provider_accepted");assert.equal(calls,1);assert.equal(await f.prisma.outreachAttempt.count({where:{recipientId:recipient.id}}),1);
  await worker.processRecipient(recipient.id);assert.equal(calls,1);
  const count=await f.prisma.campaignRecipient.count({where:{campaignId:c.id}});
  await assert.rejects(drafts.edit(c.id,{expectedRevision:ready.revision,businessContext:"other",clientRequestId:"after-attempt"},actor),/campaign_state_conflict/);assert.equal(await f.prisma.campaignRecipient.count({where:{campaignId:c.id}}),count);
 }finally{await f.close();}
});
test("CAMP-05 review incomplete V2 setup cannot attach arbitrary message or reuse approval after context audience sender message offer and limit changes",async()=>{
 const f=await createCampaignFixture();try{
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));const offers={current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true};
  const identity=new CampaignExecutionIdentity(offers,async()=>({knowledge:"published"}));const audience=new PrismaAudienceRepository(f.prisma,f.keys);
  const prepare=new CampaignPreparation(new PrismaCampaignPreparation(f.prisma,{compatible:async()=>fixtureTemplate},identity,audience));
  const c=await drafts.create({name:"Incomplete",clientRequestId:"empty"},actor);await assert.rejects(prepare.prepare(c.id,{expectedRevision:1,clientRequestId:"empty-prepare"},actor),/limits_missing/);
  assert.equal((await f.pg.query("SELECT count(*)::int AS count FROM prospect_audience_jobs")).rows[0].count,0);
  for(const [index,change] of [{businessContext:"other"},{message:"other"},{offerPolicy:{mode:"fixed",planKey:"growth"}},{limits},{senderBindingId:"sender",senderVersion:1}].entries()){
   const draft=await drafts.create({name:"Invalidation",clientRequestId:"invalidate-"+index},actor);
   await f.prisma.prospectCampaign.update({where:{id:draft.id},data:{state:"approved",approvedRevision:1,approvedHash:"previous",audienceHash:"old"}});
   const edited=await drafts.edit(draft.id,{...change,expectedRevision:1,clientRequestId:"change-"+index} as any,actor);assert.equal(edited.approvedRevision,null);assert.equal(edited.state,"draft");assert.equal(edited.audienceHash,null);
  }
  assert.equal(await f.prisma.outreachAttempt.count(),0);
 }finally{await f.close();}
});
