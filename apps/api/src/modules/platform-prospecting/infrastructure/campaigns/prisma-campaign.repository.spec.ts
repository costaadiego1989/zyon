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
