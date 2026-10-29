import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { normalPaymentAuthorityFixture } from "../domain/normal-checkout-payment.fixture.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";

function fixture(configured=true,couponOnly=false){
  const f=normalPaymentAuthorityFixture();
  if(couponOnly){const cart=f.authority.frozenProjection.cart;
    cart.items=cart.items.filter(item=>item.sku==="TRIGGER");cart.total=100;cart.currentDiscount=1;
    cart.discountBudget={version:1,originalSubtotalCents:10000,promotionDiscountCents:0};
    const fingerprint=paymentCartFingerprint(f.authority.frozenProjection);
    f.authority.amountCents=10949;f.authority.amountBreakdown={...f.authority.amountBreakdown,cartFingerprint:fingerprint,
      itemsSubtotalCents:10000,discountCents:100,totalCents:10949};
    f.authority.discountOwner={kind:"checkout_coupon",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",reservationBuyerId:"buyer",
      couponId:"coupon",redemptionId:"reservation",code:"SAVE",discountCents:100,applicationEventId:"coupon-applied",reservationUpdatedAt:f.authority.admittedAt};
  }
  const intent=PaymentIntentEntity.create({merchantId:"merchant",sessionId:"checkout",idempotencyKey:"key",method:"pix",
    amountCents:f.authority.amountCents,currency:"BRL",amountBreakdown:f.authority.amountBreakdown});
  intent.prepareCreation({...f.scope.creation.input,intentId:intent.id,amountCents:f.authority.amountCents,method:"pix"});
  const authority={...f.authority,paymentId:intent.id};
  const state={row:null as Record<string,unknown>|null,draft:null as Record<string,unknown>|null,captures:0,writes:0,fail:"",
    cart:structuredClone(f.authority.frozenProjection.cart) as Record<string,unknown>,normalEvent:false,locks:[] as string[]};
  const tx={$queryRaw:async(query:TemplateStringsArray)=>{state.locks.push(query.join("?"));return [];},
    checkoutSession:{findUnique:async()=>({merchantId:"merchant",sessionId:"checkout",cart:state.cart,shipping:f.authority.frozenProjection.shipping})},
    crossStoreLineItem:{findFirst:async()=>null},strategyIncentiveAssignment:{findUnique:async()=>null},
    paymentIntent:{findUnique:async()=>structuredClone(state.row),findFirst:async()=>null,findMany:async()=>[],
      create:async({data}:{data:Record<string,unknown>})=>{state.writes++;state.draft=structuredClone(data);},
      updateMany:async({data}:{data:Record<string,unknown>})=>{state.writes++;state.draft={...state.row,...structuredClone(data)};return {count:1};}},
    outboxMessage:{findFirst:async()=>state.normalEvent?{eventId:"normal-acceptance"}:null,upsert:async()=>{}},
    paymentSettlement:{findUnique:async()=>null,create:async()=>{if(state.fail==="settlement")throw new Error("synthetic_settlement");return{id:"settlement"};}},
    paymentSettlementEntry:{createMany:async()=>({count:2})}} as unknown as Prisma.TransactionClient;
  const client={paymentIntent:tx.paymentIntent,$transaction:async<T>(work:(tx:Prisma.TransactionClient)=>Promise<T>)=>{
    state.draft=structuredClone(state.row);const result=await work(tx);
    if(state.fail==="rollback")throw new Error("synthetic_rollback");state.row=structuredClone(state.draft);
    if(state.fail==="lost_ack")throw new Error("synthetic_lost_ack");return result;}} as unknown as PrismaClient;
  const repo=new PrismaPaymentRepository(client,undefined,undefined,configured?async(actual,snapshot)=>{
    assert.equal(actual,tx);state.captures++;if(state.fail==="source_changed")throw new Error("canonical_source_changed");
    if(!snapshot.version)assert.equal(intent.snapshot().creation!.normalCrossSellAuthority,undefined);
    return structuredClone(authority);}:undefined);
  return {intent,authority,state,repo};
}
test("normal new journal captures sibling inside cart fence and acknowledges only committed entity",async()=>{
  const f=fixture();await f.repo.saveIntent({intent:f.intent});
  assert.equal(f.state.captures,1);assert.equal(f.intent.snapshot().version,1);
  assert.deepEqual(f.intent.snapshot().creation!.normalCrossSellAuthority,f.authority);
  assert.deepEqual((f.state.row!.creation as Record<string,unknown>).normalCrossSellAuthority,f.authority);
  assert.equal("normalCrossSellAuthority"in f.intent.snapshot().creation!.input,false);
  const row=f.state.locks.findIndex(value=>value.includes("FROM checkout_sessions"));
  for(const table of ["merchant_rules","checkout_settings","own_delivery_configs"])assert.ok(f.state.locks.findIndex(value=>value.includes(`FROM ${table}`))<row);
});
for(const fault of ["rollback","lost_ack"])
  test(`normal ${fault} never acknowledges an unconfirmed commit`,async()=>{
    const f=fixture();f.state.fail=fault;await assert.rejects(f.repo.saveIntent({intent:f.intent}));
    assert.equal(f.intent.snapshot().creation!.normalCrossSellAuthority,undefined);assert.equal(f.intent.snapshot().version,0);
    assert.equal(f.state.row!==null,fault==="lost_ack");
  });
test("normal generic caller missing issuer fails closed before journal",async()=>{
  const f=fixture(false);await assert.rejects(f.repo.saveIntent({intent:f.intent}),/payment_normal_cross_sell_authority_conflict/);assert.equal(f.state.writes,0);
});

test("actual normal history with remaining coupon after all targets are removed captures the owner before admission and first send",async()=>{
  const f=fixture(true,true);f.state.normalEvent=true;
  await f.repo.saveIntent({intent:f.intent});assert.equal(f.state.captures,1);
  assert.equal(f.intent.snapshot().creation!.normalCrossSellAuthority?.discountOwner?.kind,"checkout_coupon");
  assert.equal(f.intent.snapshot().creation!.normalCrossSellAuthority?.frozenProjection.cart.items.some(item=>item.crossSellIntent),false);
  f.intent.claimCreation("lease",new Date("2026-10-20T12:00:01Z"));await f.repo.saveIntent({intent:f.intent});
  assert.equal(f.state.captures,2);assert.equal(f.intent.snapshot().version,2);
});

test("actual normal history with remaining coupon cannot admit without the canonical issuer",async()=>{
  const f=fixture(false,true);f.state.normalEvent=true;
  await assert.rejects(f.repo.saveIntent({intent:f.intent}),/payment_normal_cross_sell_authority_conflict/);assert.equal(f.state.writes,0);
});

test("discount and erased intent alone cannot manufacture normal acceptance history",async()=>{
  const f=fixture(true,true);await f.repo.saveIntent({intent:f.intent});
  assert.equal(f.state.captures,0);assert.equal(f.intent.snapshot().creation!.normalCrossSellAuthority,undefined);
});
test("new caller-supplied normal sibling cannot bypass admission",async()=>{
  const f=fixture();f.intent.acknowledgeNormalCrossSellCapture(f.authority);
  await assert.rejects(f.repo.saveIntent({intent:f.intent}));assert.equal(f.state.captures,0);assert.equal(f.state.writes,0);
});
test("lost commit ACK recovers stored normal journal by existing idempotency lookup without recapture",async()=>{
  const f=fixture();f.state.fail="lost_ack";await assert.rejects(f.repo.saveIntent({intent:f.intent}));
  const actual=await f.repo.getByIdempotency("merchant","checkout","key");
  assert.ok(actual);assert.equal(actual.id,f.intent.id);assert.equal(actual.snapshot().version,1);
  assert.deepEqual(actual.snapshot().creation!.normalCrossSellAuthority,f.authority);assert.equal(f.state.captures,1);
});
test("first send revalidates normal source before writes and never replaces admitted sibling",async()=>{
  const f=fixture();await f.repo.saveIntent({intent:f.intent});f.intent.claimCreation("lease",new Date("2026-10-20T12:00:01Z"));
  f.state.fail="source_changed";f.state.writes=0;
  await assert.rejects(f.repo.saveIntent({intent:f.intent}),/canonical_source_changed/);assert.equal(f.state.writes,0);
  f.state.fail="";await f.repo.saveIntent({intent:f.intent});assert.equal(f.intent.snapshot().version,2);
  assert.deepEqual(f.intent.snapshot().creation!.normalCrossSellAuthority,f.authority);
});
for(const state of ["uncertain","complete"] as const)
  test(`normal already ${state} preserves admitted snapshot despite current cart/catalog changes`,async()=>{
    const f=fixture();await f.repo.saveIntent({intent:f.intent});const snapshot=f.intent.snapshot();
    snapshot.creation={...snapshot.creation!,state,firstAttemptAt:"2026-10-20T12:00:01Z"};
    if(state==="complete"){snapshot.providerPaymentId="provider";snapshot.status="requires_action";}
    f.state.row={...f.state.row,creation:structuredClone(snapshot.creation),providerPaymentId:snapshot.providerPaymentId??null,status:snapshot.status};
    const entity=PaymentIntentEntity.rehydrate(snapshot);if(state==="uncertain")assert.equal(entity.claimCreation("recover",new Date("2026-10-20T12:02:00Z")),"recover");
    f.state.cart={total:999,items:[]};f.state.fail="source_changed";f.state.captures=0;
    await f.repo.saveIntent({intent:entity});assert.equal(f.state.captures,0);assert.deepEqual(entity.snapshot().creation!.normalCrossSellAuthority,f.authority);
  });
