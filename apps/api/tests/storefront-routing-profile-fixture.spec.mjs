import assert from 'node:assert/strict';
import test from 'node:test';
import {validateStorefrontRoutingProfile,selectStorefrontRoutingProfile} from './storefront-routing-profile-fixture.mjs';

test('S1 routing selector is closed and exists only with the original storefront query fixture',()=>{
  assert.equal(validateStorefrontRoutingProfile({}),undefined);
  assert.equal(validateStorefrontRoutingProfile({storefrontQueryModel:true,storefrontRoutingProfile:'structured'}),'structured');
  for(const value of['legacy',true,false,null,{},['structured'],'STRUCTURED'])
    assert.throws(()=>validateStorefrontRoutingProfile({storefrontQueryModel:true,storefrontRoutingProfile:value}),/routing_profile_invalid/);
  for(const options of[{},{storefrontQueryModel:false},{supportQueryModel:true},{storefrontQueryModel:true,supportQueryModel:true}])
    assert.throws(()=>validateStorefrontRoutingProfile({...options,storefrontRoutingProfile:'structured'}),/routing_profile_requires_storefront/);
});

test('S1 omitted routing selector performs no mutation or default-profile claim',()=>{
  const env={UNRELATED:'keep'};
  assert.equal(selectStorefrontRoutingProfile(undefined,env),undefined);
  assert.deepEqual(env,{UNRELATED:'keep'});
});

test('S1 selected profile stays active through the caller-owned app lifetime and restores absent key',async()=>{
  const env={UNRELATED:'keep'},selection=selectStorefrontRoutingProfile('structured',env);
  assert.equal(env.STOREFRONT_SEMANTIC_ROUTING,'structured');
  await Promise.resolve();assert.equal(env.STOREFRONT_SEMANTIC_ROUTING,'structured');
  selection.bindAdapter({structuredRouting:true});
  assert.deepEqual(selection.evidence(),{configured:'structured',observed:'structured',binding:'original_adapter_constructor',selectorActive:true});
  selection.restore();selection.restore();assert.deepEqual(env,{UNRELATED:'keep'});
  assert.throws(()=>selection.evidence(),/routing_profile_restored/);
});

test('S1 profile restoration preserves the exact prior key value including construction failure',()=>{
  const env={STOREFRONT_SEMANTIC_ROUTING:'legacy',UNRELATED:'keep'};
  const selection=selectStorefrontRoutingProfile('structured',env);
  try{throw Error('synthetic-construction-failure');}catch{}finally{selection.restore();}
  assert.deepEqual(env,{STOREFRONT_SEMANTIC_ROUTING:'legacy',UNRELATED:'keep'});
});

test('S1 configured-profile evidence requires the actual selected adapter flag and active selector',()=>{
  const env={},selection=selectStorefrontRoutingProfile('structured',env);
  try{
    assert.throws(()=>selection.evidence(),/routing_profile_unbound/);
    for(const adapter of[undefined,{}, {structuredRouting:false},{structuredRouting:'structured'}])
      assert.throws(()=>selection.bindAdapter(adapter),/routing_profile_binding_invalid/);
    selection.bindAdapter({structuredRouting:true});env.STOREFRONT_SEMANTIC_ROUTING='legacy';
    assert.throws(()=>selection.evidence(),/routing_profile_changed/);
  }finally{selection.restore();}
});