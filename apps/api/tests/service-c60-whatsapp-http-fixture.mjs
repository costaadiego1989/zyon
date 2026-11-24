import assert from 'node:assert/strict';

const AUTO='WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION',RECOVERY='manual-only-v1';
// Exact existing synthetic fixture identities. No user input constructs a URL,
// credential, WABA namespace or provider success/capability response.
const profiles=Object.freeze({
  'owned-c60-catalog-empty-v1':Object.freeze({authorization:'Bearer synthetic-no-external-meta-secret',urls:Object.freeze({
    'https://graph.facebook.com/v23.0/900060999/product_catalogs?fields=id&limit=2':'product_catalogs',
    'https://graph.facebook.com/v23.0/900060999/flows?fields=id,name,status&limit=100':'flows',
  })}),
  'owned-c60-search-empty-v1':Object.freeze({authorization:'Bearer synthetic-no-external-meta-secret',urls:Object.freeze({
    'https://graph.facebook.com/v23.0/900062999/product_catalogs?fields=id&limit=2':'product_catalogs',
    'https://graph.facebook.com/v23.0/900062999/flows?fields=id,name,status&limit=100':'flows',
  })}),
  'owned-c60-discovery-empty-v1':Object.freeze({authorization:'Bearer synthetic-no-external-meta-secret',urls:Object.freeze({
    'https://graph.facebook.com/v23.0/900063999/product_catalogs?fields=id&limit=2':'product_catalogs',
    'https://graph.facebook.com/v23.0/900063999/flows?fields=id,name,status&limit=100':'flows',
  })}),
  'owned-c60-commerce-empty-v1':Object.freeze({authorization:'Bearer synthetic-no-external-meta-secret',urls:Object.freeze({
    'https://graph.facebook.com/v23.0/900064999/product_catalogs?fields=id&limit=2':'product_catalogs',
    'https://graph.facebook.com/v23.0/900064999/flows?fields=id,name,status&limit=100':'flows',
  })}),
  'owned-c60-buyer-empty-v1':Object.freeze({authorization:'Bearer synthetic-not-a-provider-secret',urls:Object.freeze({
    'https://graph.facebook.com/v23.0/900093999/product_catalogs?fields=id&limit=2':'product_catalogs',
    'https://graph.facebook.com/v23.0/900093999/flows?fields=id,name,status&limit=100':'flows',
  })}),
});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

export function validateOwnedC60MetaCapabilitiesFixture(options){
  assert.ok(plain(options),'c60_meta_fixture_invalid');
  const profile=options.c60MetaCapabilitiesFixture;
  if(profile===undefined)return undefined;
  assert.ok(typeof profile==='string'&&Object.hasOwn(profiles,profile),'c60_meta_fixture_invalid');
  assert.ok(options.local===true&&(options.whatsapp===true||plain(options.whatsapp))
    &&options.graph!==true&&options.buyerBooking!==true&&options.c60RecoveryTemplateMonitorFixture===RECOVERY
    &&['metaCapabilitiesFixture','recoveryTemplateMonitorFixture','bookingAwaitTrace','localModelFailureFixture','native18HttpFailures']
      .every(key=>options[key]===undefined),'c60_meta_fixture_requires_owned_whatsapp');
  return profile;
}

export function validateOwnedC60RecoveryTemplateMonitorFixture(options){
  assert.ok(plain(options),'c60_recovery_fixture_invalid');
  const profile=options.c60RecoveryTemplateMonitorFixture;
  if(profile===undefined)return undefined;
  assert.equal(profile,RECOVERY,'c60_recovery_fixture_invalid');
  assert.ok(options.c60MetaCapabilitiesFixture!==undefined,'c60_recovery_fixture_requires_meta');
  validateOwnedC60MetaCapabilitiesFixture(options);
  return profile;
}

/** Private final HTTP seam only. Each explicit C60 profile has one exact WABA,
 * its existing synthetic credential and exactly two empty GET envelopes.
 * Everything else retains the original blocked fetch and argument values. */
export function installOwnedC60EmptyMetaCapabilitiesHttpFixture(profile,target=globalThis,env=process.env){
  if(profile===undefined)return undefined;
  assert.ok(typeof profile==='string'&&Object.hasOwn(profiles,profile),'c60_meta_fixture_invalid');
  assert.ok(target&&typeof target.fetch==='function'&&env&&typeof env==='object','c60_meta_fixture_target_invalid');
  const selected=profiles[profile],blockedFetch=target.fetch,present=Object.hasOwn(env,AUTO),previous=env[AUTO];
  const capturedReads={product_catalogs:0,flows:0};let restored=false,delegatedAttempts=0;
  const restoreEnvironment=()=>{present?env[AUTO]=previous:delete env[AUTO];};
  const allowed=(input,init)=>{
    if(typeof input!=='string'||!Object.hasOwn(selected.urls,input)||!plain(init)
      ||Object.keys(init).some(key=>!['headers','redirect','signal','method'].includes(key))
      ||'body' in init||(init.method!==undefined&&init.method!=='GET')||init.redirect!=='error'
      ||!(init.signal instanceof AbortSignal))return undefined;
    let headers;
    if(init.headers instanceof Headers)headers=[...init.headers.entries()];
    else if(plain(init.headers))headers=Object.entries(init.headers);
    else return undefined;
    if(headers.length!==1||headers[0][0].toLowerCase()!=='authorization'||headers[0][1]!==selected.authorization)return undefined;
    return selected.urls[input];
  };
  const capture=async(input,init)=>{
    const route=restored?undefined:allowed(input,init);
    if(!route){delegatedAttempts++;return Reflect.apply(blockedFetch,target,[input,init]);}
    init.signal.throwIfAborted();capturedReads[route]++;
    return new Response('{"data":[]}',{status:200,headers:{'content-type':'application/json'}});
  };
  try{env[AUTO]='false';target.fetch=capture;}
  catch(error){try{if(target.fetch!==blockedFetch)target.fetch=blockedFetch;}finally{restoreEnvironment();restored=true;}throw error;}
  return Object.freeze({
    evidence:()=>Object.freeze({profile,restored,capturedReads:Object.freeze({...capturedReads}),delegatedAttempts}),
    restore(){
      if(restored)return;
      try{assert.ok(target.fetch===capture&&env[AUTO]==='false','c60_meta_fixture_lifetime_changed');}
      finally{try{target.fetch=blockedFetch;}finally{restoreEnvironment();restored=true;}}
    },
  });
}
