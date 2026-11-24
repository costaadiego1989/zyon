import assert from 'node:assert/strict';
import test from 'node:test';
import {validateStorefrontRoutingProfile} from './storefront-routing-profile-fixture.mjs';
import {isAllowedBuyerBookingFixture} from './service-buyer-booking-fixture-options.mjs';
import {constructionOnlyEnvironment,assertConstructionOnlyAmbient} from './nest-construction-only.guards.mjs';

test('T42/T43 private profile cannot inherit application routing through the original ambient guard',()=>{
  const env=constructionOnlyEnvironment({STOREFRONT_SEMANTIC_ROUTING:'structured',OPENROUTER_API_KEY:'synthetic-not-used'});
  assert.equal(env.STOREFRONT_SEMANTIC_ROUTING,undefined);
  assert.equal(env.OPENROUTER_API_KEY,undefined);
  assert.doesNotThrow(()=>assertConstructionOnlyAmbient(env));
  assert.throws(()=>assertConstructionOnlyAmbient({...env,STOREFRONT_SEMANTIC_ROUTING:'structured'}),/ambient_configuration_forbidden/);
  assert.equal(validateStorefrontRoutingProfile({storefrontQueryModel:true}),undefined);
  assert.equal(validateStorefrontRoutingProfile({storefrontQueryModel:true,storefrontRoutingProfile:'structured'}),'structured');
});

test('T43 explicit private profile preserves scripted buyer composition and all existing excluded channels',()=>{
  const script=[
    {phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,
      requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:'browse'}},
    {phase:'storefront.sales',serviceToolCall:{name:'get_service_professionals',args:{productId:'synthetic-offer',variantId:'synthetic-variant'}}},
  ];
  const options={local:true,buyerBooking:true,storefrontQueryModel:true,storefrontRoutingProfile:'structured',modelScript:script};
  const before=structuredClone(options);
  assert.equal(validateStorefrontRoutingProfile(options),'structured');
  assert.equal(isAllowedBuyerBookingFixture(options),true);
  assert.deepEqual(options,before);
  assert.equal(isAllowedBuyerBookingFixture({...options,modelScript:undefined}),false);
  for(const patch of[{graph:true},{whatsapp:{}},{whatsapp:null},{supportQueryModel:true},{observeBusinessRag:true}])
    assert.equal(isAllowedBuyerBookingFixture({...options,...patch}),false);
  assert.throws(()=>validateStorefrontRoutingProfile({...options,supportQueryModel:true}),/routing_profile_requires_storefront/);
});
