import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { normalPaymentAuthorityFixture } from "../domain/normal-checkout-payment.fixture.js";
import type { PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import { createNormalCrossSellPaymentAdmission, type NormalCrossSellPaymentCurrent } from "./prisma-normal-cross-sell-payment-admission.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";

function virtualAdmission(type: "digital" | "service") {
  const f = fixture();
  for (const item of f.current.projectedCart.items) { Reflect.set(item, "productType", type); Reflect.set(item, "fulfillmentStrategy", type); }
  Reflect.set(f.current.stored.customer as object, "address", { stale: "not a delivery address" });
  Reflect.set(f.current.stored.customer as object, "address_verified", false);
  f.snapshot.amountCents -= f.snapshot.amountBreakdown!.shippingCents;
  f.snapshot.creation!.input.amountCents = f.snapshot.amountCents;
  Object.assign(f.snapshot.amountBreakdown!, { shippingCents: 0, totalCents: f.snapshot.amountCents,
    cartFingerprint: paymentCartFingerprint({ cart: f.current.projectedCart, shipping: undefined }) });
  return f;
}
for (const type of ["digital", "service"] as const) test(`actual-reader ${type} admission freezes no stale shipping or unnecessary delivery PII`, async () => {
  const f = virtualAdmission(type), authority = await f.capture(f.tx, f.snapshot);
  assert.equal(authority.frozenProjection.shipping, undefined); assert.equal(authority.frozenProjection.customer.address, undefined);
  assert.equal(authority.frozenProjection.customer.address_verified, undefined); assert.equal(authority.amountBreakdown.shippingCents, 0);
  assert.equal(authority.frozenProjection.cart.items[1]!.fulfillmentStrategy, type);
  firstSend(f, authority);
  f.current.stored.shipping = { customerPrice: 999, stale: true };
  assert.deepEqual(await f.capture(f.tx, f.snapshot), authority, "irrelevant stored delivery must not become a virtual charge");
});
test("virtual admission refuses a nonzero delivery amount before creating or sending a payment", async () => {
  const f = virtualAdmission("digital"); f.snapshot.amountBreakdown!.shippingCents = 100;
  f.snapshot.amountCents += 100; f.snapshot.creation!.input.amountCents += 100; f.snapshot.amountBreakdown!.totalCents += 100;
  await assert.rejects(f.capture(f.tx, f.snapshot)); assert.equal(f.state.row, null);
});
test("mixed digital and physical admission retains the real delivery requirement", async () => {
  const f = fixture(); Reflect.set(f.current.projectedCart.items[1]!, "productType", "digital");
  Reflect.set(f.current.projectedCart.items[1]!, "fulfillmentStrategy", "digital");
  const authority = await f.capture(f.tx, f.snapshot); assert.equal(authority.amountBreakdown.shippingCents, 900);
  f.current.stored.shipping = undefined; await assert.rejects(f.capture(f.tx, f.snapshot));
});

function fixture(){
  const f=normalPaymentAuthorityFixture(),state={row:null as Record<string,unknown>|null,calls:[] as unknown[]};
  const {normalCrossSellAuthority:_authority,...creation}=f.scope.creation;
  const snapshot={...f.scope,version:0,idempotencyKey:"key",status:"pending",statusHistory:[],creation:{...creation,state:"ready"}} as PaymentIntentSnapshot;
  const current:NormalCrossSellPaymentCurrent={stored:{merchantId:"merchant",sessionId:"checkout",version:9,strategyContextVersion:4,globalUserId:"buyer",
    customer:{...f.authority.frozenProjection.customer,otp_code:"PRIVATE_OTP"},shipping:f.authority.frozenProjection.shipping,paymentMethod:null},
    projectedCart:f.authority.frozenProjection.cart,contextHash:f.authority.contextHash,basisHash:f.authority.basisHash,
    acceptanceEventIds:["normal-acceptance"],now:new Date(f.authority.admittedAt)};
  const tx={paymentIntent:{findUnique:async()=>structuredClone(state.row)}} as unknown as Prisma.TransactionClient;
  const capture=createNormalCrossSellPaymentAdmission(async(actual,scope,options)=>{
    assert.equal(actual,tx);state.calls.push({scope,options});return structuredClone(current);
  },()=>149);
  return {...f,state,snapshot,current,tx,capture};
}
test("normal admission freezes canonical effective lines and actual evidence, never OTP/provider metadata",async()=>{
  const f=fixture(),before=structuredClone(f.snapshot),result=await f.capture(f.tx,f.snapshot);
  assert.equal(result.frozenProjection.cart.items[1]!.price,18);assert.deepEqual(result.acceptanceEventIds,["normal-acceptance"]);
  assert.deepEqual(f.snapshot,before);assert.equal(JSON.stringify(result).includes("PRIVATE_OTP"),false);
  assert.deepEqual(f.state.calls,[{scope:{merchantId:"merchant",sessionId:"checkout"},options:undefined}]);
});
function firstSend(f:ReturnType<typeof fixture>,authority:ReturnType<typeof normalPaymentAuthorityFixture>["authority"]){
  f.snapshot.creation!.normalCrossSellAuthority=authority;f.snapshot.version=1;
  f.state.row={...structuredClone(f.snapshot),providerPaymentId:null,acceptedOfferId:null,commerceOrderId:null};
  f.snapshot.creation={...f.snapshot.creation!,state:"in_flight",firstAttemptAt:"2026-10-20T12:00:01Z"};f.state.calls=[];
}
test("first send revalidates same transaction and excludes only exact proven own ready journal",async()=>{
  const f=fixture(),authority=await f.capture(f.tx,f.snapshot);firstSend(f,authority);
  assert.deepEqual(await f.capture(f.tx,f.snapshot),authority);
  assert.deepEqual(f.state.calls,[{scope:{merchantId:"merchant",sessionId:"checkout"},options:{ownPayment:{paymentId:"payment",version:1}}}]);
});
for(const field of ["version","status","providerPaymentId","scope","authority","attempt","state"])
  test(`first send rejects unproved own journal ${field} before canonical callback`,async()=>{
    const f=fixture(),authority=await f.capture(f.tx,f.snapshot);firstSend(f,authority);const row=f.state.row!;
    if(field==="scope")row.merchantId="foreign";
    else if(field==="authority")Reflect.deleteProperty(row.creation as object,"normalCrossSellAuthority");
    else if(field==="attempt")Reflect.set(row.creation as object,"firstAttemptAt","2026-10-20T12:00:00Z");
    else if(field==="state")Reflect.set(row.creation as object,"state","uncertain");
    else Reflect.set(row,field,field==="version"?2:"foreign");
    await assert.rejects(f.capture(f.tx,f.snapshot));assert.equal(f.state.calls.length,0);
  });
for(const field of ["price","shipping","context","version","event","buyer","fee","verified","intent"])
  test(`canonical changed ${field} cannot silently rewrite first-send admitted data`,async()=>{
    const f=fixture(),authority=await f.capture(f.tx,f.snapshot);firstSend(f,authority);
    if(field==="price")f.current.projectedCart.items[1]!.price=19;
    if(field==="shipping")Reflect.set(f.current.stored.shipping as object,"customerPrice",10);
    if(field==="context")f.current.contextHash="b".repeat(64);
    if(field==="version")f.current.stored.version++;
    if(field==="event")f.current.acceptanceEventIds=["other"];
    if(field==="buyer")f.current.stored.globalUserId="foreign";
    if(field==="fee")f.snapshot.amountBreakdown!.platformFeeCents++;
    if(field==="verified")Reflect.set(f.current.stored.customer as object,"email_verified",false);
    if(field==="intent")Reflect.deleteProperty(f.current.projectedCart.items[1]! as object,"crossSellIntent");
    const before=structuredClone(f.snapshot);await assert.rejects(f.capture(f.tx,f.snapshot));assert.deepEqual(f.snapshot,before);
  });
test("caller cannot precapture a new journal",async()=>{
  const f=fixture();f.snapshot.creation!.normalCrossSellAuthority=f.authority;
  await assert.rejects(f.capture(f.tx,f.snapshot));assert.equal(f.state.calls.length,0);
});
function couponFixture(){
  const f=fixture();f.current.projectedCart.currentDiscount=1;
  const fingerprint=paymentCartFingerprint({cart:f.current.projectedCart,shipping:f.authority.frozenProjection.shipping});
  f.snapshot.amountCents-=100;f.snapshot.creation!.input.amountCents-=100;
  Object.assign(f.snapshot.amountBreakdown!,{discountCents:100,totalCents:f.snapshot.amountCents,cartFingerprint:fingerprint});
  f.current.discountOwner={kind:"checkout_coupon",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",reservationBuyerId:"buyer",
    couponId:"coupon",redemptionId:"reservation",code:"SAVE",discountCents:100,applicationEventId:"coupon-event",reservationUpdatedAt:f.current.now.toISOString()};
  return f;
}
test("standalone normal coupon freezes a distinct actual-reader owner without fabricating storefront binding",async()=>{
  const f=couponFixture(),authority=await f.capture(f.tx,f.snapshot);
  assert.deepEqual(authority.discountOwner,f.current.discountOwner);
  assert.equal(authority.frozenProjection.cart.cart_ref,undefined);
  assert.equal(f.snapshot.creation!.couponAuthority,undefined);
  firstSend(f,authority);assert.deepEqual(await f.capture(f.tx,f.snapshot),authority);
});
for(const change of ["absent","tenant","D","generation"])
  test(`normal coupon first-send owner ${change} is not a new or weaker grant`,async()=>{
    const f=couponFixture(),authority=await f.capture(f.tx,f.snapshot);firstSend(f,authority);
    if(change==="absent")delete f.current.discountOwner;
    else if(change==="tenant")f.current.discountOwner!.merchantId="foreign";
    else if(change==="D")f.current.discountOwner!.discountCents=101;
    else if(f.current.discountOwner?.kind==="checkout_coupon")f.current.discountOwner.reservationUpdatedAt=new Date(0).toISOString();
    await assert.rejects(f.capture(f.tx,f.snapshot));
  });
for(const supplied of [undefined,"authorized-offer"])
  test(`actual accepted-offer owner permits SDK offer reference ${String(supplied)} without manufacturing a client grant`,async()=>{
    const f=couponFixture();f.current.discountOwner={kind:"accepted_offer",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",discountCents:100,
      authorizationEventId:"authorization",authorizedOfferId:"authorized-offer",acceptedOfferRowId:"accepted-row",termsHash:"a".repeat(64)};
    if(supplied!==undefined)f.snapshot.acceptedOfferId=supplied;
    const before=structuredClone(f.snapshot),authority=await f.capture(f.tx,f.snapshot);
    assert.equal(authority.discountOwner?.kind,"accepted_offer");assert.deepEqual(f.snapshot,before);
    firstSend(f,authority);f.state.row!.acceptedOfferId=supplied??null;
    assert.deepEqual(await f.capture(f.tx,f.snapshot),authority);
  });
test("a supplied offer reference cannot disagree with actual accepted-offer ownership",async()=>{
  const f=couponFixture();f.current.discountOwner={kind:"accepted_offer",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",discountCents:100,
    authorizationEventId:"authorization",authorizedOfferId:"authorized-offer",acceptedOfferRowId:"accepted-row",termsHash:"a".repeat(64)};
  f.snapshot.acceptedOfferId="different-offer";await assert.rejects(f.capture(f.tx,f.snapshot));
});
