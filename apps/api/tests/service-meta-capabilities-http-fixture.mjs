import assert from 'node:assert/strict';

const PROFILE='owned-empty-v1',AUTO='WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION';
const urls=Object.freeze({
  'https://graph.facebook.com/v23.0/900046999/product_catalogs?fields=id&limit=2':'product_catalogs',
  'https://graph.facebook.com/v23.0/900046999/flows?fields=id,name,status&limit=100':'flows',
});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

export function validateOwnedEmptyMetaCapabilitiesFixture(options){
  assert.ok(plain(options),'meta_capabilities_fixture_invalid');
  const profile=options.metaCapabilitiesFixture;
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'meta_capabilities_fixture_invalid');
  assert.ok(options.local===true&&(options.whatsapp===true||plain(options.whatsapp))
    &&options.graph!==true&&options.buyerBooking!==true,'meta_capabilities_fixture_requires_whatsapp');
  return profile;
}

/** Private final HTTP seam, not a capability/DI/credential or admission override.
 * Unmatched requests keep the exact original blocked fetch and argument values.
 * The only successful envelopes are empty lists for the named synthetic WABA. */
export function installOwnedEmptyMetaCapabilitiesHttpFixture(profile,target=globalThis,env=process.env){
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'meta_capabilities_fixture_invalid');
  assert.ok(target&&typeof target.fetch==='function'&&env&&typeof env==='object','meta_capabilities_fixture_target_invalid');
  const blockedFetch=target.fetch,present=Object.hasOwn(env,AUTO),previous=env[AUTO];
  const capturedReads={product_catalogs:0,flows:0};let restored=false,delegatedAttempts=0;
  const restoreEnvironment=()=>{present?env[AUTO]=previous:delete env[AUTO];};
  const allowed=(input,init)=>{
    if(typeof input!=='string'||!Object.hasOwn(urls,input)||!plain(init)
      ||Object.keys(init).some(key=>!['headers','redirect','signal','method'].includes(key))
      ||'body' in init||(init.method!==undefined&&init.method!=='GET')||init.redirect!=='error'
      ||!(init.signal instanceof AbortSignal))return undefined;
    let headers;
    if(init.headers instanceof Headers)headers=[...init.headers.entries()];
    else if(plain(init.headers))headers=Object.entries(init.headers);
    else return undefined;
    if(headers.length!==1||headers[0][0].toLowerCase()!=='authorization'
      ||headers[0][1]!=='Bearer synthetic-not-a-provider-secret')return undefined;
    return urls[input];
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
    evidence:()=>Object.freeze({profile:PROFILE,restored,capturedReads:Object.freeze({...capturedReads}),delegatedAttempts}),
    restore(){
      if(restored)return;
      try{assert.ok(target.fetch===capture&&env[AUTO]==='false','meta_capabilities_fixture_lifetime_changed');}
      finally{try{target.fetch=blockedFetch;}finally{restoreEnvironment();restored=true;}}
    },
  });
}
