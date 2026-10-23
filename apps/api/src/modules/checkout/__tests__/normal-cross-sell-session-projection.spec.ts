import assert from "node:assert/strict";
import test from "node:test";
import type { CheckoutSession } from "@zyon/shared-types";
import { CartPromoResolutionService } from "../application/services/cart-promo-resolution.service.js";
import type { NormalCheckoutCrossSellPort } from "../../cross-sell/domain/ports/normal-checkout-cross-sell.port.js";

function session():CheckoutSession{return{merchantId:"merchant",sessionId:"session",globalUserId:"buyer",conversationId:"conversation",
  cart:{currency:"BRL",total:9,items:[{sku:"A",name:"A",quantity:1,price:9,originalPrice:10,variantId:"a",product_id:"p-a",
    crossSellIntent:{version:1,promotionId:"promo",promotionUpdatedAt:"2026-10-20T12:00:00.000Z",acceptedQuantity:1,
      originalUnitPriceCents:1000,maximumUnitPriceCents:900,selectedOptionItemIds:[]}}]},
  abandonmentScore:0,triggerAgent:false,chatHistory:[],persistenceVersion:1,createdAt:"2026-10-20T12:00:00.000Z",updatedAt:"2026-10-20T12:00:00.000Z"};}
function service(read:NormalCheckoutCrossSellPort["read"]){return new CartPromoResolutionService(undefined,undefined,undefined,{read});}
test("session-bound normal intent projection passes only actual scope plus compare-only snapshot to authority",async()=>{
  const value=session(),before=structuredClone(value),actual=session();actual.customer={email_verified:true};
  const calls:unknown[]=[];
  const result=await service(async(scope,expected)=>{calls.push({scope,expected});return actual;}).resolveSessionCartPromos(value);
  assert.equal(result,actual);assert.deepEqual(calls,[{scope:{merchantId:"merchant",sessionId:"session"},expected:before}]);assert.deepEqual(value,before);
});
test("missing authority and unbound cart-only input remain failclosed for normal intent",async()=>{
  await assert.rejects(new CartPromoResolutionService().resolveSessionCartPromos(session()),/checkout_price_review_required/);
  let reads=0;const projection=service(async()=>{reads++;return session();});
  await assert.rejects(projection.resolveCartPromos(session().cart,"merchant"),/checkout_price_review_required/);assert.equal(reads,0);
});
test("normal scope read failure is never replaced by caller prices, P or a permissive fallback",async()=>{
  const failure=new Error("actual_source_review");
  await assert.rejects(service(async()=>{throw failure;}).resolveSessionCartPromos(session()),error=>error===failure);
});
test("source-backed session delegates only to actual authority; a detached source projection is not fallback",async()=>{
  const value=session();value.cart.source="storefront";value.cart.cart_ref="cart";let reads=0;
  await assert.rejects(service(async(scope,expected)=>{reads++;assert.deepEqual(scope,{merchantId:"merchant",sessionId:"session"});assert.equal(expected,value);
    throw new Error("actual_source_review");}).resolveSessionCartPromos(value),/actual_source_review/);assert.equal(reads,1);
});
test("ordinary no-benefit session preserves its existing path without invoking new authority",async()=>{
  const value=session();delete value.cart.items[0]!.crossSellIntent;delete value.cart.items[0]!.originalPrice;value.cart.items[0]!.price=10;value.cart.total=10;let reads=0;
  const result=await service(async()=>{reads++;return session();}).resolveSessionCartPromos(value);
  assert.equal(reads,0);assert.deepEqual(result,value);
});
