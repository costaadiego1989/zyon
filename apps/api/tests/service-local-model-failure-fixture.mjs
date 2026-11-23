import assert from 'node:assert/strict';
const PROFILE='owned-503-v1';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
export function validateOwnedLocalModelFailureFixture(options){
  if(options.localModelFailureFixture===undefined)return undefined;
  assert.equal(options.localModelFailureFixture,PROFILE,'local_model_failure_fixture_profile_invalid');
  assert.ok(options.local===true&&!!options.whatsapp&&options.bookingAwaitTrace==='native18-v1'
    &&options.metaCapabilitiesFixture==='owned-empty-v1'&&options.recoveryTemplateMonitorFixture==='manual-only-v1'
    &&!options.graph&&!options.buyerBooking&&options.modelScript===undefined
    &&options.storefrontQueryModel===undefined&&options.supportQueryModel===undefined,'local_model_failure_fixture_native18_required');
  return PROFILE;
}
/** Final HTTP FAILURE only. The runtime supplies its own trap URL/generated key,
 * before constructing meteredAiFetch. No successful model payload is supplied. */
export function installOwnedLocalModelFailureFixture(profile,config,target=globalThis){
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'local_model_failure_fixture_profile_invalid');
  assert.ok(plain(config)&&Object.keys(config).every(key=>['baseUrl','apiKey','model'].includes(key))
    &&typeof config.baseUrl==='string'&&/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/v1$/.test(config.baseUrl)
    &&typeof config.apiKey==='string'&&/^[a-f0-9]{64}$/.test(config.apiKey)
    &&config.model==='synthetic-only'&&target&&typeof target.fetch==='function','local_model_failure_fixture_config_invalid');
  const parsed=new URL(config.baseUrl);assert.ok(Number(parsed.port)>1024&&Number(parsed.port)<=65535,'local_model_failure_fixture_config_invalid');
  const route=config.baseUrl+'/chat/completions',key=config.apiKey,model=config.model,blockedFetch=target.fetch;
  let capturedFailures=0,delegatedAttempts=0,restored=false;
  const expectedHeaders={'authorization':'Bearer '+key,'content-type':'application/json','http-referer':'https://zyon.ai','x-title':'AACP Checkout'};
  const allowed=(input,init)=>{
    if(input!==route||typeof input!=='string'||!plain(init)||init.method!=='POST'
      ||Object.keys(init).some(key=>!['method','headers','body','signal'].includes(key))
      ||!(init.signal===undefined||init.signal instanceof AbortSignal)
      ||typeof init.body!=='string'||init.body.length>1_000_000)return false;
    let entries;
    if(init.headers instanceof Headers)entries=[...init.headers.entries()];
    else if(plain(init.headers))entries=Object.entries(init.headers);
    else return false;
    const headers=new Map();
    for(const[name,value]of entries){
      const lower=name.toLowerCase();if(headers.has(lower)||!Object.hasOwn(expectedHeaders,lower)||value!==expectedHeaders[lower])return false;
      headers.set(lower,value);
    }
    if(headers.size!==4)return false;
    let body;try{body=JSON.parse(init.body);}catch{return false;}
    return plain(body)&&Object.keys(body).every(key=>['model','messages','max_tokens','temperature','stream','tools','tool_choice','stop','response_format'].includes(key))
      &&body.model===model&&body.stream===false&&Array.isArray(body.messages);
  };
  const failure=function(input,init){
    if(restored||!allowed(input,init)){delegatedAttempts++;return Reflect.apply(blockedFetch,target,[input,init]);}
    if(init.signal?.aborted)return Promise.reject(init.signal.reason);
    capturedFailures++;
    return Promise.resolve(new Response('',{status:503,headers:{'cache-control':'no-store'}}));
  };
  try{target.fetch=failure;}
  catch(error){try{target.fetch=blockedFetch;}finally{restored=true;}throw error;}
  return Object.freeze({
    evidence:()=>Object.freeze({profile:PROFILE,status:503,capturedFailures,delegatedAttempts,restored}),
    restore(){
      if(restored)return;
      try{assert.equal(target.fetch,failure,'local_model_failure_fixture_lifetime_changed');}
      finally{target.fetch=blockedFetch;restored=true;}
    }
  });
}
