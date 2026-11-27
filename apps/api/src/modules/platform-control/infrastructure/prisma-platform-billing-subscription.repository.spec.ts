import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPlatformBillingSubscriptionRepository } from "./prisma-platform-billing-subscription.repository.js";

function subscriptions() {
  const rows=[['cancel_a','canceled'],['cancel_b','cancelled'],['live','active']].map(([id,status])=>({
    merchantId:id,merchant:{id,name:id},status,provider:'stripe',planKey:'growth',billingCycle:'monthly',billingAmountCents:44900,
    trialEndsAt:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,providerCancellationScheduledAt:null,lastBillingEventAt:null,createdAt:new Date('2026-11-01'),updatedAt:new Date('2026-11-02'),
  }));
  const matching=(where:any)=>rows.filter(row=>Object.entries(where??{}).every(([key,value]:[string,any])=>
    typeof value==='object'&&value!==null&&'in' in value?value.in.includes((row as any)[key]):(row as any)[key]===value));
  return new PrismaPlatformBillingSubscriptionRepository({merchantBillingSubscription:{
    findMany:async({where,cursor,skip=0,take}:any)=>{const found=matching(where);const start=cursor?found.findIndex(r=>r.merchantId===cursor.merchantId)+skip:0;return found.slice(start,start+take);},
    findFirst:async({where}:any)=>matching(where)[0]??null,
    count:async({where}:any)=>matching(where).length,
    groupBy:async({where}:any)=>Object.entries(matching(where).reduce((out,row)=>({...out,[row.status]:(out[row.status]??0)+1}),{} as Record<string,number>)).map(([status,count])=>({status,_count:{_all:count}})),
  }} as never);
}

test('ADM-01 cancellation spellings return one canonical status and preserve both summary counts',async()=>{
  const page=await subscriptions().list({limit:50,asOf:new Date('2026-11-22')});
  assert.deepEqual(page.items.map(row=>[row.merchantId,row.status]),[['cancel_a','cancelled'],['cancel_b','cancelled'],['live','active']]);
  assert.deepEqual(page.summary.recordsByStatus,{cancelled:2,active:1});
  assert.equal(page.summary.totalRecords,3);
});
test('ADM-01 cancelled filtering includes the two stored spellings',async()=>{
  const page=await subscriptions().list({limit:50,status:'cancelled',asOf:new Date('2026-11-22')});
  assert.deepEqual(page.items.map(row=>row.merchantId),['cancel_a','cancel_b']);
  assert.deepEqual(page.summary.recordsByStatus,{cancelled:2});
  assert.equal(page.summary.totalRecords,2);
});
test('ADM-01 a canceled cursor remains valid in the cancelled population',async()=>{
  const page=await subscriptions().list({limit:1,cursor:'cancel_a',status:'cancelled',asOf:new Date('2026-11-22')});
  assert.deepEqual(page.items.map(row=>[row.merchantId,row.status]),[['cancel_b','cancelled']]);
  assert.equal(page.nextCursor,undefined);
});
test('ADM-01 an active cursor is rejected from the cancelled population',async()=>{
  await assert.rejects(()=>subscriptions().list({limit:1,cursor:'live',status:'cancelled',asOf:new Date('2026-11-22')}),/platform_billing_invalid_cursor/);
});

test("persists a non-financial audit record for global subscription reads", async () => {
  const events: unknown[] = [];
  const repository = new PrismaPlatformBillingSubscriptionRepository({
    platformAuditEvent: {
      create: async (input: unknown) => { events.push(input); },
    },
  } as never);

  await repository.recordRead({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
    returnedItems: 3,
    totalRecords: 10,
    status: "past_due",
    provider: "asaas",
  });

  assert.deepEqual(events, [{
    data: {
      actorOperatorId: "operator_1",
      action: "platform.billing.subscriptions.read",
      permission: "platform:billing:read",
      environment: "test",
      targetType: "platform_billing_subscriptions",
      correlationId: "corr_1",
      outcome: "succeeded",
      details: {
        source: "local_subscription_snapshots",
        returnedItems: 3,
        totalRecords: 10,
        status: "past_due",
        provider: "asaas",
      },
    },
  }]);
});
