import assert from "node:assert/strict";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { createCampaignFixture } from "../../../../../tests/prospect-campaign-fixture.js";
import { PrismaCampaignRepository } from "./prisma-campaign.repository.js";
test("PROS-14 AC1 concurrent reservations grant one owner, one durable outbox and one budget reservation; ambiguous submission stays held",async()=>{
 const f=await createCampaignFixture(); const other=new PrismaClient({datasources:{db:{url:f.databaseUrl}}});
 try{
   const a=new PrismaCampaignRepository(f.prisma,f.keys,f.quote), b=new PrismaCampaignRepository(other,f.keys,f.quote);
   const now=new Date(); const [x,y]=await Promise.all([a.reserveAttempt(f.recipient.id,"alpha",now),b.reserveAttempt(f.recipient.id,"beta",now)]);
   assert.equal([x,y].filter(Boolean).length,1); const won=(x??y)!;
   assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,25n);
   assert.equal((await f.prisma.prospectCampaignDailyUsage.findFirstOrThrow()).reservedRecipients,1);
   const out=await f.prisma.prospectOutbox.findFirstOrThrow(); assert.ok(out.resourceIds.includes(f.lead.id)); assert.ok(out.resourceIds.includes(won.attempt.id));
   assert.equal(await f.prisma.outreachAttempt.count(),1); assert.equal(await f.prisma.prospectSequence.count(),1);
   const later=new Date(now.getTime()+120_000);
   assert.equal(await a.markSubmitting(won.attempt.id,won.ownerToken,later),false);
   const next=await b.reserveAttempt(f.recipient.id,"fresh",later); assert.equal(next?.attempt.id,won.attempt.id);
   assert.equal(await a.markSubmitting(won.attempt.id,won.ownerToken,later),false); assert.equal(await b.markSubmitting(won.attempt.id,"fresh",later),true);
   const unknown=await b.recordResult(won.attempt.id,"fresh",{state:"outcome_unknown",errorCode:"timeout"}); assert.equal(unknown.state,"outcome_unknown");assert.equal(unknown.deliveredAt,null);
   assert.equal(await a.reserveAttempt(f.recipient.id,"new",new Date(later.getTime()+86400000)),null);
   assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,25n);
   assert.equal(await f.prisma.prospectOutbox.count(),1);
 }finally{await other.$disconnect();await f.close();}
});
test("PROS-14 AC1 an outbox failure rolls back sequence, usage, money and attempt and a missing quote blocks reservation",async()=>{
 const f=await createCampaignFixture();
 try{
   const repo=new PrismaCampaignRepository(f.prisma,f.keys,f.quote);
   const unpriced=new PrismaCampaignRepository(f.prisma,f.keys,()=>null);
   await assert.rejects(unpriced.reserveAttempt(f.recipient.id,"a",new Date()),/cost_unknown/);
   await f.pg.query("ALTER TABLE prospect_outbox ADD CONSTRAINT synthetic_failure CHECK(false)");
   await assert.rejects(repo.reserveAttempt(f.recipient.id,"b",new Date()),/synthetic_failure|constraint/i);
   assert.equal(await f.prisma.prospectSequence.count(),0);assert.equal(await f.prisma.outreachAttempt.count(),0); assert.equal(await f.prisma.prospectCampaignDailyUsage.count(),0);
   assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,0n);
 }finally{await f.close();}
});
test("PROS-14 AC1 expired pre-submit lease crosses midnight and a paused edit recovers the same logical attempt under the approved price and revision",async()=>{
 const f=await createCampaignFixture();
 try{
  const {CampaignService}=await import("../../application/campaigns/campaign.service.js");
  const {PrismaCampaignCommands}=await import("./prisma-campaign-commands.js");
  const {fixtureOffer,fixtureWindow,fixtureTemplate}=await import("../../../../../tests/prospect-campaign-fixture.js");
  const commands=new CampaignService(new PrismaCampaignCommands(f.prisma,{current:async()=>fixtureOffer,allowedUrl:()=>true},async()=>[]));
  const actor={operatorId:"operator",correlationId:"recover"};
  let cents=20;const repo=new PrismaCampaignRepository(f.prisma,f.keys,()=>({amountCents:cents,currency:"BRL",validUntil:new Date("2090-01-01")}));
  const firstDate=new Date("2026-11-20T23:59:00Z");const tomorrow=new Date("2026-11-21T00:01:00Z");
  const first=await repo.reserveAttempt(f.recipient.id,"old",firstDate);assert.ok(first);
  const transferred=await repo.reserveAttempt(f.recipient.id,"next",tomorrow);assert.equal(transferred?.attempt.id,first.attempt.id);
  assert.equal(await repo.markSubmitting(first.attempt.id,"old",tomorrow),false);
  const usage=()=>f.prisma.prospectCampaignDailyUsage.findMany({where:{campaignId:f.campaign.id},orderBy:{day:"asc"}});
  assert.deepEqual((await usage()).map(d=>d.reservedRecipients),[0,1]);
  await commands.action(f.campaign.id,{action:"pause",clientRequestId:"pause",expectedRevision:1},actor);
  const changed=await commands.revise(f.campaign.id,{name:"edited",message:"reviewed replacement",planKey:"growth",senderVersion:1,senderBindingId:"sender",sendWindow:fixtureWindow,limits:{dailyRecipients:1,budget:{amountCents:100,currency:"BRL"}},template:fixtureTemplate,clientRequestId:"edit",expectedRevision:1},actor);
  assert.equal((await f.prisma.prospectCampaign.findUniqueOrThrow({where:{id:f.campaign.id}})).reservedCents,0n);
  assert.deepEqual((await usage()).map(d=>d.reservedRecipients),[0,0]);
  await commands.approve(f.campaign.id,{expectedRevision:2,audienceHash:changed.audienceHash!,contentHash:changed.contentHash!,clientRequestId:"approve"},actor);
  await commands.action(f.campaign.id,{action:"start",expectedRevision:2,clientRequestId:"start"},actor);
  cents=30;const recovered=await repo.reserveAttempt(f.recipient.id,"current",tomorrow);assert.equal(recovered?.attempt.id,first.attempt.id);
  assert.equal(recovered?.content,"reviewed replacement");assert.equal(recovered?.attempt.reservedAmount.amountCents,30);
  const row=await f.prisma.outreachAttempt.findUniqueOrThrow({where:{id:first.attempt.id}});assert.equal(row.approvedRevision,2);assert.equal(row.createdAt.toISOString(),firstDate.toISOString());assert.equal(row.ordinal,0);
  assert.equal(await repo.markSubmitting(row.id,"current",tomorrow),true);assert.equal(await f.prisma.prospectOutbox.count(),1);
  assert.deepEqual((await usage()).map(d=>d.reservedRecipients),[0,1]);
 }finally{await f.close();}
});
