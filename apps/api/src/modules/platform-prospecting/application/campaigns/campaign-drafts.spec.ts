import {test} from "node:test";
import assert from "node:assert/strict";
import {createProspectCrmFixture} from "../../../../../tests/prospect-crm-fixture.js";
import {createProspectingFixture} from "../../../../../tests/prospecting-fixture.js";
import {CampaignDraftService} from "./campaign-drafts.js";
import {PrismaCampaignDrafts} from "../../infrastructure/campaigns/prisma-campaign-drafts.js";
import {ProspectCampaignDraftController} from "../../presentation/prospect-campaign-draft.controller.js";
const actor={operatorId:"operator",correlationId:"draft"};
test("CAMP-01 create durable protected name/context drafts without sender, offer, template, segment or money",async()=>{
 const f=await createProspectCrmFixture();
 const service=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));
 const http=await createProspectingFixture({controllers:[ProspectCampaignDraftController],providers:[{provide:CampaignDraftService,useValue:service}]});
 try{
  await f.prisma.platformProspectSenderBinding.deleteMany();await f.pg.query("INSERT INTO platform_operators VALUES ($1)",[http.operators.admin.id]);
  const url=http.url+"/v1/platform/prospecting/campaign-drafts";
  const req=(path:string,method="GET",body?:unknown,token=http.operators.admin.token)=>fetch(url+path,{method,headers:{"content-type":"application/json",Authorization:token?"Bearer "+token:""},body:body===undefined?undefined:JSON.stringify(body)});
  for(const token of ["","merchant",http.operators.support.token])assert.equal((await req("","POST",{name:"Roupas",clientRequestId:"deny"},token)).status,token===http.operators.support.token?403:401);
  assert.equal((await req("","POST",{name:"Roupas",price:0,clientRequestId:"extra"})).status,400);
  const response=await req("","POST",{name:"Lojas de roupas SP",businessContext:"lojas de roupas em SP",clientRequestId:"create-context"});assert.equal(response.status,201);
  const c=await response.json();assert.equal(c.name,"Lojas de roupas SP");assert.equal(c.businessContext,"lojas de roupas em SP");assert.equal(c.setupVersion,2);assert.equal(c.state,"draft");assert.deepEqual(c.offerPolicy,{mode:"catalog"});
  for(const field of ["message","offer","senderBindingId","senderVersion","template","limits","sendWindow","approvedAt","audienceCriteria","directorySnapshotId"])assert.equal(c[field],null,field);
  assert.equal(c.manualCompanyCount,0);assert.equal((await (await req("/"+c.id)).json()).id,c.id);
  const stored=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:c.id}});assert.equal(stored.budgetCents,null);assert.equal(stored.offerSnapshot,null);assert.equal(stored.message,null);assert.equal(stored.sendWindow,null);
  assert.equal(await f.prisma.prospectConversation.count(),0);assert.equal(await f.prisma.campaignRecipient.count(),0);assert.equal(await f.prisma.prospectAuditEvent.count({where:{resourceId:c.id,action:"campaign.draft.create"}}),1);
  const simple=await service.create({name:"Only name",clientRequestId:"only-name"},actor);assert.equal(simple.businessContext,null);assert.equal(simple.offer,null);
 }finally{await http.close();await f.close();}
});
test("CAMP-01 replay creation/edit is durable, revisions reject races and changes invalidate prior review",async()=>{
 const f=await createProspectCrmFixture();try{
  const svc=new CampaignDraftService(new PrismaCampaignDrafts(f.prisma));const cmd={name:"Research",clientRequestId:"create-replay"};
  const [a,b]=await Promise.all([svc.create(cmd,actor),svc.create(cmd,actor)]);assert.deepEqual(a,b);assert.equal(await f.prisma.prospectCampaign.count(),1);
  await assert.rejects(svc.create({...cmd,name:"different"},actor),/idempotency_conflict/);
  await assert.rejects(svc.create(cmd,{...actor,operatorId:"other"}),/idempotency_conflict/);
  await f.prisma.prospectCampaign.update({where:{id:a.id},data:{state:"approved",audienceHash:"reviewed",approvedHash:"old",approvedRevision:1,approvedBy:"operator",approvedAt:new Date()}});
  const change={expectedRevision:1,businessContext:"roupas SP",clientRequestId:"edit-replay"};const c=await svc.edit(a.id,change,actor);assert.equal(c.revision,2);assert.equal(c.businessContext,"roupas SP");assert.equal(c.state,"draft");assert.equal(c.approvedRevision,null);assert.equal(c.approvedAt,null);assert.equal(c.audienceHash,null);
  assert.deepEqual(await svc.edit(a.id,change,actor),c);await assert.rejects(svc.edit(a.id,{...change,clientRequestId:"stale",businessContext:"other"},actor),/version_conflict/);
  const races=await Promise.allSettled([svc.edit(a.id,{name:"One",expectedRevision:2,clientRequestId:"race-one"},actor),svc.edit(a.id,{name:"Two",expectedRevision:2,clientRequestId:"race-two"},actor)]);
  assert.equal(races.filter(r=>r.status==="fulfilled").length,1);assert.equal((await svc.find(a.id)).revision,3);assert.equal(await f.prisma.prospectAuditEvent.count({where:{resourceId:a.id,action:"campaign.draft.edit"}}),2);
  await assert.rejects(svc.edit(a.id,{expectedRevision:3,limits:{dailyRecipients:1,budget:{amountCents:0,currency:"BRL"}},clientRequestId:"bad-budget"},actor),/limits_missing/);
 }finally{await f.close();}
});
