import { test } from "node:test";
import assert from "node:assert/strict";
import { createConversationFixture } from "../../../../../tests/prospect-conversation-fixture.js";
import { ProspectMetricsQueryService } from "./prospect-metrics.query.js";

async function seed() {
  const f = await createConversationFixture();
  try {
    const since = new Date(Date.now() - 60_000);
    const now = new Date();
    const until = new Date(+now + 60_000);
    const sequence = await f.prisma.prospectSequence.create({data:{senderBindingId:"sender",endpointId:f.endpoint.id}});
    for (const [ordinal, state] of ["delivered","provider_accepted"].entries()) {
      await f.prisma.outreachAttempt.create({data:{sequenceId:sequence.id, recipientId:f.recipient.id, ordinal, state,
        requestHash:"hash",clientRequestId:"metrics-"+ordinal,senderVersion:1,submittedAt:now,acceptedAt:now,
        deliveredAt:ordinal===0?now:null,costState:"committed",reservedAmount:12,currency:ordinal===0?"BRL":"USD"}});
    }
    await f.prisma.prospectMessage.createMany({data:[1,2].map(sequence=>({conversationId:f.c.id,senderBindingId:"sender",
      sequence,authorType:"prospect",direction:"inbound",state:"received",providerOccurredAt:now}))});
    await f.prisma.prospectMessage.create({data:{conversationId:f.c.id,senderBindingId:"sender",campaignId:f.campaign.id,
      sequence:3,authorType:"operator",direction:"outbound",state:"outcome_unknown",submittedAt:now,reservedAmount:8,costState:"reserved"}});
    await f.prisma.prospectModelUsage.create({data:{requestId:"controlled-usage",conversationId:f.c.id,campaignId:f.campaign.id,state:"unknown",amountCents:14}});
    const p=await f.prisma.prospectBillingProposal.create({data:{prospectId:f.lead.id,planKey:"growth",offerVersion:"1",nonceHash:"fixture",expiresAt:until,clientRequestId:"fixture"}});
    await f.prisma.prospectConversion.createMany({data:["signup","trial","paid","refunded"].map(state=>({state,prospectId:f.lead.id,
      proposalId:p.id,merchantId:"verified",subscriptionId:"subscription",provider:state==="trial"||state==="signup"?"account":"stripe",providerEventId:state,occurredAt:now}))});
    const query=new ProspectMetricsQueryService(f.prisma,()=>until);
    return {...f,query,input:{campaignId:f.campaign.id,from:since.toISOString(),to:until.toISOString()}};
  } catch(error) { await f.close(); throw error; }
}

test("PROS-23 AC1 distinguishes attempts, acceptance, delivery, distinct responses and verified outcomes",async()=>{
  const f=await seed();
  try {
    const m=await f.query.execute(f.input);
    assert.deepEqual([m.leads,m.attempts,m.accepted,m.delivered,m.uniqueReplies,m.signups,m.trials,m.paidSubscriptions,m.refundedSubscriptions],[1,3,2,1,1,1,1,0,1]);
    assert.deepEqual(m.costs.totals,[]);
    assert.equal(m.costs.coverage,"partial");
    assert.deepEqual(m.costs.commitments.map(x=>[x.source,x.currency,x.state,x.amountCents]).sort(),[
      ["meta","BRL","committed","12"],["meta","BRL","reserved","8"],["meta","USD","committed","12"],["model","BRL","unknown","14"]].sort());
    assert.ok(m.costs.missing.includes("final_provider_charges"));
    assert.ok(m.costs.missing.includes("multiple_currencies"));
  }finally{await f.close();}
});
test("PROS-23 AC2 scopes the response population to delivered contacts and later unique replies",async()=>{
  const f=await seed();
  try{
    const m=await f.query.execute(f.input);
    assert.deepEqual(m.responseRate,{numerator:1,denominator:1,population:"unique_delivered_endpoints",cohortUpdatedAt:f.input.to});
    assert.deepEqual([m.campaignId,m.from,m.to,m.updatedAt],[f.input.campaignId,f.input.from,f.input.to,f.input.to]);
    await f.prisma.prospectMessage.updateMany({where:{direction:"inbound"},data:{providerOccurredAt:new Date(f.input.from)}});
    assert.equal((await f.query.execute(f.input)).responseRate.numerator,0);
    await assert.rejects(()=>f.query.execute({...f.input,from:f.input.to}),/invalid_filter/);
    await assert.rejects(()=>f.query.execute({...f.input,campaignId:"missing"}),/campaign_not_found/);
  }finally{await f.close();}
});
