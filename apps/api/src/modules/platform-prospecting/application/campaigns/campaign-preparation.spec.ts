import {test} from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import vm from "node:vm";
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

// Exercise the real composition root without starting timers or external adapters.
// Capture the identity and the actual callbacks supplied to approval and dispatch.
function assembledReadinessRuntime(metaSendEnabled=false){
 const captured:any={networkCalls:0};
 const config={enabled:true,metaSendEnabled,llmRealEnabled:true,llmMaximumCostCents:17,
  suppressionKeyVersion:1,suppressionHmacKey:"a".repeat(64),cursorHmacKey:"b".repeat(64),senderEncryptionKey:"c".repeat(64)};
 const env={PROSPECTING_RUN_WORKERS:"true",PROSPECTING_PROPOSAL_SECRET:"readiness-proposal-secret-32-characters",PROSPECTING_PROPOSAL_TTL_SECONDS:"120",
  PROSPECTING_LLM_MODEL:"runtime-fixed-policy",PROSPECTING_LLM_API_KEY:"inert-test-key",PROSPECTING_LLM_INPUT_MICROCENTS_PER_TOKEN:"3",PROSPECTING_LLM_OUTPUT_MICROCENTS_PER_TOKEN:"7",
  PROSPECTING_META_TEMPLATE_COST_CENTS:"33",PROSPECTING_META_REPLY_COST_CENTS:"4",PROSPECTING_META_QUOTE_VALID_UNTIL:"2099-01-01T00:00:00Z"};
 const fixedOffer={...fixtureOffer,planKey:"scale",canonicalUrl:"https://zyon.test/scale"};
 class Inert {chatLinks(){return {};}debug(){}warn(){}send(){captured.networkCalls++;throw Error("network_forbidden");}}
 const inertDb={$disconnect:async()=>{}};const driver={verifyConnectivity:async()=>{},close:async()=>{}};
 const adapters:Record<string,unknown>={
  "./prospecting-config.js":{loadProspectingConfig:()=>config,assertSameProspectingDatabase:()=>{}},
  "@prisma/client":{PrismaClient:class {constructor(){return inertDb;}}},
  "neo4j-driver":{default:{driver:()=>driver,auth:{basic:()=>({})}}},
  "./company-directory/directory-prisma-client.js":{createDirectoryPrismaClient:()=>inertDb},
  "../../payment/public-platform-sales-offers.js":{PlatformSalesOffers:class {
   async current(plan:string){assert.equal(plan,"scale");return fixedOffer;}
   async catalog(){return [fixedOffer,fixtureOffer];}allowedUrl(){return true;}
  }},
  "../application/campaigns/campaign-preparation.js":{CampaignExecutionIdentity,CampaignPreparation:Inert},
  "./campaigns/prisma-campaign-preparation.js":{PrismaCampaignPreparation:class {constructor(_db:unknown,_templates:unknown,identity:unknown){captured.identity=identity;}}},
  "./campaigns/prisma-campaign-commands.js":{PrismaCampaignCommands:class {constructor(_db:unknown,_offers:unknown,_activation:unknown,current:unknown){captured.approvalCurrent=current;}}},
  "../application/campaigns/prospect-dispatch.worker.js":{ProspectDispatchWorker:class {constructor(_repo:unknown,_health:unknown,_offers:unknown,_sender:unknown,_clock:unknown,current:unknown){captured.dispatchCurrent=current;}}},
  "./knowledge/prisma-sales-knowledge.repository.js":{PrismaSalesKnowledgeRepository:class {async active(){return [{id:"publication-runtime",revision:19}];}}},
  "./campaigns/meta-prospecting-sender.adapter.js":{MetaProspectingSenderAdapter:{official:()=>new Inert()}}
 };
 const ts=createRequire(import.meta.url)("typescript");
 const runtimeUrl=new URL("../../infrastructure/prospecting-runtime.ts",import.meta.url);
 const compiled=ts.transpileModule(readFileSync(runtimeUrl,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{} as any};
 vm.runInNewContext(compiled,{require:(name:string)=>adapters[name]??new Proxy({},{get:()=>Inert}),module,exports:module.exports,process:{env:{}},setInterval,clearInterval,console},{filename:runtimeUrl.pathname});
 return {runtime:module.exports.createProspectingRuntime(env),captured,env};
}

test("READY AC1 actual runtime prepares a fixed-plan review with dispatch disabled and rejects expired pricing",async()=>{
 const f=assembledReadinessRuntime();try{
  const snapshot=await f.captured.identity.snapshot({mode:"fixed",planKey:"scale"});
  assert.equal(snapshot.offers.length,1);assert.equal(snapshot.offers[0].planKey,"scale");
  assert.equal(snapshot.execution.templateQuote.amountCents,33);assert.equal(snapshot.execution.replyQuote.amountCents,4);
  f.env.PROSPECTING_META_QUOTE_VALID_UNTIL="2001-01-01T00:00:00Z";
  await assert.rejects(f.captured.identity.snapshot({mode:"fixed",planKey:"scale"}),/cost_unknown/);
  assert.equal(f.captured.networkCalls,0);
 }finally{await f.runtime.onModuleDestroy();}
});

test("READY AC2 actual runtime fences both approval and dispatch callbacks until enabled with the same reviewed identity",async()=>{
 const disabled=assembledReadinessRuntime();const enabled=assembledReadinessRuntime(true);try{
  const snapshot=await disabled.captured.identity.snapshot({mode:"fixed",planKey:"scale"});
  assert.equal(await disabled.captured.approvalCurrent(snapshot),false);assert.equal(await disabled.captured.dispatchCurrent(snapshot),false);
  assert.equal(await enabled.captured.approvalCurrent(snapshot),true);assert.equal(await enabled.captured.dispatchCurrent(snapshot),true);
  assert.equal(disabled.captured.networkCalls,0);assert.equal(enabled.captured.networkCalls,0);
 }finally{await disabled.runtime.onModuleDestroy();await enabled.runtime.onModuleDestroy();}
});
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
  const frozen=await f.prisma.campaignRecipient.findMany({where:{campaignId:c.id},select:{id:true,frozenSnapshot:true}});
  await assert.rejects(audience.enqueue(c.id,{expectedRevision:ready.revision,snapshotId:"search-old",cnpjs:["11222333000181"],clientRequestId:"legacy-cannot-replace-v2-union"},actor),/invalid_command:use_campaign_draft_preparation/);
  assert.deepEqual(await drafts.find(c.id),ready);assert.deepEqual(await f.prisma.campaignRecipient.findMany({where:{campaignId:c.id},select:{id:true,frozenSnapshot:true}}),frozen);
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

test("READY AC1 commercial review can be prepared with dispatch disabled while unavailable knowledge still blocks preparation",async()=>{
 let enabled=false,available=true;
 const offers={current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true};
 const identity=new CampaignExecutionIdentity(offers,async()=>{if(!available)throw Error("knowledge_unavailable");return {knowledge:"published",model:"controlled-test",quote:25};},()=>{if(!enabled)throw Error("dispatch_disabled");});
 const snapshot=await identity.snapshot({mode:"catalog"});
 assert.deepEqual(snapshot,{mode:"catalog",offers:[fixtureOffer],execution:{knowledge:"published",model:"controlled-test",quote:25}});
 assert.equal(await identity.current(snapshot),false);
 enabled=true;assert.equal(await identity.current(snapshot),true);
 available=false;await assert.rejects(identity.snapshot({mode:"catalog"}),/knowledge_unavailable/);assert.equal(await identity.current(snapshot),false);
});

test("READY AC2 a campaign prepares without dispatch but cannot approve or submit while execution is disabled",async()=>{
 const f=await createCampaignFixture();try{
  let enabled=false;
  const offers={current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true};
  const identity=new CampaignExecutionIdentity(offers,async()=>({knowledge:"published",model:"controlled-test",quote:25}),()=>{if(!enabled)throw Error("dispatch_disabled");});
  const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));
  const c=await drafts.create({name:"Review before activation",businessContext:"lojas de roupas em SP",companies:{snapshotId:"search-old",cnpjs:[f.lead.cnpj]},clientRequestId:"offline-create"},actor);
  const configured=await drafts.edit(c.id,{expectedRevision:c.revision,senderBindingId:"sender",senderVersion:1,limits,sendWindow:fixtureWindow,clientRequestId:"offline-config"},actor);
  const audience=new PrismaAudienceRepository(f.prisma,f.keys),prepare=new CampaignPreparation(new PrismaCampaignPreparation(f.prisma,{compatible:async()=>fixtureTemplate},identity,audience));
  const job=await prepare.prepare(c.id,{expectedRevision:configured.revision,clientRequestId:"offline-prepare"},actor);
  while((await audience.poll(job.selectionId))?.state!=="complete")await audience.processNext(1);
  const ready=await drafts.find(c.id);assert.equal(ready.state,"review_ready");assert.equal(ready.recipientCount,1);assert.equal(await f.prisma.outreachAttempt.count({where:{recipient:{campaignId:c.id}}}),0);
  const commands=new PrismaCampaignCommands(f.prisma,offers,async()=>[],identity.current.bind(identity));
  const approval={expectedRevision:ready.revision,audienceHash:ready.audienceHash!,contentHash:ready.contentHash!,clientRequestId:"offline-approve"};
  await assert.rejects(commands.approve(c.id,approval,actor),/approval_stale/);assert.equal((await drafts.find(c.id)).state,"review_ready");
  enabled=true;await commands.approve(c.id,approval,actor);await commands.changeState(c.id,{expectedRevision:ready.revision,action:"start",clientRequestId:"offline-start"},actor);
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote),recipient=await f.prisma.campaignRecipient.findFirstOrThrow({where:{campaignId:c.id}});
  const binding=(await repo.dispatchReview(c.id))!.binding;
  await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{health:{binding,status:"ready",templates:[fixtureTemplate],blockers:[]}}});
  let calls=0;const health={forCampaign:async()=>[]} as any;
  const worker=new ProspectDispatchWorker(repo,health,offers,{send:async()=>{calls++;return {state:"provider_accepted",providerMessageId:"controlled-offline-test",acceptedAt:new Date()};}},()=>new Date("2026-11-23T15:00:00Z"),identity.current.bind(identity));
  enabled=false;assert.deepEqual(await worker.processRecipient(recipient.id),{blocked:"approval_stale"});assert.equal(calls,0);
  const held=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:c.id}});assert.equal(held.spentCents,0n);assert.equal(held.reservedCents,0n);
  enabled=true;const result=await worker.processRecipient(recipient.id);assert.equal('state' in result&&result.state,"provider_accepted",JSON.stringify(result));assert.equal(calls,1);
 }finally{await f.close();}
});

test("READY AC3 preparing cold or revoked contacts preserves their blockers and never creates permission or spending",async()=>{
 for(const mode of ["no_opt_in","revoked"]){
  const f=await createCampaignFixture(false);try{
   if(mode==="revoked")await f.prisma.contactPermissionReceipt.create({data:{source:"zyon_platform",senderBindingId:"sender",endpointId:f.endpoint.id,purpose:"zyon_sales",status:"revoked",evidenceRef:"fixture-withdrawal",occurredAt:new Date(0)}});
   const receipts=await f.prisma.contactPermissionReceipt.count();
   const offers={current:async()=>fixtureOffer,catalog:async()=>[fixtureOffer],allowedUrl:()=>true};
   const identity=new CampaignExecutionIdentity(offers,async()=>({knowledge:"published"}),()=>{throw Error("dispatch_disabled");});
   const drafts=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));
   const c=await drafts.create({name:"Cold audience review",companies:{snapshotId:"search-old",cnpjs:[f.lead.cnpj]},clientRequestId:"cold-create"},actor);
   const configured=await drafts.edit(c.id,{expectedRevision:c.revision,senderBindingId:"sender",senderVersion:1,limits,sendWindow:fixtureWindow,clientRequestId:"cold-config"},actor);
   const audience=new PrismaAudienceRepository(f.prisma,f.keys),prepare=new CampaignPreparation(new PrismaCampaignPreparation(f.prisma,{compatible:async()=>fixtureTemplate},identity,audience));
   const job=await prepare.prepare(c.id,{expectedRevision:configured.revision,clientRequestId:"cold-prepare"},actor);
   while((await audience.poll(job.selectionId))?.state!=="complete")await audience.processNext(1);
   const recipients=await f.prisma.campaignRecipient.findMany({where:{campaignId:c.id}});assert.equal(recipients.length,1);assert.equal(recipients[0].eligibility,mode);assert.equal(recipients[0].state,"blocked");assert.deepEqual(recipients[0].blockers,["no_opt_in","provider_policy_blocked"]);
   assert.equal(await f.prisma.contactPermissionReceipt.count(),receipts);assert.equal(await f.prisma.outreachAttempt.count({where:{recipient:{campaignId:c.id}}}),0);
   const saved=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:c.id}});assert.equal(saved.state,"review_ready");assert.equal(saved.spentCents,0n);assert.equal(saved.reservedCents,0n);
  }finally{await f.close();}
 }
});
