import assert from 'node:assert/strict';
import test from 'node:test';
import {validateNative18HttpFailures,installNative18HttpFailures} from './service-native18-http-failures.mjs';
import {installOwnedLocalModelFailureFixture} from './service-local-model-failure-fixture.mjs';
const profile='closed-failures-v1',config={baseUrl:'http://127.0.0.1:18475/v1',apiKey:'a'.repeat(64),model:'synthetic-only'};
const options={local:true,whatsapp:true,metaCapabilitiesFixture:'owned-empty-v1',recoveryTemplateMonitorFixture:'manual-only-v1',bookingAwaitTrace:'native18-v1',localModelFailureFixture:'owned-503-v1',native18HttpFailures:profile};
const chatUrl=config.baseUrl+'/chat/completions',noticeUrl='https://graph.facebook.com/v23.0/900046000014/messages';
const checkout=()=>({method:'POST',signal:new AbortController().signal,headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.apiKey},
  body:JSON.stringify({model:'synthetic-only',messages:[{role:'user',content:'private-content'}],tools:[],max_tokens:300,temperature:0.3})});
const sdk=()=>({...checkout(),headers:{...checkout().headers,'HTTP-Referer':'https://zyon.ai','X-Title':'AACP Checkout'},
  body:JSON.stringify({model:'synthetic-only',messages:[],stream:false,max_tokens:100,temperature:0})});
const notice=()=>({method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),headers:{Authorization:'Bearer synthetic-not-a-provider-secret','Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',to:'5511998000014',biz_opaque_callback_data:'service_notification:'+'b'.repeat(64),type:'text',text:{body:'Private canonical appointment notice'}})});

test('Closed failure selector is omitted by default and requires the explicit native18 dependency profiles',()=>{
  assert.equal(validateNative18HttpFailures({}),undefined);assert.equal(validateNative18HttpFailures(options),profile);
  for(const change of[{native18HttpFailures:true},{native18HttpFailures:'success'},{local:false},{whatsapp:undefined},{bookingAwaitTrace:undefined},
    {localModelFailureFixture:undefined},{metaCapabilitiesFixture:undefined},{recoveryTemplateMonitorFixture:undefined},{modelScript:[]},{graph:true},{buyerBooking:true},{storefrontQueryModel:true},{supportQueryModel:true}])
    assert.throws(()=>validateNative18HttpFailures({...options,...change}),/native18_http_failure_/);
  const original=()=>{},target={fetch:original};assert.equal(installNative18HttpFailures(undefined,config,target),undefined);assert.equal(target.fetch,original);
});

test('Real checkout gateway two-header wire receives only empty503 at the exact owned synthetic route',async()=>{
  let external=0;const original=()=>{external++;throw Error('external-forbidden');},target={fetch:original};
  const fixture=installNative18HttpFailures(profile,config,target);
  try{const result=await target.fetch(chatUrl,checkout());assert.equal(result.status,503);assert.equal(result.ok,false);assert.equal(await result.text(),'');
    const evidence=fixture.evidence();assert.equal(evidence.capturedCheckoutModelFailures,1);assert.equal(evidence.capturedServiceNoticeFailures,0);assert.equal(external,0);}
  finally{fixture.restore();}assert.equal(target.fetch,original);
});

test('Existing SDK four-header failure fixture and its result remain the original separate seam in strict reverse order',async()=>{
  const original=()=>{throw Error('external-forbidden');},target={fetch:original};
  const old=installOwnedLocalModelFailureFixture('owned-503-v1',config,target),oldFetch=target.fetch;
  const added=installNative18HttpFailures(profile,config,target);
  try{const result=await target.fetch(chatUrl,sdk());assert.equal(result.status,503);assert.equal(await result.text(),'');
    assert.equal(old.evidence().capturedFailures,1);assert.equal(added.evidence().capturedCheckoutModelFailures,0);assert.equal(added.evidence().modelMismatchCount,0);}
  finally{added.restore();assert.equal(target.fetch,oldFetch);old.restore();}
  assert.equal(target.fetch,original);assert.equal(added.evidence().restored,true);assert.equal(old.evidence().restored,true);
});

test('Genuine synthetic service notice text wire receives empty503 and no fake Meta message acceptance',async()=>{
  let external=0;const target={fetch:()=>{external++;throw Error('external-forbidden');}},fixture=installNative18HttpFailures(profile,config,target);
  try{const result=await target.fetch(noticeUrl,notice());assert.equal(result.status,503);assert.equal(result.ok,false);assert.equal(await result.text(),'');
    assert.equal(fixture.evidence().capturedServiceNoticeFailures,1);assert.equal(fixture.evidence().capturedCheckoutModelFailures,0);assert.equal(external,0);}
  finally{fixture.restore();}
});

test('Foreign routes, credential or body deviations preserve the exact prior blocked fetch arguments and promise',()=>{
  let expectedInput,expectedInit;const answer=Promise.resolve({blocked:true});
  const original=(input,init)=>{assert.equal(input,expectedInput);assert.equal(init,expectedInit);return answer;},target={fetch:original},fixture=installNative18HttpFailures(profile,config,target);
  const bodyPatch=patch=>({...notice(),body:JSON.stringify({...JSON.parse(notice().body),...patch})});
  try{const cases=[
    ['https://outside.invalid/v1/chat/completions',checkout()],[chatUrl+'?x=1',checkout()],[config.baseUrl+'/embeddings',checkout()],
    [chatUrl,{...checkout(),method:null}],[chatUrl,{...checkout(),redirect:'error'}],[chatUrl,{...checkout(),headers:{...checkout().headers,Authorization:'Bearer wrong'}}],
    [chatUrl,{...checkout(),body:JSON.stringify({...JSON.parse(checkout().body),model:'other'})}],
    [chatUrl,{...checkout(),body:JSON.stringify({...JSON.parse(checkout().body),stream:true})}],
    [chatUrl,{...checkout(),body:JSON.stringify({...JSON.parse(checkout().body),max_tokens:301})}],
    [chatUrl,{...checkout(),signal:undefined}],[chatUrl,{...checkout(),credentials:'include'}],
    ['https://graph.facebook.com/v23.0/900046000015/messages',notice()],['https://graph.facebook.com/v23.0/100046000014/messages',notice()],
    [noticeUrl+'?x=1',notice()],[noticeUrl.replace('https:','http:'),notice()],[noticeUrl,{...notice(),method:'DELETE'}],
    [noticeUrl,{...notice(),redirect:undefined}],[noticeUrl,{...notice(),headers:{...notice().headers,Authorization:'Bearer wrong'}}],
    [noticeUrl,bodyPatch({to:'5511888000014'})],[noticeUrl,bodyPatch({to:'5511998000015'})],
    [noticeUrl,bodyPatch({biz_opaque_callback_data:'anything'})],[noticeUrl,bodyPatch({type:'template'})],
    [noticeUrl,bodyPatch({type:'sticker',sticker:{link:'https://example.invalid/image.webp'}})],
    [noticeUrl,bodyPatch({text:{body:'',preview_url:true}})],[noticeUrl,bodyPatch({unrecognized:true})]
  ];
  for(const[input,init]of cases){expectedInput=input;expectedInit=init;assert.equal(target.fetch(input,init),answer);}
  assert.equal(fixture.evidence().capturedCheckoutModelFailures,0);assert.equal(fixture.evidence().capturedServiceNoticeFailures,0);assert.equal(fixture.evidence().delegatedAttempts,cases.length);
  }finally{fixture.restore();}
});

test('Model mismatch diagnostic contains only a bounded set of boolean predicates and counts, no private wire values',async()=>{
  const error=Error('same-original-private-error'),target={fetch:()=>{throw error;}},fixture=installNative18HttpFailures(profile,config,target);
  try{for(let index=0;index<5;index++)assert.throws(()=>target.fetch('https://outside.invalid/v1/chat/completions',checkout()),e=>e===error);
    const evidence=fixture.evidence();assert.equal(evidence.modelMismatchCount,5);assert.equal(evidence.modelMismatches.length,3);
    for(const sample of evidence.modelMismatches){assert.deepEqual(Object.keys(sample).sort(),['bodyCheckout','bodyModel','bodySdk','headersCheckout','headersSdk','initCheckout','initSdk','methodPost','ownedRoute','signal']);assert.ok(Object.values(sample).every(value=>typeof value==='boolean'));assert.equal(sample.ownedRoute,false);}
    const serialized=JSON.stringify(evidence);for(const secret of[config.apiKey,config.baseUrl,'outside.invalid','private-content','Authorization','same-original-private-error'])assert.equal(serialized.includes(secret),false);
  }finally{fixture.restore();}
});

test('Aborted matched requests keep the original reason, and lifetime errors still restore the exact previous fetch',async()=>{
  const original=()=>{},target={fetch:original},fixture=installNative18HttpFailures(profile,config,target),controller=new AbortController(),error=Error('abort-original');controller.abort(error);
  await assert.rejects(target.fetch(chatUrl,{...checkout(),signal:controller.signal}),e=>e===error);
  assert.equal(fixture.evidence().capturedCheckoutModelFailures,0);target.fetch=()=>{};
  assert.throws(()=>fixture.restore(),/native18_http_failure_lifetime_changed/);assert.equal(target.fetch,original);fixture.restore();assert.equal(fixture.evidence().restored,true);
});
