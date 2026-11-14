import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { normalPaymentAuthorityFixture } from "./normal-checkout-payment.fixture.js";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "./payment-intent.entity.js";
import { parseNormalCheckoutPaymentAuthority } from "./normal-checkout-payment-authority.schemas.js";
import { createNormalCrossSellPaymentAdmission, type NormalCrossSellPaymentCurrent } from "../infrastructure/prisma-normal-cross-sell-payment-admission.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import { assertNormalCrossSellPaymentOrderInTransaction } from "../../checkout/infrastructure/adapters/normal-cross-sell-payment-order-authority.js";

// Stubbed canonical reader exercises the frozen contract and anti-substitution
// boundary. Real source receipts/policy are proved by PostgreSQL separately.
function fixture(storefront=false){
  const base=normalPaymentAuthorityFixture(),cart=structuredClone(base.authority.frozenProjection.cart);
  Object.assign(cart,{currentDiscount:15,commercialBenefitsVersion:2});
  if(storefront)Object.assign(cart,{source:"storefront",cart_ref:"source-cart"});
  const amountBreakdown={...base.authority.amountBreakdown,discountCents:1500,cashbackCents:1500,
    cashbackReservationId:"cash-reservation",cashbackEarningQuoteId:"cash-quote",cartFingerprint:paymentCartFingerprint({cart,shipping:base.authority.frozenProjection.shipping})};
  amountBreakdown.totalCents=amountBreakdown.itemsSubtotalCents-3000+amountBreakdown.shippingCents+amountBreakdown.platformFeeCents;
  const {normalCrossSellAuthority:_old,...creation}=base.scope.creation;
  const snapshot={...base.scope,version:0,amountCents:amountBreakdown.totalCents,amountBreakdown,idempotencyKey:"key",status:"pending",statusHistory:[],
    creation:{...creation,state:"ready",input:{...creation.input,amountCents:amountBreakdown.totalCents}}} as PaymentIntentSnapshot;
  const identity={merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer"};
  const current:NormalCrossSellPaymentCurrent={stored:{merchantId:"merchant",sessionId:"checkout",version:9,strategyContextVersion:4,globalUserId:"buyer",
    customer:structuredClone(base.authority.frozenProjection.customer),shipping:base.authority.frozenProjection.shipping,paymentMethod:null},projectedCart:cart,
    contextHash:base.authority.contextHash,basisHash:base.authority.basisHash,acceptanceEventIds:["normal-acceptance"],now:new Date(base.authority.admittedAt),
    discountOwner:{kind:"cashback_combination",version:1,...identity,discountCents:1500,commercialBenefitsVersion:2,cashbackRuleVersion:1,journalHash:"c".repeat(64),
      coupon:storefront?{kind:"storefront_coupon",...identity,cartId:"source-cart",reservationBuyerId:"buyer",couponId:"coupon",redemptionId:"redemption",code:"SAVE",discountCents:1000}
        :{kind:"checkout_coupon",...identity,reservationBuyerId:"buyer",couponId:"coupon",redemptionId:"redemption",code:"SAVE",discountCents:1000,applicationEventId:"coupon-event",reservationUpdatedAt:base.authority.admittedAt},
      advanced:{kind:"accepted_offer",...identity,discountCents:500,authorizationEventId:"offer-event",authorizedOfferId:"offer",acceptedOfferRowId:"accepted",termsHash:"a".repeat(64)}}};
  if(storefront)snapshot.creation!.couponAuthority={version:2,...identity,cartId:"source-cart",bindingId:"21f906dd-c465-4ae8-9ecf-15f6e2d7c575",reservationBuyerId:"buyer",
    couponId:"coupon",redemptionId:"redemption",discountCents:1000,combinedDiscountCents:1500,commercialBenefitsVersion:2,basisHash:"b".repeat(64)};
  let row:Record<string,unknown>|null=null;
  const tx={paymentIntent:{findUnique:async()=>structuredClone(row)}} as unknown as Prisma.TransactionClient;
  const capture=createNormalCrossSellPaymentAdmission(async()=>structuredClone(current),()=>amountBreakdown.platformFeeCents);
  return {snapshot,current,tx,capture,firstSend:(authority:ReturnType<typeof parseNormalCheckoutPaymentAuthority>)=>{
    snapshot.creation!.normalCrossSellAuthority=authority;snapshot.version=1;
    row={...structuredClone(snapshot),providerPaymentId:null,acceptedOfferId:snapshot.acceptedOfferId??null,commerceOrderId:null};
    snapshot.creation={...snapshot.creation!,state:"in_flight",firstAttemptAt:"2026-11-14T12:00:00Z"};
  }};
}

for(const storefront of [false,true])test(`CR-02 CS-06 normal V2 freezes separate C/A/cash with ${storefront?"storefront":"normal"} coupon authority`,async()=>{
  const f=fixture(storefront),admitted=await f.capture(f.tx,f.snapshot);
  assert.equal(admitted.version,2);assert.equal(admitted.discountOwner?.kind,"cashback_combination");
  assert.equal(admitted.frozenProjection.cart.commercialBenefitsVersion,2);
  assert.equal(admitted.amountBreakdown.discountCents,1500);
  assert.equal(admitted.version===2&&admitted.amountBreakdown.cashbackCents,1500);
  f.firstSend(admitted);assert.deepEqual(await f.capture(f.tx,f.snapshot),admitted);
  assert.equal(PaymentIntentEntity.rehydrate(f.snapshot).snapshot().creation?.normalCrossSellAuthority?.version,2);
});

test("CR-02 CS-07 legacy normal V1 remains parseable and cannot silently accept new cash fields",()=>{
  const f=normalPaymentAuthorityFixture();assert.deepEqual(parseNormalCheckoutPaymentAuthority(f.authority),f.authority);
  assert.throws(()=>parseNormalCheckoutPaymentAuthority({...f.authority,amountBreakdown:{...f.authority.amountBreakdown,cashbackCents:0}}),/authority_conflict/);
});

for(const changed of ["coupon","advanced","version","journal"] as const)test(`CR-02 CS-05 first send refuses substituted compound ${changed} proof`,async()=>{
  const f=fixture(),admitted=await f.capture(f.tx,f.snapshot);f.firstSend(admitted);
  const owner=f.current.discountOwner!;assert.equal(owner.kind,"cashback_combination");if(owner.kind!=="cashback_combination")assert.fail();
  if(changed==="coupon")owner.coupon!.redemptionId="other-redemption";
  if(changed==="advanced"&&owner.advanced?.kind==="accepted_offer")owner.advanced.authorizedOfferId="other-offer";
  if(changed==="version")owner.commercialBenefitsVersion++;
  if(changed==="journal")owner.journalHash="e".repeat(64);
  await assert.rejects(f.capture(f.tx,f.snapshot),/authority_conflict/);
});

for(const changed of ["missing","amount","version"] as const)test(`CR-02 CS-06 compound storefront coupon requires its exact independent ${changed} binding`,async()=>{
  const f=fixture(true);
  if(changed==="missing")delete f.snapshot.creation!.couponAuthority;
  else if(changed==="amount")f.snapshot.creation!.couponAuthority!.discountCents=900;
  else if(f.snapshot.creation!.couponAuthority?.version===2)f.snapshot.creation.couponAuthority.commercialBenefitsVersion=3;
  await assert.rejects(f.capture(f.tx,f.snapshot),/authority_conflict/);
});

test("CR-02 CS-06 accepted offer reference resolves through compound advanced owner and rejects a different offer",async()=>{
  const f=fixture();f.snapshot.acceptedOfferId="offer";const admitted=await f.capture(f.tx,f.snapshot);
  f.firstSend(admitted);assert.equal(PaymentIntentEntity.rehydrate(f.snapshot).snapshot().acceptedOfferId,"offer");
  assert.throws(()=>PaymentIntentEntity.rehydrate({...f.snapshot,acceptedOfferId:"foreign-offer"}),/authority_conflict/);
});

test("CR-02 CS-06 frozen compound completion emits only coupon C to redemption and retains advanced offer ownership",async()=>{
  const f=fixture(),authority=await f.capture(f.tx,f.snapshot),repository=new InMemoryCheckoutRepository();
  const actual={...f.snapshot,version:3,status:"approved",approvedAmountCents:f.snapshot.amountCents,providerPaymentId:"provider",acceptedOfferId:null,
    creation:{...f.snapshot.creation!,normalCrossSellAuthority:authority}};
  const approval={...actual,normalCrossSellAuthority:authority,amountBreakdown:f.snapshot.amountBreakdown!};
  const tx={$queryRaw:async()=>[],paymentIntent:{findFirst:async()=>actual}} as unknown as Prisma.TransactionClient;
  const commit={assertNormalCrossSellPaymentOrderAuthority:(merchantId:string,sessionId:string,expected:unknown,id:string,provider:string)=>
    assertNormalCrossSellPaymentOrderInTransaction(tx,merchantId,sessionId,expected,id,provider),
    saveCompletedOrder:repository.saveCompletedOrder.bind(repository),recordEvent:async()=>undefined,
    appendOutbox:repository.appendOutbox.bind(repository)};
  repository.getSession=()=>{throw Error("current_session_must_not_reprice_frozen_payment");};
  const runner={transaction:async<T>(work:(repo:typeof commit)=>Promise<T>)=>work(commit)};
  const command=new CompleteOrderUseCase(repository,repository,repository,undefined,undefined,undefined,undefined,runner,
    undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,{find:async()=>approval},undefined,
    {confirmedPayment:async()=>({usedCents:1500,grantedCents:350})} as never);
  const orderTotal=(actual.amountCents-authority.amountBreakdown.platformFeeCents)/100;
  await command.executePaymentApproval({merchant_id:"merchant",session_id:"checkout",external_order_id:"provider",currency:"BRL",order_total:orderTotal},actual.id);
  const event=repository.listOutbox("merchant").find(value=>value.event_type==="order.completed")!;
  assert.equal((event.payload.normal_coupon_owner as {discountCents:number}).discountCents,1000);
  assert.deepEqual(event.payload.normal_coupon_owner,authority.discountOwner?.kind==="cashback_combination"?authority.discountOwner.coupon:undefined);
  assert.equal(event.payload.accepted_offer_id,"offer");
  assert.equal(repository.getCompletedOrder("merchant","checkout","provider")?.acceptedOfferId,"offer");
  assert.equal(repository.getCompletedOrder("merchant","checkout","provider")?.orderTotal,orderTotal);
});
