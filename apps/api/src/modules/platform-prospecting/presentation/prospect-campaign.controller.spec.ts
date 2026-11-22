import {test} from "node:test";
import assert from "node:assert/strict";
import {createProspectingFixture} from "../../../../tests/prospecting-fixture.js";
import {createCampaignFixture,fixtureOffer,fixtureWindow,fixtureTemplate} from "../../../../tests/prospect-campaign-fixture.js";
import {CampaignService} from "../application/campaigns/campaign.service.js";
import {FreezeCampaignAudience} from "../application/campaigns/freeze-campaign-audience.js";
import {PrismaCampaignCommands} from "../infrastructure/campaigns/prisma-campaign-commands.js";
import {PrismaCampaignRepository} from "../infrastructure/campaigns/prisma-campaign.repository.js";
import {PrismaAudienceRepository} from "../infrastructure/campaigns/prisma-audience.repository.js";
import {ProspectCampaignController} from "./prospect-campaign.controller.js";
test("PROS-12 AC4 platform campaign HTTP freezes asynchronously and pause/resume preserves a single attempt and follow-up counter",async()=>{
 const f=await createCampaignFixture();
 const service=new CampaignService(new PrismaCampaignCommands(f.prisma,{current:async()=>fixtureOffer,allowedUrl:()=>true},async()=>[]));
 const freeze=new FreezeCampaignAudience(new PrismaAudienceRepository(f.prisma,f.keys));
 const http=await createProspectingFixture({controllers:[ProspectCampaignController],providers:[{provide:CampaignService,useValue:service},{provide:FreezeCampaignAudience,useValue:freeze}]});
 try{
  await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[http.operators.admin.id]);
  const url=http.url+"/v1/platform/prospecting/campaigns";
  const req=(path:string,method="GET",body?:unknown,token=http.operators.admin.token)=>fetch(url+path,{method,headers:{"content-type":"application/json",Authorization:token?"Bearer "+token:""},body:body===undefined?undefined:JSON.stringify(body)});
  for(const [path,method] of [["","GET"],["","POST"],["/x","GET"],["/x","PATCH"],["/x/freeze","POST"],["/x/selections/y","GET"],["/x/approve","POST"],["/x/start","POST"],["/x/pause-or-resume","POST"],["/x/recipients","GET"]]){
   for(const [token,status] of [["",401],["merchant",401],[http.operators.support.token,403]] as const) assert.equal((await req(path,method,method==="GET"?undefined:{},token)).status,status);
  }
  const input={name:"http",planKey:"growth",message:"local",senderBindingId:"sender",senderVersion:1,template:fixtureTemplate,limits:{dailyRecipients:2,budget:{amountCents:100,currency:"BRL"}},sendWindow:fixtureWindow,clientRequestId:"create-http"};
  assert.equal((await req("","POST",{...input,price:0})).status,400);
  const created=await req("","POST",input);assert.equal(created.status,201);const draft=await created.json();
  assert.equal((await (await req("","POST",input)).json()).id,draft.id);assert.equal((await req("","POST",{...input,message:"different"})).status,409);
  const revised=await req("/"+draft.id,"PATCH",{...input,expectedRevision:1,name:"renamed",clientRequestId:"edit"});assert.equal(revised.status,200);
  const frozen=await req("/"+draft.id+"/freeze","POST",{expectedRevision:2,snapshotId:"search-old",cnpjs:[f.lead.cnpj],clientRequestId:"freeze-http"});
  assert.equal(frozen.status,202);const job=await frozen.json();assert.equal(job.state,"pending");
  await freeze.processNext(5);assert.equal((await (await req("/"+draft.id+"/selections/"+job.selectionId)).json()).state,"complete");
  const c=await (await req("/"+draft.id)).json();const prefix="/"+c.id;
  const approved=await req(prefix+"/approve","POST",{clientRequestId:"approve-http",expectedRevision:c.revision,audienceHash:c.audienceHash,contentHash:c.contentHash});
  assert.equal(approved.status,200);assert.equal((await req(prefix+"/start","POST",{expectedRevision:c.revision,clientRequestId:"start-http"})).status,202);
  assert.equal((await (await req(prefix+"/recipients")).json()).items[0].prospectId,f.lead.id);assert.ok((await (await req("")).json()).items.length>=2);
  assert.equal((await req("/missing")).status,404);assert.equal((await req(prefix+"/recipients?unknown=1")).status,400);
  const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);const reserved=await repo.reserveAttempt(f.recipient.id,"worker",new Date());assert.ok(reserved);
  const scheduled=new Date("2026-11-24T12:00:00Z");
  await f.prisma.prospectSequence.update({where:{id:reserved.attempt.sequenceId},data:{followUpDueAt:scheduled}});
  const observed=(await (await req("/"+f.recipient.campaignId+"/recipients")).json()).items.find((row:{id:string})=>row.id===f.recipient.id);
  assert.equal(observed.followUpDueAt,scheduled.toISOString());assert.equal(observed.attemptState,"reserved");
  await f.prisma.prospectSequence.update({where:{id:reserved.attempt.sequenceId},data:{followUpCount:1}});
  const target="/"+f.campaign.id+"/pause-or-resume";
  for(const [action,state] of [["pause","paused"],["resume","running"]]){
    const cmd={action,expectedRevision:1,clientRequestId:"http-"+action};
    const res=await req(target,"POST",cmd);assert.equal(res.status,200);assert.equal((await res.json()).state,state);assert.equal((await (await req(target,"POST",cmd)).json()).state,state);
  }
  assert.equal(await repo.markSubmitting(reserved.attempt.id,"worker",new Date()),false);
  assert.equal((await repo.reserveAttempt(f.recipient.id,"new-worker",new Date()))?.attempt.id,reserved.attempt.id);
  assert.equal((await f.prisma.prospectSequence.findUniqueOrThrow({where:{id:reserved.attempt.sequenceId}})).followUpCount,1);assert.equal(await f.prisma.outreachAttempt.count(),1);
 }finally{await http.close();await f.close();}
});
