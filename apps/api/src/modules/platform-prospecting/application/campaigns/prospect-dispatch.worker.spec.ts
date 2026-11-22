import assert from "node:assert/strict";
import test from "node:test";
import {createCampaignFixture,fixtureOffer,fixtureTemplate} from "../../../../../tests/prospect-campaign-fixture.js";
import {PrismaCampaignRepository} from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import {SenderReadinessService} from "./sender-readiness.service.js";
import {ProspectDispatchWorker} from "./prospect-dispatch.worker.js";

async function fixture(optedIn=true){
 const f=await createCampaignFixture(optedIn);
 const binding={id:"sender",version:1,appId:"app",wabaId:"waba",phoneNumberId:"phone",displayPhoneNumber:"synthetic",connectedBy:"operator",connectedAt:new Date(0).toISOString(),authorizationVersion:1};
 const store={credential:async()=>({binding,businessId:"business",accessToken:"fixture"}),save:async()=>true,permission:async()=>"opted_in" as const};
 const state={template:fixtureTemplate,offer:fixtureOffer,beforeSubmit:async()=>{},sent:[] as string[],timeout:false};
 const ready=new SenderReadinessService(store,{async read(){await state.beforeSubmit();return {entities:[],templates:[state.template],blockers:[],portfolioLimit:100,portfolioTier:"100"};}});
 const repo=new PrismaCampaignRepository(f.prisma,f.keys,()=>({amountCents:25,currency:"BRL",validUntil:new Date("2030-01-01")}));
 const worker=new ProspectDispatchWorker(repo,ready,{current:async()=>state.offer,allowedUrl:()=>true},{async send(packet){state.sent.push(packet.attempt.id);if(state.timeout)throw Error("timeout");return {state:"provider_accepted",providerMessageId:"wamid.fixture",acceptedAt:new Date("2026-11-20T15:00Z")};}},()=>new Date("2026-11-20T15:00Z"));
 return {...f,state,worker};
}
test("PROS-13 AC2 no permission blocks external activation and preserves CRM",async()=>{
 const f=await fixture(false);try{
  await f.worker.processRecipient(f.recipient.id);
  assert.deepEqual(f.state.sent,[]);assert.equal(await f.prisma.outreachAttempt.count(),0);
  const recipient=await f.prisma.campaignRecipient.findUniqueOrThrow({where:{id:f.recipient.id}});
  assert.ok(recipient.blockers.includes("provider_policy_blocked"));assert.equal(recipient.eligibility,"no_opt_in");
  assert.equal(await f.prisma.platformProspect.count({where:{id:f.lead.id}}),1);
 }finally{await f.close();}
});
test("PROS-13 AC5 only current approved content and commercial offer can cross the submission fence",async()=>{
 for(const invalidation of ["dynamic","body","offer","human","revoke","pause","none"]){
  const f=await fixture();try{
   if(invalidation==="dynamic")f.state.template={...fixtureTemplate,requiresParameters:true};
   if(invalidation==="body")f.state.template={...fixtureTemplate,previewText:"another text"};
   if(invalidation==="offer")f.state.offer={...fixtureOffer,version:"v2"};
   if(invalidation==="human")f.state.beforeSubmit=async()=>{await f.prisma.prospectConversation.create({data:{endpointId:f.endpoint.id,mode:"human",controlEpoch:1}});};
   if(invalidation==="revoke")f.state.beforeSubmit=async()=>{await f.prisma.contactPermissionReceipt.create({data:{endpointId:f.endpoint.id,senderBindingId:"sender",purpose:"zyon_sales",source:"zyon_platform",status:"revoked",occurredAt:new Date()}});};
   if(invalidation==="pause")f.state.beforeSubmit=async()=>{await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"paused"}});};
   await f.worker.processRecipient(f.recipient.id);
   assert.equal(f.state.sent.length,invalidation==="none"?1:0,invalidation);
   const attempt=await f.prisma.outreachAttempt.findFirstOrThrow();assert.equal(!!attempt.submittedAt,invalidation==="none",invalidation);
   if(invalidation==="none"){assert.equal(attempt.state,"provider_accepted");assert.equal(attempt.deliveredAt,null);}
  }finally{await f.close();}
 }
});
test("PROS-14 AC3 concurrent workers keep one uncertain submission and its financial reservation",async()=>{
 const f=await fixture();try{
  f.state.timeout=true;
  await Promise.all([f.worker.processRecipient(f.recipient.id),f.worker.processRecipient(f.recipient.id)]);
  await f.worker.processRecipient(f.recipient.id);
  const attempt=await f.prisma.outreachAttempt.findFirstOrThrow();
  assert.deepEqual(f.state.sent,[attempt.id]);assert.equal(attempt.state,"outcome_unknown");assert.equal(attempt.costState,"reserved");
  const c=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}});assert.equal(c.reservedCents,25n);assert.equal(c.spentCents,0n);
 }finally{await f.close();}
});
