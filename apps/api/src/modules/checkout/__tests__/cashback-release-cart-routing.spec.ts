import assert from "node:assert/strict";
import { test } from "node:test";
import { ApplyOfferUseCase } from "../application/use-cases/apply-offer.use-case.js";
import { UpdateCartUseCase } from "../application/use-cases/update-cart.use-case.js";
import { checkoutSession } from "./checkout-test-fixtures.js";

function fixture(){const session=checkoutSession({persistenceVersion:10,shipping:undefined,shippingOptions:undefined,cart:{currency:"BRL",total:100,currentDiscount:15,items:[{sku:"QA",name:"QA",price:100,quantity:1,crossSellIntent:{version:1,promotionId:"QA",promotionUpdatedAt:new Date().toISOString(),acceptedQuantity:1,originalUnitPriceCents:10000,maximumUnitPriceCents:10000}}]}}),committed={...structuredClone(session),persistenceVersion:11};return{session,committed};}
const forbidden=()=>assert.fail("detached legacy/journal mutation must not run after normal writer");
test("CR-CART-05 normal ApplyOffer delegates its only write and projects authoritative cashback without journal replay",async()=>{
  const{session,committed}=fixture();let writes=0,reads=0;
  const useCase=Reflect.construct(ApplyOfferUseCase,[{getSession:async()=>session},{getOffer:forbidden},{apply:forbidden},{execute:forbidden},undefined,{platformFeeBrl:0},{applyOffer:async()=>{writes++;return{session:committed,offer:{id:"offer",expiresAt:new Date(Date.now()+60000).toISOString()}};}},{checkoutCashbackCents:async(s:unknown)=>{reads++;assert.equal(s,committed);return 1500;}},{hasCombination:forbidden,applyAdvancedRule:forbidden}]) as ApplyOfferUseCase;
  const result=await useCase.execute({merchant_id:session.merchantId,session_id:session.sessionId,offer_id:"offer"});assert.equal(result.success,true);assert.equal(result.experience!.totals.cashback_cents,1500);assert.equal(result.new_total,70);assert.equal(writes,1);assert.equal(reads,1);
});
test("CR-CART-06 normal UpdateCart delegates CAS owner then projects cashback without external reset or mutable transaction",async()=>{
  const{session,committed}=fixture();let writes=0,reads=0;
  const useCase=Reflect.construct(UpdateCartUseCase,[{getSession:async()=>session,commitCommercialMutation:forbidden},{appendOutbox:forbidden},undefined,undefined,{platformFeeBrl:0},undefined,{updateCart:async()=>{writes++;return committed;}},{checkoutCashbackCents:async()=>{reads++;return 1500;}},{assertMutable:forbidden,applyCartChange:forbidden}]) as UpdateCartUseCase;
  const result=await useCase.execute({merchant_id:session.merchantId,session_id:session.sessionId,items:[{sku:"QA",quantity:2}]});assert.equal(result.experience.totals.cashback_cents,1500);assert.equal(result.experience.totals.total,70);assert.equal(writes,1);assert.equal(reads,1);
});
