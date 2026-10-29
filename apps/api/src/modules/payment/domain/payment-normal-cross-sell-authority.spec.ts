import assert from "node:assert/strict";
import test from "node:test";
import { normalPaymentAuthorityFixture } from "./normal-checkout-payment.fixture.js";
import { readPaymentNormalCrossSellAuthority, assertSamePaymentNormalCrossSellAuthority,
  assertNormalCrossSellOwnPaymentForFirstSend, assertNoPaymentNormalCrossSellAuthorityInProviderInput } from "./payment-normal-cross-sell-authority.js";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "./payment-intent.entity.js";
import { InMemoryPaymentRepository } from "../infrastructure/in-memory-payment.repository.js";
import { ResumePaymentCreationService } from "../application/resume-payment-creation.service.js";
import type { PaymentProviderPort } from "./ports/payment-provider.port.js";
import { parseNormalCheckoutPaymentAuthority } from "./normal-checkout-payment-authority.schemas.js";
import { paymentCartFingerprint } from "../../checkout/domain/services/payment-cart-fingerprint.js";

function virtualAuthority(type: "digital" | "service") {
  const { authority } = normalPaymentAuthorityFixture(), projection = authority.frozenProjection;
  for (const item of projection.cart.items) { Reflect.set(item, "productType", type); Reflect.set(item, "fulfillmentStrategy", type); }
  Reflect.deleteProperty(projection, "shipping");
  Reflect.deleteProperty(projection.customer, "address"); Reflect.deleteProperty(projection.customer, "address_verified");
  authority.amountCents -= authority.amountBreakdown.shippingCents;
  Object.assign(authority.amountBreakdown, { shippingCents: 0, totalCents: authority.amountCents, cartFingerprint: paymentCartFingerprint(projection) });
  return authority;
}
for (const type of ["digital", "service"] as const) test(`normal frozen ${type} uses no invented delivery quote or address`, () => {
  const parsed = parseNormalCheckoutPaymentAuthority(virtualAuthority(type));
  assert.equal(parsed.frozenProjection.shipping, undefined); assert.equal(parsed.frozenProjection.customer.address, undefined);
  assert.equal(parsed.amountBreakdown.shippingCents, 0); assert.equal(parsed.frozenProjection.cart.items[1]!.price, 18);
});
for (const [type, strategy] of [["physical", "digital"], ["food", "service"], ["digital", "carrier"], ["service", "digital"], ["service", "scheduled_service"]])
  test(`normal frozen refuses incoherent fulfillment ${type}/${strategy}`, () => {
    const authority = virtualAuthority("service"), item = authority.frozenProjection.cart.items[1]!;
    Reflect.set(item, "productType", type); Reflect.set(item, "fulfillmentStrategy", strategy);
    assert.throws(() => parseNormalCheckoutPaymentAuthority(authority));
  });
for (const corruption of ["shipping", "shippingCents", "email", "schedule"]) test(`virtual frozen refuses ${corruption} rather than inventing authority`, () => {
  const authority = virtualAuthority("digital");
  if (corruption === "shipping") Reflect.set(authority.frozenProjection, "shipping", normalPaymentAuthorityFixture().authority.frozenProjection.shipping);
  if (corruption === "shippingCents") { authority.amountBreakdown.shippingCents = 100; authority.amountCents += 100; authority.amountBreakdown.totalCents += 100; }
  if (corruption === "email") Reflect.set(authority.frozenProjection.customer, "email_verified", false);
  if (corruption === "schedule") Reflect.set(authority.frozenProjection.cart.items[1]!, "fulfillmentSchedule", { slotId: "unproved" });
  assert.throws(() => parseNormalCheckoutPaymentAuthority(authority));
});
for (const type of ["physical", "food"] as const) test(`mixed ${type}/digital frozen retains actual delivery and verified address`, () => {
  const { authority } = normalPaymentAuthorityFixture(), target = authority.frozenProjection.cart.items[1]!;
  Reflect.set(authority.frozenProjection.cart.items[0]!, "productType", type);
  Reflect.set(target, "productType", "digital"); Reflect.set(target, "fulfillmentStrategy", "digital");
  assert.equal(parseNormalCheckoutPaymentAuthority(authority).amountBreakdown.shippingCents, 900);
  for (const field of ["shipping", "address", "verified"]) {
    const changed = structuredClone(authority);
    if (field === "shipping") Reflect.deleteProperty(changed.frozenProjection, "shipping");
    if (field === "address") Reflect.deleteProperty(changed.frozenProjection.customer, "address");
    if (field === "verified") Reflect.set(changed.frozenProjection.customer, "address_verified", false);
    assert.throws(() => parseNormalCheckoutPaymentAuthority(changed));
  }
});

function couponOnlyAuthority(){
  const {authority}=normalPaymentAuthorityFixture(),cart=authority.frozenProjection.cart;
  cart.items=cart.items.filter(item=>item.sku==="TRIGGER");cart.total=100;cart.currentDiscount=1;
  cart.discountBudget={version:1,originalSubtotalCents:10000,promotionDiscountCents:0};
  authority.amountCents=10949;authority.amountBreakdown={...authority.amountBreakdown,cartFingerprint:paymentCartFingerprint(authority.frozenProjection),
    itemsSubtotalCents:10000,discountCents:100,totalCents:10949};
  authority.discountOwner={kind:"checkout_coupon",merchantId:"merchant",checkoutSessionId:"checkout",buyerId:"buyer",reservationBuyerId:"buyer",
    couponId:"coupon",redemptionId:"reservation",code:"SAVE",discountCents:100,applicationEventId:"coupon-applied",reservationUpdatedAt:authority.admittedAt};
  return authority;
}

test("normal coupon owner can remain frozen after all promotion targets were removed and P became zero",()=>{
  const authority=couponOnlyAuthority(),parsed=parseNormalCheckoutPaymentAuthority(authority);
  assert.equal(parsed.discountOwner?.kind,"checkout_coupon");assert.equal(parsed.frozenProjection.cart.discountBudget.promotionDiscountCents,0);
  assert.equal(parsed.frozenProjection.cart.items.some(item=>item.crossSellIntent),false);
});

test("normal frozen owner preserves coherent historical P200 plus D100 after every new target was removed",()=>{
  const authority=couponOnlyAuthority(),cart=authority.frozenProjection.cart;
  cart.items[0]!.price=98;cart.items[0]!.originalPrice=100;cart.total=98;
  cart.discountBudget={version:1,originalSubtotalCents:10000,promotionDiscountCents:200};
  authority.amountCents=10749;authority.amountBreakdown={...authority.amountBreakdown,cartFingerprint:paymentCartFingerprint(authority.frozenProjection),
    itemsSubtotalCents:9800,totalCents:10749};
  const parsed=parseNormalCheckoutPaymentAuthority(authority);
  assert.equal(parsed.discountOwner?.kind,"checkout_coupon");assert.equal(parsed.frozenProjection.cart.discountBudget.promotionDiscountCents,200);
  assert.equal(parsed.frozenProjection.cart.items.some(item=>item.crossSellIntent),false);
});

for(const invalid of ["owner","history","D0","incoherentP"])
  test(`zero-intent frozen normal still refuses missing or inconsistent ${invalid}`,()=>{
    const authority=couponOnlyAuthority();
    if(invalid==="owner")delete authority.discountOwner;
    if(invalid==="history")authority.acceptanceEventIds=[];
    if(invalid==="D0")authority.frozenProjection.cart.currentDiscount=0;
    if(invalid==="incoherentP")authority.frozenProjection.cart.discountBudget.promotionDiscountCents=100;
    assert.throws(()=>parseNormalCheckoutPaymentAuthority(authority),/payment_normal_cross_sell_authority_conflict/);
  });

test("normal journal is strict detached metadata, distinct from widget authority", () => {
  const f=normalPaymentAuthorityFixture(), parsed=readPaymentNormalCrossSellAuthority(f.scope)!;
  assert.equal(parsed.origin,"normal_checkout_cross_sell");
  assert.equal(parsed.frozenProjection.cart.items[1]!.crossSellIntent!.maximumUnitPriceCents,1800);
  f.authority.frozenProjection.cart.items[1]!.price=999;
  assert.equal(parsed.frozenProjection.cart.items[1]!.price,18);
});
test("frozen normal quantity may be decreased within the original accepted limit",()=>{
  const f=normalPaymentAuthorityFixture();f.authority.frozenProjection.cart.items[1]!.crossSellIntent!.acceptedQuantity=2;
  assert.equal(readPaymentNormalCrossSellAuthority(f.scope)!.frozenProjection.cart.items[1]!.quantity,1);
});
for(const field of ["amountCents","merchantId","checkoutSessionId","buyerId","method","acceptanceEventIds","origin","contextHash"])
  test(`normal stored sibling refuses corrupted ${field}`,()=>{
    const f=normalPaymentAuthorityFixture();Reflect.set(f.authority,field,field==="amountCents"?1:field==="acceptanceEventIds"?[]:"foreign");
    assert.throws(()=>readPaymentNormalCrossSellAuthority(f.scope),/payment_normal_cross_sell_authority_conflict/);
  });
for(const value of [undefined,null,{}])test(`normal presence cannot degrade to legacy: ${String(value)}`,()=>{
  const f=normalPaymentAuthorityFixture();Reflect.set(f.scope.creation,"normalCrossSellAuthority",value);
  assert.throws(()=>readPaymentNormalCrossSellAuthority(f.scope));
});
for(const key of ["normalCrossSellAuthority","normal_cross_sell_authority","normalCrossSellScope"])
  test(`normal metadata never enters provider input: ${key}`,()=>{
    assert.throws(()=>assertNoPaymentNormalCrossSellAuthorityInProviderInput({[key]:null}));
    assert.throws(()=>assertNoPaymentNormalCrossSellAuthorityInProviderInput(Object.create({[key]:undefined})));
  });
for(const mode of ["accessor","inherited","nonenumerable"])
  test(`normal ${mode} sibling cannot be erased by cloning`,()=>{
    const f=normalPaymentAuthorityFixture(),input=f.scope.creation.input;
    const creation=mode==="inherited"?Object.assign(Object.create({normalCrossSellAuthority:f.authority}),{input}):{input};
    if(mode==="accessor")Object.defineProperty(creation,"normalCrossSellAuthority",{enumerable:true,get(){throw new Error("PRIVATE");}});
    if(mode==="nonenumerable")Object.defineProperty(creation,"normalCrossSellAuthority",{value:f.authority});
    assert.throws(()=>readPaymentNormalCrossSellAuthority({...f.scope,creation}),/^Error: payment_normal_cross_sell_authority_conflict$/);
  });
test("normal authority cannot be attached, dropped or replaced on recovery",()=>{
  const f=normalPaymentAuthorityFixture(),legacy={...f.scope,creation:{input:f.scope.creation.input}};
  assert.throws(()=>assertSamePaymentNormalCrossSellAuthority(f.scope,legacy));
  assert.throws(()=>assertSamePaymentNormalCrossSellAuthority(legacy,f.scope));
  const changed=structuredClone(f.scope);changed.creation.normalCrossSellAuthority.acceptanceEventIds=["other"];
  assert.throws(()=>assertSamePaymentNormalCrossSellAuthority(f.scope,changed));
});
function actual(){const f=normalPaymentAuthorityFixture();return {...f.scope,idempotencyKey:"key",version:1,status:"pending",providerPaymentId:null,
  creation:{...f.scope.creation,state:"ready"},statusHistory:[]};}
test("own-row exception requires real ready scoped admitted row",()=>{
  assertNormalCrossSellOwnPaymentForFirstSend(actual(),{paymentId:"payment",version:1,merchantId:"merchant",sessionId:"checkout"});
});
for(const change of ["id","version","merchantId","sessionId","status","providerPaymentId","firstAttemptAt","state","cancellation","authority"])
  test(`own-row exception refuses ${change}`,()=>{
    const row=actual();
    if(["firstAttemptAt","state","cancellation"].includes(change))Reflect.set(row.creation,change,change==="state"?"uncertain":"present");
    else if(change==="authority")Reflect.deleteProperty(row.creation,"normalCrossSellAuthority");
    else Reflect.set(row,change,change==="version"?2:"foreign");
    assert.throws(()=>assertNormalCrossSellOwnPaymentForFirstSend(row,{paymentId:"payment",version:1,merchantId:"merchant",sessionId:"checkout"}));
  });
test("entity preserves frozen normal identity through uncertain recovery",()=>{
  const f=actual(), entity=PaymentIntentEntity.rehydrate(f as unknown as PaymentIntentSnapshot);
  entity.claimCreation("lease",new Date("2026-10-20T12:00:01Z"));entity.markCreationUncertain("lease","lost_ack");
  const recovered=PaymentIntentEntity.rehydrate(entity.snapshot());
  assertSamePaymentNormalCrossSellAuthority(f,recovered.snapshot());
});
test("actual dispatcher sends provider input only, never normal snapshot/evidence or buyer address",async()=>{
  const snapshot={...actual(),version:0,providerPaymentId:undefined} as unknown as PaymentIntentSnapshot,repo=new InMemoryPaymentRepository();
  const entity=PaymentIntentEntity.rehydrate(snapshot);await repo.saveIntent({intent:entity});let creates=0;
  const provider:PaymentProviderPort={createPayment:async input=>{
    creates++;assert.deepEqual(input,snapshot.creation!.input);
    for(const key of ["normalCrossSellAuthority","acceptanceEventIds","frozenProjection","crossSellIntent","customer"])
      assert.equal(JSON.stringify(input).includes(key),false);
    return {providerPaymentId:"synthetic-provider",status:"requires_action",buyerFacingPayload:{qrCodeCopyPaste:"synthetic-pix"}};
  }};
  const result=await new ResumePaymentCreationService(repo,provider).execute(entity);
  assert.equal(creates,1);assert.deepEqual(result.creation!.normalCrossSellAuthority,snapshot.creation!.normalCrossSellAuthority);
});
test("normal uncertain dispatch recovers without re-CREATE and retains immutable admitted evidence",async()=>{
  const snapshot={...actual(),version:0,providerPaymentId:undefined} as unknown as PaymentIntentSnapshot,repo=new InMemoryPaymentRepository();
  const entity=PaymentIntentEntity.rehydrate(snapshot);await repo.saveIntent({intent:entity});let creates=0,lookups=0;
  const provider:PaymentProviderPort={createPayment:async()=>{creates++;throw new Error("synthetic_lost_ack");},
    recoverPayment:async input=>{lookups++;assert.deepEqual(input,snapshot.creation!.input);return null;}};
  const resume=new ResumePaymentCreationService(repo,provider);
  await assert.rejects(resume.execute(entity));const stored=(await repo.getIntentById("merchant","payment"))!;
  const uncertain=await resume.execute(stored);assert.equal(uncertain.creation!.state,"uncertain");assert.equal(uncertain.providerPaymentId,undefined);
  assert.equal(creates,1);assert.equal(lookups,1);
  assert.deepEqual((await repo.getIntentById("merchant","payment"))!.snapshot().creation!.normalCrossSellAuthority,snapshot.creation!.normalCrossSellAuthority);
});
