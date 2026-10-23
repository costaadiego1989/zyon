import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, type CheckoutSession as StoredSession } from "@prisma/client";
import { prepareNormalCommercialBenefits, applyNormalCommercialOffer } from "./prisma-normal-commercial-benefits.js";
import { normalCommercialBenefitAuthorizationSchema, NORMAL_COMMERCIAL_BENEFIT_EVENT } from "../../../checkout/domain/contracts/normal-commercial-benefit-proof.schemas.js";
import { normalCommercialBenefitBasis } from "../../../checkout/domain/services/normal-commercial-benefit-proof.js";
import type { Cart } from "@zyon/shared-types";
import { readNormalCheckoutCommercialBenefitOwner } from "../../../../shared/persistence/normal-checkout-commercial-benefits.js";

// Narrow repository doubles characterize orchestration/rollback; they do NOT
// prove SQL locks, public authentication, durable CAS, payment or HTTP behavior.
function fixture() {
  const now = new Date("2026-10-20T12:00:00Z"), cart:Cart = {currency:"BRL",total:135,currentDiscount:0,
    discountBudget:{version:1,originalSubtotalCents:15000,promotionDiscountCents:1500},items:[{
      sku:"SKU",variantId:"variant",product_id:"product",category:"category",name:"Canonical",quantity:1,price:135,originalPrice:150,
      variant:JSON.stringify(["variant",[]])}]};
  const stored:StoredSession = {id:"row",merchantId:"merchant",sessionId:"session",globalUserId:"buyer",conversationId:"conversation",
    cart:JSON.parse(JSON.stringify(cart)),customer:null,shipping:null,shippingOptions:null,abandonmentScore:0,triggerAgent:false,
    chatHistory:[],paymentMethod:null,promptVariantId:null,cohort:null,featuresApplied:null,aiCostCents:0,version:2,strategyContextVersion:0,
    createdAt:now,updatedAt:now};
  const state = {stored,cart,now,events:[] as Array<{id:string;merchantId:string;sessionId:string;eventName:string;occurredAt:Date;metadata:unknown}>,
    writes:[] as string[],cas:true,failEvent:false,staleAfterWrite:false,longFractionTransport:false,
    moneyCorruption:undefined as "discount"|"unit"|undefined,advancedRules:[] as unknown[],accepted:null as Record<string,unknown>|null,
    offer:{id:"offer",merchantId:"merchant",sessionId:"session",type:"discount_fixed",value:new Prisma.Decimal(10),approved:true,
      reason:"approved",marginAfterOffer:new Prisma.Decimal(0),expiresAt:new Date("2026-10-21Z"),discountCode:null}};
  const tx = {
    $queryRaw:async()=>[],checkoutSession:{findUnique:async()=>{
      const row={...state.stored,cart:JSON.parse(JSON.stringify(state.stored.cart)),...(state.staleAfterWrite&&state.stored.version>2?{version:99}:{})};
      if(state.stored.version>2){
        const nudge=row.cart.commercialNudge;
        if(state.longFractionTransport&&typeof nudge?.discountPercent==="number"&&(String(nudge.discountPercent).split(".")[1]?.length??0)>4)
          nudge.discountPercent+=Number.EPSILON*Math.max(1,Math.abs(nudge.discountPercent))*2;
        if(state.moneyCorruption==="discount")row.cart.currentDiscount-=.01;
        if(state.moneyCorruption==="unit")row.cart.items[0].price+=.01;
      }
      return row;},
      updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
      state.writes.push("session");if(!state.cas)return {count:0};
      // Mirror the REAL deployed trigger: application SET version is rejected;
      // DB alone increments after an UPDATE matching the original version.
      assert.equal(Object.hasOwn(data,"version"),false,"CHECKOUT_SESSION_VERSION_READ_ONLY");
      assert.equal(Object.hasOwn(data,"strategyContextVersion"),false,"STRATEGY_CONTEXT_VERSION_DB_OWNED");
      assert.equal(where.version,state.stored.version);assert.equal(where.globalUserId,state.stored.globalUserId);
      state.stored={...state.stored,...data,version:state.stored.version+1} as StoredSession;return{count:1};}},
    merchantRule:{findUnique:async()=>({merchantId:"merchant",maxDiscountPercent:new Prisma.Decimal(20),
      allowFreeShipping:false,allowShippingDiscount:false,allowBonusItem:false,allowStackDiscountAndFreeShipping:false,
      freeShippingMinCartValue:new Prisma.Decimal(0),maxShippingSubsidy:new Prisma.Decimal(0),maxPartialShippingDiscount:new Prisma.Decimal(0),
      offerExpirationMinutes:10,blockedRegions:[],brandVoice:"consultative",couponBoxEnabled:true,autonomousEngineEnabled:true})},
    checkoutSetting:{findUnique:async()=>({merchantId:"merchant",advancedRules:state.advancedRules,
      interventionPolicy:{progressiveDiscount:{enabled:true,stages:{payment_nudge:15}}}})},promptExperiment:{findMany:async()=>[]},
    checkoutEvent:{findMany:async({where}:{where:{eventName?:unknown}})=>state.events.filter(row=> typeof where.eventName==="string"?
      row.eventName===where.eventName:row.eventName!==NORMAL_COMMERCIAL_BENEFIT_EVENT),create:async({data}:{data:Omit<typeof state.events[number],"id">})=>{
      state.writes.push("event");if(state.failEvent&&data.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)throw new Error("journal_failed");
      const row={...data,id:`event-${state.events.length+1}`};state.events.push(row);return row;}},
    authorizedOffer:{findFirst:async()=>state.offer},acceptedOffer:{findFirst:async()=>state.accepted,create:async({data}:{data:Record<string,unknown>})=>{
      state.writes.push("accepted");state.accepted={...data,id:"accepted"};return state.accepted;}} };
  const current = () => ({stored:state.stored,now,source:undefined,coupon:undefined,discountOwner:undefined});
  const call = async(kind:"prepare"|"offer")=>{
    const before={stored:structuredClone(state.stored),events:structuredClone(state.events),accepted:state.accepted};
    try{return await(kind==="prepare"?prepareNormalCommercialBenefits(tx as unknown as Prisma.TransactionClient,current(),cart,{expectedVersion:2,method:"pix"}):
      applyNormalCommercialOffer(tx as unknown as Prisma.TransactionClient,current(),cart,{expectedVersion:2,offerId:"offer"}));}
    catch(error){state.stored=before.stored;state.events=before.events;state.accepted=before.accepted;throw error;}
  };
  return {state,call,tx:tx as unknown as Prisma.TransactionClient};
}
test("normal explicit preparation journals real stages and exact P+D headroom with one scoped CAS",async()=>{
  const f=fixture(),result=await f.call("prepare");
  assert.equal(result.session.cart.currentDiscount,15);assert.equal(result.session.persistenceVersion,3);
  const grant=normalCommercialBenefitAuthorizationSchema.parse(f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!.metadata);
  assert.equal(grant.discountCents,1500);assert.equal(grant.checkoutVersion,3);assert.equal(grant.paymentMethod,"pix");
  assert.equal(grant.basis.promotionDiscountCents+grant.discountCents,3000);assert.deepEqual(grant.stageEventIds,["event-1"]);
  assert.equal(f.state.writes.filter(value=>value==="session").length,1);
});
test("grant references exact actual context IDs; cross-sell context is not invented as an extra progressive stage",async()=>{
  const f=fixture();f.state.events.push({id:"actual-acceptance",merchantId:"merchant",sessionId:"session",eventName:"cross_sell_accepted",occurredAt:f.state.now,metadata:{}});
  const result=await f.call("prepare"),grant=normalCommercialBenefitAuthorizationSchema.parse(f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!.metadata);
  assert.deepEqual(grant.stageEventIds,["actual-acceptance","event-2"]);assert.equal(result.session.cart.currentDiscount,15);
  assert.equal(f.state.events.filter(row=>row.eventName==="payment_method_selected").length,1);
});
test("normal offer uses actual approved terms, accepted row and journal without inventing a method",async()=>{
  const f=fixture(),result=await f.call("offer");assert.equal(result.session.cart.currentDiscount,10);
  const grant=normalCommercialBenefitAuthorizationSchema.parse(f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!.metadata);
  assert.equal(grant.paymentMethod,undefined);assert.equal(grant.origin,"accepted_offer");assert.equal(grant.offer!.acceptedOfferRowId,"accepted");
  assert.equal(f.state.accepted!.offerId,"offer");assert.equal(grant.discountCents,1000);
});
test("offer above combined ceiling is refused before acceptance, journal or money write",async()=>{
  const f=fixture();f.state.offer.value=new Prisma.Decimal(20);await assert.rejects(f.call("offer"));assert.deepEqual(f.state.writes,[]);
});
for(const kind of ["prepare","offer"]as const)for(const failure of ["CAS","journal"]as const)test(`${kind} ${failure} failure propagates and transaction double rolls back`,async()=>{
  const f=fixture();if(failure==="CAS")f.state.cas=false;else f.state.failEvent=true;
  await assert.rejects(f.call(kind));assert.equal(f.state.stored.version,2);assert.equal(f.state.accepted,null);assert.deepEqual(f.state.events,[]);
});
test("automatic coupon selection creates no D, reservation or authorization journal",async()=>{
  const f=fixture();f.state.advancedRules=[{id:"coupon-rule",enabled:true,priority:1,conditions:[],action:{type:"offer_coupon",params:{code:"AUTO"}}}];
  const result=await f.call("prepare");assert.equal("couponCode"in result?result.couponCode:undefined,"AUTO");assert.equal(result.session.cart.currentDiscount,0);
  assert.ok(!f.state.events.some(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT));
  assert.deepEqual(normalCommercialBenefitBasis(result.session.cart),normalCommercialBenefitBasis(f.state.cart));
});
test("actual scoped policy/event reader proves fixed D after prepare without granting another amount",async()=>{
  const f=fixture(),result=await f.call("prepare"),before=structuredClone(f.state.stored);
  const owner=await readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now});
  assert.equal(owner!.kind,"checkout_policy");assert.equal(owner!.discountCents,1500);
  assert.equal(owner!.authorizationEventId,"event-2");assert.deepEqual(f.state.stored,before);
});
test("current canonical category survives approved-subset reconstruction in actual policy reader",async()=>{
  const f=fixture();f.state.advancedRules=[{id:"category-rule",enabled:true,priority:1,
    conditions:[{field:"category_in_cart",operator:"contains",value:"category"}],action:{type:"offer_discount",params:{percent:5}}}];
  const result=await f.call("prepare");assert.equal(result.session.cart.currentDiscount,6.75);
  const owner=await readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now});
  assert.equal(owner!.kind,"checkout_policy");assert.equal(owner!.discountCents,675);
  const changed=structuredClone(result.session.cart);changed.items[0]!.category="other-category";
  await assert.rejects(readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:changed,now:f.state.now}));
});

test("normal card alias uses the same first-match projection for writer and owner without changing raw settings hash",async()=>{
  const f=fixture();f.state.advancedRules=[{id:"later",enabled:true,priority:2,
    conditions:[{field:"payment_method",operator:"is",value:"card"}],action:{type:"offer_discount",params:{percent:15}}},
    {id:"first",enabled:true,priority:1,conditions:[{field:"payment_method",operator:"is",value:"credit_card"}],
      action:{type:"offer_discount",params:{percent:5}}}];
  const before=structuredClone(f.state.advancedRules);
  const result=await prepareNormalCommercialBenefits(f.tx,{stored:f.state.stored,now:f.state.now},f.state.cart,{expectedVersion:2,method:"card"});
  assert.equal(result.session.cart.currentDiscount,6.75);assert.equal(result.session.cart.commercialNudge?.kind,"advanced_rule");
  assert.equal(result.session.cart.commercialNudge?.ruleId,"first");assert.equal(f.state.stored.paymentMethod,"card");
  const grant=normalCommercialBenefitAuthorizationSchema.parse(f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!.metadata);
  assert.equal(grant.ruleId,"first");assert.equal(grant.discountCents,675);assert.equal(grant.paymentMethod,"card");
  const owner=await readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now});
  assert.equal(owner!.discountCents,675);assert.deepEqual(f.state.advancedRules,before);
  assert.equal(f.state.writes.filter(value=>value==="session").length,1);
  assert.equal(f.state.events.filter(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT).length,1);
  // Even a same-instrument configuration edit invalidates the RAW policy hash;
  // matching normalization must not erase a real administrative revision.
  f.state.advancedRules=[{id:"later",enabled:true,priority:2,
    conditions:[{field:"payment_method",operator:"is",value:"card"}],action:{type:"offer_discount",params:{percent:15}}},
    {id:"first",enabled:true,priority:1,conditions:[{field:"payment_method",operator:"is",value:"card"}],
      action:{type:"offer_discount",params:{percent:5}}}];
  await assert.rejects(readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now}));
  assert.equal(f.state.stored.version,3);assert.equal(result.session.cart.currentDiscount,6.75);
});

test("normal canonical card alias selects an actual coupon only through the existing coupon command result",async()=>{
  const f=fixture();f.state.advancedRules=[{id:"card-coupon",enabled:true,priority:1,
    conditions:[{field:"payment_method",operator:"is",value:"credit_card"}],action:{type:"offer_coupon",params:{code:"AUTO"}}}];
  const result=await prepareNormalCommercialBenefits(f.tx,{stored:f.state.stored,now:f.state.now},f.state.cart,{expectedVersion:2,method:"card"});
  assert.equal(result.couponCode,"AUTO");assert.equal(result.session.cart.currentDiscount,0);
  assert.equal(f.state.events.some(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT),false);
  assert.equal(f.state.accepted,null);
});
test("accepted offer reader proves actual accepted row and works before any payment method exists",async()=>{
  const f=fixture(),result=await f.call("offer");
  const owner=await readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now});
  assert.ok(owner,"offer owner required");assert.equal(owner.kind,"accepted_offer");if(owner.kind!=="accepted_offer")assert.fail("offer owner required");
  assert.equal(owner.authorizedOfferId,"offer");assert.equal(owner.acceptedOfferRowId,"accepted");
  f.state.stored.paymentMethod="card";
  assert.equal((await readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now}))!.kind,"accepted_offer");
});
for(const corruption of ["missing grant","foreign buyer","missing stage","changed policy","changed D","future grant"]as const)
  test(`reader refuses ${corruption} without changing persisted money`,async()=>{
    const f=fixture(),result=await f.call("prepare"),grant=f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!;
    if(corruption==="missing grant")f.state.events=f.state.events.filter(row=>row!==grant);
    if(corruption==="foreign buyer")grant.metadata={...normalCommercialBenefitAuthorizationSchema.parse(grant.metadata),buyerId:"foreign"};
    if(corruption==="missing stage")f.state.events=f.state.events.filter(row=>row.eventName!=="payment_method_selected");
    if(corruption==="changed policy")f.state.advancedRules=[{id:"different",enabled:false,priority:1,conditions:[],action:{type:"do_nothing",params:{}}}];
    if(corruption==="changed D")result.session.cart.currentDiscount=14;
    if(corruption==="future grant")grant.occurredAt=new Date(f.state.now.getTime()+1);
    const before=structuredClone(f.state.stored);
    await assert.rejects(readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now}));
    assert.deepEqual(f.state.stored,before);
  });
for(const corruption of ["unapproved","expired","missing acceptance","changed terms"]as const)
  test(`accepted offer reader refuses ${corruption}`,async()=>{
    const f=fixture(),result=await f.call("offer");
    if(corruption==="unapproved")f.state.offer.approved=false;
    if(corruption==="expired")f.state.offer.expiresAt=new Date(f.state.now);
    if(corruption==="missing acceptance")f.state.accepted=null;
    if(corruption==="changed terms")f.state.offer.value=new Prisma.Decimal(11);
    await assert.rejects(readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now}));
  });
test("method-less journal is accepted only for actual explicit offer origin, never for progressive",async()=>{
  const f=fixture(),result=await f.call("prepare"),row=f.state.events.find(event=>event.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!;
  const {paymentMethod:_method,...metadata}=normalCommercialBenefitAuthorizationSchema.parse(row.metadata);row.metadata=metadata;
  assert.equal(normalCommercialBenefitAuthorizationSchema.safeParse(metadata).success,false);
  await assert.rejects(readNormalCheckoutCommercialBenefitOwner(f.tx,{stored:f.state.stored,canonicalCart:result.session.cart,now:f.state.now}));
});
for(const kind of ["prepare","offer"]as const)test(`${kind} verifies actual DB-owned post-write version before acknowledgement`,async()=>{
  const f=fixture();f.state.staleAfterWrite=true;await assert.rejects(f.call(kind),error=>{
    const descriptor=Object.getOwnPropertyDescriptor(error,"normalBenefitWriteVerification");assert.equal(descriptor!.value,"version");
    assert.equal(descriptor!.enumerable,false);assert.ok(!JSON.stringify(error).includes("normalBenefitWriteVerification"));return true;});
  assert.equal(f.state.stored.version,2);
  assert.deepEqual(f.state.events,[]);assert.equal(f.state.accepted,null);
});
test("irrational informational percentage uses canonical four-decimal display while D700 and P300 remain exact",async()=>{
  const f=fixture();f.state.cart.total=47;f.state.cart.items[0]!.price=47;f.state.cart.items[0]!.originalPrice=50;
  f.state.cart.discountBudget={version:1,originalSubtotalCents:5000,promotionDiscountCents:300};
  f.state.stored.cart=JSON.parse(JSON.stringify(f.state.cart));f.state.longFractionTransport=true;
  const result=await f.call("prepare");assert.equal(result.session.cart.currentDiscount,7);
  assert.equal(result.session.cart.commercialNudge!.discountPercent,14.8936);
  const grant=normalCommercialBenefitAuthorizationSchema.parse(f.state.events.find(row=>row.eventName===NORMAL_COMMERCIAL_BENEFIT_EVENT)!.metadata);
  assert.equal(grant.discountCents,700);assert.equal(grant.basis.promotionDiscountCents,300);
});
for(const field of ["discount","unit"]as const)test(`display normalization never tolerates a one-cent DB ${field} mutation`,async()=>{
  const f=fixture();f.state.moneyCorruption=field;await assert.rejects(f.call("prepare"));assert.equal(f.state.stored.version,2);assert.deepEqual(f.state.events,[]);
});
