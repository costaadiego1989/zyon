import assert from 'node:assert/strict';
export function validateStorefrontRoutingProfile(options){
  const profile=options.storefrontRoutingProfile;
  if(profile===undefined)return undefined;
  assert.equal(profile,'structured','storefront_routing_profile_invalid');
  assert.ok(options.storefrontQueryModel===true&&options.supportQueryModel!==true,'storefront_routing_profile_requires_storefront');
  return profile;
}

/** Private owned-worker configuration only. Omission has no mutation. The
 * existing application selector remains active until the caller closes AppModule.
 * No ambient whitelist, productive default, guard or provider is replaced. */
export function selectStorefrontRoutingProfile(profile,env){
  if(profile===undefined)return undefined;
  assert.equal(profile,'structured','storefront_routing_profile_invalid');
  const key='STOREFRONT_SEMANTIC_ROUTING',present=Object.hasOwn(env,key),previous=env[key];
  env[key]='structured';let restored=false,bound=false;
  const active=()=>{assert.equal(restored,false,'storefront_routing_profile_restored');
    assert.equal(env[key],'structured','storefront_routing_profile_changed');};
  return Object.freeze({
    bindAdapter(adapter){active();assert.ok(adapter&&adapter.structuredRouting===true,'storefront_routing_profile_binding_invalid');bound=true;},
    evidence(){active();assert.ok(bound,'storefront_routing_profile_unbound');
      return{configured:'structured',observed:'structured',binding:'original_adapter_constructor',selectorActive:true};},
    restore(){if(restored)return;present?env[key]=previous:delete env[key];restored=true;},
  });
}