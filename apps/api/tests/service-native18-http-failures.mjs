import assert from 'node:assert/strict';
const PROFILE='closed-failures-v1';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
const keys=(value,allowed)=>plain(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function validateNative18HttpFailures(options){
  if(options.native18HttpFailures===undefined)return undefined;
  assert.equal(options.native18HttpFailures,PROFILE,'native18_http_failure_profile_invalid');
  assert.ok(options.local===true&&!!options.whatsapp&&options.bookingAwaitTrace==='native18-v1'
    &&options.localModelFailureFixture==='owned-503-v1'&&options.metaCapabilitiesFixture==='owned-empty-v1'
    &&options.recoveryTemplateMonitorFixture==='manual-only-v1'&&!options.graph&&!options.buyerBooking
    &&options.modelScript===undefined&&options.storefrontQueryModel===undefined&&options.supportQueryModel===undefined,'native18_http_failure_native18_required');
  return PROFILE;
}
/** Private final-HTTP FAILURE only. Real credentials/admission/DI/repositories,
 * metering, inbox and notification consumer still execute. Unmatched input is
 * passed unchanged to the previously installed SDK/MetaGET/blocked transports. */
export function installNative18HttpFailures(profile,config,target=globalThis){
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'native18_http_failure_profile_invalid');
  assert.ok(keys(config,['baseUrl','apiKey','model','additionalNoticeRecipients'])&&typeof config.baseUrl==='string'
    &&/^http:\/\/127\.0\.0\.1:[1-9][0-9]{3,4}\/v1$/.test(config.baseUrl)
    &&typeof config.apiKey==='string'&&/^[a-f0-9]{64}$/.test(config.apiKey)
    &&config.model==='synthetic-only'&&target&&typeof target.fetch==='function','native18_http_failure_config_invalid');
  const port=Number(config.baseUrl.split(':')[2]?.split('/')[0]);assert.ok(port>1024&&port<=65535,'native18_http_failure_config_invalid');
  const additional=config.additionalNoticeRecipients;
  assert.ok(additional===undefined||Array.isArray(additional)&&additional.length===1
    &&Array.isArray(additional[0])&&additional[0].length===2
    &&additional[0][0]==='900046000015'&&additional[0][1]==='5511998000016','native18_http_failure_additional_recipient_invalid');
  const allowSecondBuyer=additional!==undefined;
  const route=config.baseUrl+'/chat/completions',localKey=config.apiKey,blockedFetch=target.fetch;
  let capturedCheckoutModelFailures=0,capturedServiceNoticeFailures=0,delegatedAttempts=0,modelMismatchCount=0,restored=false;
  const modelMismatches=[];
  const headersMatch=(value,expected)=>{
    let entries;if(value instanceof Headers)entries=[...value.entries()];else if(plain(value))entries=Object.entries(value);else return false;
    const seen=new Set();
    for(const[name,v]of entries){const key=name.toLowerCase();if(seen.has(key)||!Object.hasOwn(expected,key)||v!==expected[key])return false;seen.add(key);}
    return seen.size===Object.keys(expected).length;
  };
  const localHeaders={'content-type':'application/json',authorization:'Bearer '+localKey};
  const sdkHeaders={...localHeaders,'http-referer':'https://zyon.ai','x-title':'AACP Checkout'};
  const noticeHeaders={'content-type':'application/json',authorization:'Bearer synthetic-not-a-provider-secret'};
  const bodyOf=init=>{if(typeof init?.body!=='string'||init.body.length>1_000_000)return undefined;try{return JSON.parse(init.body);}catch{return undefined;}};
  const modelCriteria=(input,init,body)=>({
    ownedRoute:typeof input==='string'&&input===route,
    methodPost:init?.method==='POST',
    signal:init?.signal instanceof AbortSignal,
    initCheckout:keys(init,['method','headers','body','signal']),
    initSdk:keys(init,['method','headers','body','signal'])&&(init.signal===undefined||init.signal instanceof AbortSignal),
    headersCheckout:headersMatch(init?.headers,localHeaders),headersSdk:headersMatch(init?.headers,sdkHeaders),
    bodyModel:plain(body)&&body.model==='synthetic-only',
    bodyCheckout:keys(body,['model','messages','tools','max_tokens','temperature'])&&Array.isArray(body.messages)
      &&Array.isArray(body.tools)&&body.max_tokens===300&&body.temperature===0.3,
    bodySdk:keys(body,['model','messages','max_tokens','temperature','stream','tools','tool_choice','stop','response_format'])
      &&Array.isArray(body.messages)&&body.stream===false
  });
  const noticeMatches=(input,init,body)=>{
    if(typeof input!=='string')return false;
    const path=/^https:\/\/graph\.facebook\.com\/v23\.0\/900046([0-9]{6})\/messages$/.exec(input);
    return !!path&&Number(path[1])>0&&keys(init,['method','redirect','signal','headers','body'])
      &&init.method==='POST'&&init.redirect==='error'&&init.signal instanceof AbortSignal&&headersMatch(init.headers,noticeHeaders)
      &&keys(body,['messaging_product','to','biz_opaque_callback_data','type','text'])
      &&body.messaging_product==='whatsapp'&&(body.to==='5511998'+path[1]||allowSecondBuyer&&path[1]==='000015'&&body.to==='5511998000016')&&body.type==='text'
      &&typeof body.biz_opaque_callback_data==='string'&&/^service_notification:[a-f0-9]{64}$/.test(body.biz_opaque_callback_data)
      &&keys(body.text,['body'])&&typeof body.text.body==='string'&&body.text.body.trim().length>0&&body.text.body.length<=4096;
  };
  const emptyFailure=init=>init.signal?.aborted?Promise.reject(init.signal.reason)
    :Promise.resolve(new Response('',{status:503,headers:{'cache-control':'no-store'}}));
  const failure=function(input,init){
    if(!restored){
      const body=bodyOf(init),c=modelCriteria(input,init,body);
      if(c.ownedRoute&&c.methodPost&&c.signal&&c.initCheckout&&c.headersCheckout&&c.bodyModel&&c.bodyCheckout){
        if(!init.signal.aborted)capturedCheckoutModelFailures++;return emptyFailure(init);
      }
      if(noticeMatches(input,init,body)){
        if(!init.signal.aborted)capturedServiceNoticeFailures++;return emptyFailure(init);
      }
      // This is classification for diagnosis, never an additional permission.
      const knownSdk=c.ownedRoute&&c.methodPost&&c.initSdk&&c.headersSdk&&c.bodyModel&&c.bodySdk;
      if(!knownSdk&&typeof input==='string'&&/\/chat\/completions(?:[?#]|$)/.test(input)){
        modelMismatchCount++;if(modelMismatches.length<3)modelMismatches.push(Object.freeze(c));
      }
    }
    delegatedAttempts++;return Reflect.apply(blockedFetch,target,[input,init]);
  };
  try{target.fetch=failure;}catch(error){try{target.fetch=blockedFetch;}finally{restored=true;}throw error;}
  return Object.freeze({
    evidence:()=>Object.freeze({profile:PROFILE,status:503,capturedCheckoutModelFailures,capturedServiceNoticeFailures,delegatedAttempts,modelMismatchCount,
      modelMismatches:modelMismatches.map(value=>({...value})),restored}),
    restore(){if(restored)return;try{assert.equal(target.fetch,failure,'native18_http_failure_lifetime_changed');}
      finally{target.fetch=blockedFetch;restored=true;}}
  });
}
