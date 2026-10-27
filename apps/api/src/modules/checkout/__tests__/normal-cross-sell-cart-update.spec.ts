import assert from "node:assert/strict";
import test from "node:test";
import type {CheckoutSession} from "@zyon/shared-types";
import type {CheckoutSessionRepository} from "../domain/ports/checkout-session.repository.port.js";
import type {OutboxRepository} from "../../../shared/messaging/ports/outbox.repository.port.js";
import {UpdateCartUseCase} from "../application/use-cases/update-cart.use-case.js";
const now="2026-10-20T12:00:00.000Z";
function session():CheckoutSession{return{merchantId:"merchant",sessionId:"session",globalUserId:"buyer",conversationId:"conversation",persistenceVersion:5,
  cart:{currency:"BRL",total:9,items:[{sku:"A",variantId:"a",product_id:"p-a",name:"A",quantity:1,price:9,originalPrice:10,
    crossSellIntent:{version:1,promotionId:"promo",promotionUpdatedAt:now,acceptedQuantity:1,originalUnitPriceCents:1000,maximumUnitPriceCents:900}}]},
  abandonmentScore:0,triggerAgent:false,chatHistory:[],createdAt:now,updatedAt:now};}
function fixture(){const actual=session(),calls:unknown[]=[];let saves=0;
  const repo={getSession:async()=>actual,saveSession:async()=>{saves++;}}as unknown as CheckoutSessionRepository;
  const mutation={updateCart:async(scope:unknown,request:unknown)=>{calls.push({scope,request});return {...actual,cart:{currency:"BRL",total:0,items:[]},persistenceVersion:6} as CheckoutSession;}};
  const usecase=new UpdateCartUseCase(repo,{}as OutboxRepository,undefined,undefined,undefined,undefined,mutation);
  return{actual,calls,usecase,repo,get saves(){return saves;}};}
test("normal authored intent delegates to transactional mutation with actual version, never generic save",async()=>{
  const f=fixture();const response=await f.usecase.execute({merchant_id:"merchant",session_id:"session",items:[{sku:"A",quantity:0}]});
  assert.deepEqual(f.calls,[{scope:{merchantId:"merchant",sessionId:"session"},request:{expectedVersion:5,items:[{sku:"A",quantity:0}]}}]);
  assert.equal(f.saves,0);assert.equal(response.session_id,"session");
});
test("caller money and submitted version are not delegated as source authority",async()=>{
  const f=fixture(),request={merchant_id:"merchant",session_id:"session",items:[{sku:"A",quantity:0,price:0}],expectedVersion:0};
  await f.usecase.execute(request);assert.deepEqual(f.calls,[{scope:{merchantId:"merchant",sessionId:"session"},request:{expectedVersion:5,items:[{sku:"A",quantity:0}]}}]);
});
test("normal mutation without reader/writer authority fails before generic writes",async()=>{
  const f=fixture();await assert.rejects(new UpdateCartUseCase(f.repo,{}as OutboxRepository).execute({merchant_id:"merchant",session_id:"session",items:[{sku:"A",quantity:0}]}),/cross_sell_quote_review_required/);
  assert.equal(f.saves,0);
});
test("invalid quantities retain existing request errors instead of invoking transactional writer",async()=>{
  const f=fixture();await assert.rejects(f.usecase.execute({merchant_id:"merchant",session_id:"session",items:[{sku:"A",quantity:100}]}),/update_cart_quantity_invalid/);
  assert.deepEqual(f.calls,[]);assert.equal(f.saves,0);
});
