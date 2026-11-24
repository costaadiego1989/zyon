import assert from 'node:assert/strict';
import test from 'node:test';
import {createServiceTestRuntime} from './service-test-runtime.mjs';
import {isAllowedBuyerBookingFixture} from './service-buyer-booking-fixture-options.mjs';
const script=[{phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,
  requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:'browse'}},
{phase:'storefront.sales',serviceToolCall:{name:'get_service_professionals',args:{productId:'service',variantId:'variant'}}}];
const browser={local:true,buyerBooking:true,buyerBrowser:true,storefrontQueryModel:true,modelScript:script};
test('T93 private browser and T94 datasource precondition remain separate without enabling forbidden transport combinations',()=>{
  for(const serviceReleaseFixture of['matching','missing']){
    assert.equal(isAllowedBuyerBookingFixture({...browser,serviceReleaseFixture}),true);
    for(const patch of[{whatsapp:true},{graph:true},{supportQueryModel:true},{observeBusinessRag:true}])
      assert.equal(isAllowedBuyerBookingFixture({...browser,serviceReleaseFixture,...patch}),false);
  }
});
test('T93/T94 merged private flags reject malformed release values before allocating resources',async()=>{
  for(const serviceReleaseFixture of[true,false,'ready','forged',{},null])
    await assert.rejects(createServiceTestRuntime({...browser,serviceReleaseFixture}),/local_release_fixture_invalid/);
});
