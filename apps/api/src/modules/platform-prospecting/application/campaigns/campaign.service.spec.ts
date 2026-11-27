import {test} from "node:test";
import assert from "node:assert/strict";
import { createCampaignFixture,fixtureOffer,fixtureWindow,fixtureTemplate } from "../../../../../tests/prospect-campaign-fixture.js";
import { CampaignService } from "./campaign.service.js";
import { PrismaCampaignCommands } from "../../infrastructure/campaigns/prisma-campaign-commands.js";

const actor={operatorId:"operator",correlationId:"review"};
const input={clientRequestId:"create",name:"New",message:"hello",planKey:"growth",senderBindingId:"sender",senderVersion:1,limits:{dailyRecipients:2,budget:{amountCents:100,currency:"BRL"}},sendWindow:fixtureWindow,template:fixtureTemplate};
test("PROS-12 AC2 exact commercial revision binds current offer, sender, message, audience, hours and explicit limits with actor audit",async()=>{
 const f=await createCampaignFixture();try{
  const svc=new CampaignService(new PrismaCampaignCommands(f.prisma,{current:async()=>fixtureOffer,allowedUrl:()=>true},async()=>[]));
  const c=await svc.create(input,actor);assert.equal(c.offer?.price.amountCents,9900);assert.equal(c.state,"draft");assert.deepEqual(await svc.create(input,actor),c);
  await f.prisma.prospectCampaign.update({where:{id:c.id},data:{state:"review_ready",audienceHash:"frozen",recipientCount:1}});
  const ready=await svc.find(c.id); const approve={clientRequestId:"approve",expectedRevision:ready.revision,audienceHash:"frozen",contentHash:ready.contentHash!};
  await assert.rejects(svc.approve(c.id,{...approve,contentHash:"forged"},actor),/approval_stale/);
  const approved=await svc.approve(c.id,approve,actor);assert.equal(approved.approvedBy,"operator");assert.equal(approved.approvedRevision,ready.revision);
  const row=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:c.id}});assert.equal(row.approvedHash,ready.contentHash);assert.ok(row.approvedAt);
  assert.equal(await f.prisma.prospectAuditEvent.count({where:{resourceId:c.id,action:"campaign.approve"}}),1);
  assert.deepEqual(await svc.approve(c.id,approve,actor),approved);
 }finally{await f.close();}
});
test("PROS-12 AC3 changed message, canonical offer or sender version invalidates approval before execution",async()=>{
 const f=await createCampaignFixture();try{
  let offer=fixtureOffer;
  const svc=new CampaignService(new PrismaCampaignCommands(f.prisma,{current:async()=>offer,allowedUrl:()=>true},async()=>[]));
  await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"approved"}});
  const start={clientRequestId:"start",expectedRevision:1,action:"start" as const};
  offer={...offer,version:"v2"};await assert.rejects(svc.action(f.campaign.id,start,actor),/approval_stale/);
  offer=fixtureOffer;await f.prisma.platformProspectSenderBinding.update({where:{id:"sender"},data:{version:2}});
  await assert.rejects(svc.action(f.campaign.id,start,actor),/approval_stale/);
  const revised=await svc.revise(f.campaign.id,{...input,expectedRevision:1,clientRequestId:"revise",senderVersion:2,message:"new"},actor);
  assert.equal(revised.approvedRevision,null);assert.equal(revised.state,"review_ready");assert.equal(revised.revision,2);
  assert.notEqual(revised.contentHash,f.campaign.contentHash);assert.equal(revised.audienceHash,"audience");
  await assert.rejects(svc.revise(f.campaign.id,{...input,expectedRevision:1,clientRequestId:"old",senderVersion:2},actor),/version_conflict/);
  assert.equal(await f.prisma.outreachAttempt.count(),0);
 }finally{await f.close();}
});
test("PROS-12 AC2 a static template whose observed body differs from the reviewed message cannot be approved",async()=>{
 const f=await createCampaignFixture();try{
  const svc=new CampaignService(new PrismaCampaignCommands(f.prisma,{current:async()=>fixtureOffer,allowedUrl:()=>true},async c=>c.message==="provider template body"?[]:["template_binding_mismatch"]));
  await f.prisma.prospectCampaign.update({where:{id:f.campaign.id},data:{state:"review_ready",approvedHash:null,approvedRevision:null,approvedAt:null,approvedBy:null}});
  const review=await svc.find(f.campaign.id);
  await assert.rejects(svc.approve(review.id,{clientRequestId:"wrong-template-body",expectedRevision:review.revision,audienceHash:review.audienceHash!,contentHash:review.contentHash!},actor),/template_binding_mismatch/);
  const stored=await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:review.id}});assert.equal(stored.state,"review_ready");assert.equal(stored.approvedRevision,null);
  assert.equal(await f.prisma.prospectCommand.count({where:{clientRequestId:"wrong-template-body"}}),0);
 }finally{await f.close();}
});
