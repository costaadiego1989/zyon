import assert from 'node:assert/strict';
import test from 'node:test';
import {isAllowedBuyerBookingFixture} from './service-buyer-booking-fixture-options.mjs';

const script=[{phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:.99,
  requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:'browse'}},
  {phase:'storefront.sales',toolCall:{name:'get_service_professionals',args:{productId:'synthetic-service',variantId:'synthetic-variant'}}}];
test('T47 private buyer and model composition keeps original authority boundaries',async t=>{
  await t.test('the original isolated buyer fixture remains allowed without a model',()=>{
    assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true}),true);
    assert.equal(isAllowedBuyerBookingFixture({local:true,buyerBooking:true,graph:false}),true);
  });
  await t.test('only an explicitly scripted storefront fixture can compose with the private buyer channel',()=>{
    const options={local:true,buyerBooking:true,storefrontQueryModel:true,modelScript:script},before=structuredClone(options);
    assert.equal(isAllowedBuyerBookingFixture(options),true);assert.deepEqual(options,before);
    assert.equal(isAllowedBuyerBookingFixture({...options,modelScript:undefined}),false);
    assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true,modelScript:script}),false);
  });
  await t.test('graph, WhatsApp, support and observer combinations remain refused',()=>{
    for(const patch of [{graph:true},{whatsapp:{}},{whatsapp:null},{supportQueryModel:true},{observeBusinessRag:true}]){
      assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true,...patch}),false);
      assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true,storefrontQueryModel:true,modelScript:script,...patch}),false);
    }
  });
  await t.test('the shared existing script validator still rejects unknown phases, keys, empty scripts and excessive size',()=>{
    for(const modelScript of [null,[],[...script,{phase:'unsafe',response:{}}],[{...script[0],execute:'unsafe'}],Array(17).fill(script[0])])
      assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true,storefrontQueryModel:true,modelScript}),false);
    assert.equal(isAllowedBuyerBookingFixture({buyerBooking:false}),false);
    assert.equal(isAllowedBuyerBookingFixture(null),false);
  });
});
