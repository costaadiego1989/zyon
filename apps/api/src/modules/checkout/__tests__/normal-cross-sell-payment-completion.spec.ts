import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { CompleteOrderRequest, CompletedOrder, CheckoutEventName } from "@zyon/shared-types";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../application/use-cases/complete-order.use-case.js";
import type { PersistedPaymentApproval } from "../domain/ports/payment-approval.port.js";
import { normalPaymentAuthorityFixture } from "../../payment/domain/normal-checkout-payment.fixture.js";
import { assertNormalCrossSellPaymentOrderInTransaction } from "../infrastructure/adapters/normal-cross-sell-payment-order-authority.js";
import { paymentCartFingerprint } from "../domain/services/payment-cart-fingerprint.js";

for (const [type, mixed] of [["digital", false], ["service", false], ["digital", true]] as const)
  test(`approved normal ${mixed ? "mixed" : "virtual"} ${type} order preserves fulfillment and never sells virtual stock`, async () => {
    const f = setup(), a = f.authority, projection = a.frozenProjection;
    projection.cart.items.forEach((item, index) => {
      if (mixed && index === 0) return;
      Reflect.set(item, "productType", type); Reflect.set(item, "fulfillmentStrategy", type);
    });
    if (!mixed) {
      Reflect.deleteProperty(projection, "shipping"); Reflect.deleteProperty(projection.customer, "address");
      Reflect.deleteProperty(projection.customer, "address_verified");
      a.amountCents -= a.amountBreakdown.shippingCents; a.amountBreakdown.shippingCents = 0;
    }
    Object.assign(a.amountBreakdown, { totalCents: a.amountCents, cartFingerprint: paymentCartFingerprint(projection) });
    Object.assign(f.approval, { amountCents: a.amountCents, approvedAmountCents: a.amountCents, normalCrossSellAuthority: structuredClone(a) });
    Object.assign(f.actual, { amountCents: a.amountCents, approvedAmountCents: a.amountCents });
    f.actual.creation.input.amountCents = a.amountCents;
    f.request.order_total = (a.amountCents - a.amountBreakdown.platformFeeCents) / 100;
    await f.useCase.executePaymentApproval(f.request, "payment");
    const order = f.repository.getCompletedOrder("merchant", "checkout", "provider")!;
    assert.equal(order.orderTotal, mixed ? 127 : 118); assert.equal(order.shippingCents, mixed ? 900 : undefined);
    const event = f.repository.listOutbox("merchant").find(value => value.event_type === "order.completed")!;
    const inventory = event.payload.inventory_sale as { items: Array<{ sku: string }> };
    const fulfillment = event.payload.fulfillment_snapshot as { lines: Array<{ productType: string; fulfillmentStrategy: string }> };
    assert.deepEqual(inventory.items.map(item => item.sku), mixed ? ["TRIGGER"] : []);
    assert.deepEqual(fulfillment.lines.map(item => item.productType), mixed ? ["physical", "digital"] : [type, type]);
    assert.deepEqual(fulfillment.lines.map(item => item.fulfillmentStrategy), mixed ? ["carrier", "digital"] : [type, type]);
    assert.equal(f.state.reads, 0); assert.equal(f.state.quota, 1);
    const events = structuredClone(f.repository.listOutbox("merchant"));
    assert.equal((await f.useCase.executePaymentApproval(f.request, "payment")).idempotent, true);
    assert.deepEqual(f.repository.listOutbox("merchant"), events); assert.equal(f.state.quota, 1);
  });

function setup(transaction=true){
  const f=normalPaymentAuthorityFixture(),repository=new InMemoryCheckoutRepository();
  const approval={id:"payment",merchantId:"merchant",sessionId:"checkout",status:"approved",currency:"BRL",amountCents:12849,approvedAmountCents:12849,
    providerPaymentId:"provider",acceptedOfferId:null,amountBreakdown:f.authority.amountBreakdown,normalCrossSellAuthority:structuredClone(f.authority)} satisfies PersistedPaymentApproval;
  const actual={...f.scope,version:3,status:"approved",approvedAmountCents:12849,providerPaymentId:"provider",acceptedOfferId:null};
  const state={reads:0,guards:0,saves:0,quota:0,refund:false,events:[] as CheckoutEventName[]};
  repository.getSession=()=>{state.reads++;throw new Error("current_catalog_must_not_reprice_paid_normal_cart");};
  const tx={$queryRaw:async()=>[],paymentIntent:{findFirst:async()=>actual}} as unknown as Prisma.TransactionClient;
  const commit={async assertNormalCrossSellPaymentOrderAuthority(m:string,s:string,a:unknown,p:string,provider:string){
    state.guards++;await assertNormalCrossSellPaymentOrderInTransaction(tx,m,s,a,p,provider);},
    async assertCouponOrderAuthority(){throw new Error("generic_guard_is_not_a_normal_frozen_grant");},
    async saveCompletedOrder(order:CompletedOrder){state.saves++;return repository.saveCompletedOrder(order);},
    async recordCompletedOrderQuota(){state.quota++;},async recordEvent(_m:string,_s:string,event:CheckoutEventName){state.events.push(event);},
    appendOutbox:repository.appendOutbox.bind(repository)};
  const runner={async transaction<T>(work:(repo:typeof commit)=>Promise<T>){if(state.refund)actual.status="refunded";return work(commit);}};
  const useCase=new CompleteOrderUseCase(repository,repository,repository,undefined,undefined,undefined,undefined,transaction?runner:undefined,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{find:async()=>approval});
  const request:CompleteOrderRequest={merchant_id:"merchant",session_id:"checkout",external_order_id:"provider",order_total:127,currency:"BRL"};
  return {...f,approval,actual,repository,state,useCase,request};
}
test("normal approved order freezes actual discounted lines, options, shipping and buyer; platform fee excluded once",async()=>{
  const f=setup();await f.useCase.executePaymentApproval(f.request,"payment");
  const order=f.repository.getCompletedOrder("merchant","checkout","provider")!;
  assert.equal(order.orderTotal,127);assert.equal(order.shippingCents,900);
  assert.deepEqual(order.lineItems!.map(line=>[line.sku,line.unitPriceCents,line.quantity]),[["TRIGGER",10000,1],["TARGET",1800,1]]);
  const events=f.repository.listOutbox("merchant"),completed=events.find(event=>event.event_type==="order.completed")!;
  assert.deepEqual(completed.payload.payment_amount_breakdown,f.authority.amountBreakdown);
  assert.equal(f.state.reads,0);assert.equal(f.state.guards,1);assert.equal(f.state.quota,1);
  for(const key of ["normalCrossSellAuthority","contextHash","acceptanceEventIds","creation"])assert.equal(JSON.stringify(events).includes(key),false);
});
test("normal approval retry uses historical snapshot and commits no duplicate order/outbox/quota",async()=>{
  const f=setup();await f.useCase.executePaymentApproval(f.request,"payment");const events=structuredClone(f.repository.listOutbox("merchant"));
  assert.equal((await f.useCase.executePaymentApproval(f.request,"payment")).idempotent,true);
  assert.deepEqual(f.repository.listOutbox("merchant"),events);assert.equal(f.state.quota,1);assert.equal(f.state.reads,0);
});
for(const field of ["scope","amount","provider","event","undefined","null","breakdown","refund"])
  test(`normal frozen completion rejects ${field} before order/outbox`,async()=>{
    const f=setup();
    if(field==="scope")f.approval.normalCrossSellAuthority.buyerId="foreign";
    if(field==="amount")f.approval.approvedAmountCents--;
    if(field==="provider")f.approval.providerPaymentId="foreign";
    if(field==="event")f.approval.normalCrossSellAuthority.acceptanceEventIds=["forged"];
    if(field==="undefined"||field==="null")Reflect.set(f.approval,"normalCrossSellAuthority",field==="null"?null:undefined);
    if(field==="breakdown")f.approval.amountBreakdown.shippingCents++;
    if(field==="refund")f.state.refund=true;
    await assert.rejects(f.useCase.executePaymentApproval(f.request,"payment"));assert.equal(f.state.saves,0);assert.equal(f.repository.listOutbox("merchant").length,0);
  });
test("normal frozen completion requires actual order transaction",async()=>{
  const f=setup(false);await assert.rejects(f.useCase.executePaymentApproval(f.request,"payment"));assert.equal(f.state.reads,0);
});
test("public completion body never opts into normal journal authority",async()=>{
  const f=setup();await assert.rejects(f.useCase.execute({...f.request,normalCrossSellAuthority:f.authority} as CompleteOrderRequest));assert.equal(f.state.guards,0);
});
test("normal accepted offer absent from SDK request is linked from the actual frozen owner, never dropped",async()=>{
  const f=setup(),a=f.authority;
  a.discountOwner={kind:"accepted_offer",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",discountCents:100,
    authorizationEventId:"authorization",authorizedOfferId:"actual-authorized-offer",acceptedOfferRowId:"actual-accepted-row",termsHash:"a".repeat(64)};
  a.frozenProjection.cart.currentDiscount=1;a.amountCents=12749;
  Object.assign(a.amountBreakdown,{discountCents:100,totalCents:12749,cartFingerprint:paymentCartFingerprint(a.frozenProjection)});
  Object.assign(f.actual,{amountCents:12749,approvedAmountCents:12749});f.actual.creation.input.amountCents=12749;
  Object.assign(f.approval,{amountCents:12749,approvedAmountCents:12749,normalCrossSellAuthority:structuredClone(a)});f.request.order_total=126;
  await f.useCase.executePaymentApproval(f.request,"payment");
  const order=f.repository.getCompletedOrder("merchant","checkout","provider")!;
  assert.equal(order.acceptedOfferId,"actual-authorized-offer");assert.equal(order.orderTotal,126);
  const completed=f.repository.listOutbox("merchant").find(event=>event.event_type==="order.completed")!;
  assert.equal(completed.payload.accepted_offer_id,"actual-authorized-offer");assert.equal(f.request.accepted_offer_id,undefined);
});
