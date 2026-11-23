import assert from 'node:assert/strict';
import test from 'node:test';
import {validateOwnedLocalModelFailureFixture,installOwnedLocalModelFailureFixture} from './service-local-model-failure-fixture.mjs';
const options={local:true,whatsapp:true,metaCapabilitiesFixture:'owned-empty-v1',recoveryTemplateMonitorFixture:'manual-only-v1',bookingAwaitTrace:'native18-v1',localModelFailureFixture:'owned-503-v1'};
const config={baseUrl:'http://127.0.0.1:18475/v1',apiKey:'a'.repeat(64),model:'synthetic-only'};
const request=()=>({method:'POST',headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','HTTP-Referer':'https://zyon.ai','X-Title':'AACP Checkout'},body:JSON.stringify({model:'synthetic-only',messages:[{role:'user',content:'private-never-observed'}],stream:false,max_tokens:100,temperature:0})});
const url=config.baseUrl+'/chat/completions';

test('Failure fixture is omitted without side effects and only native18 explicitly selects its closed profile',()=>{
  assert.equal(validateOwnedLocalModelFailureFixture({}),undefined);
  assert.equal(validateOwnedLocalModelFailureFixture(options),'owned-503-v1');
  for(const change of[{localModelFailureFixture:true},{localModelFailureFixture:'success'},{local:false},{whatsapp:undefined},{bookingAwaitTrace:undefined},{modelScript:[]},{storefrontQueryModel:true},{supportQueryModel:true},{graph:true},{buyerBooking:true},{metaCapabilitiesFixture:undefined},{recoveryTemplateMonitorFixture:undefined}])
    assert.throws(()=>validateOwnedLocalModelFailureFixture({...options,...change}),/local_model_failure_fixture_/);
  const blocked=()=>{};const target={fetch:blocked};assert.equal(installOwnedLocalModelFailureFixture(undefined,config,target),undefined);assert.equal(target.fetch,blocked);
});

test('Exact owned synthetic chat wire receives only an empty503, without model result, usage or external call',async()=>{
  let calls=0;const blocked=()=>{calls++;throw Error('unexpected-network');},target={fetch:blocked};
  const installed=installOwnedLocalModelFailureFixture('owned-503-v1',config,target);
  try{
    const result=await target.fetch(url,request());assert.equal(result.status,503);assert.equal(result.ok,false);assert.equal(await result.text(),'');assert.equal(calls,0);
    assert.deepEqual(installed.evidence(),{profile:'owned-503-v1',status:503,capturedFailures:1,delegatedAttempts:0,restored:false});
    const evidence=JSON.stringify(installed.evidence());for(const secret of[config.apiKey,config.baseUrl,'private-never-observed','choices','usage'])assert.equal(evidence.includes(secret),false);
  }finally{installed.restore();}
  assert.equal(target.fetch,blocked);assert.equal(installed.evidence().restored,true);installed.restore();assert.equal(target.fetch,blocked);
});

test('Wrong host, port, path, query, method, headers, model or body delegate the exact original arguments and promise',()=>{
  let expectedInput,expectedInit;const answer=Promise.resolve({blocked:true});
  const blocked=(input,init)=>{assert.equal(input,expectedInput);assert.equal(init,expectedInit);return answer;},target={fetch:blocked};
  const installed=installOwnedLocalModelFailureFixture('owned-503-v1',config,target);
  try{
    const variants=[
      ['http://127.0.0.1:18476/v1/chat/completions',request()],['https://example.invalid/v1/chat/completions',request()],
      [url+'?x=1',request()],[config.baseUrl+'/embeddings',request()],[new URL(url),request()],
      [url,{...request(),method:'GET'}],[url,{...request(),method:null}],[url,{...request(),method:undefined}],
      [url,{...request(),redirect:'error'}],[url,{...request(),credentials:'include'}],
      [url,{...request(),headers:{...request().headers,Authorization:'Bearer wrong'}}],
      [url,{...request(),headers:{...request().headers,'X-Extra':'never-allow'}}],
      [url,{...request(),body:'malformed'}],[url,{...request(),body:JSON.stringify({model:'other',messages:[],stream:false})}],
      [url,{...request(),body:JSON.stringify({model:'synthetic-only',messages:[],stream:true})}],
      [url,{...request(),body:JSON.stringify({model:'synthetic-only',messages:[],stream:false,unexpected:true})}],
      [url,{...request(),body:new Uint8Array([1,2])}],[url,undefined]
    ];
    for(const[input,init]of variants){expectedInput=input;expectedInit=init;assert.equal(target.fetch(input,init),answer);}
    assert.equal(installed.evidence().capturedFailures,0);assert.equal(installed.evidence().delegatedAttempts,variants.length);
  }finally{installed.restore();}
});

test('Delegated synchronous errors and asynchronous rejections keep identity and do not become controlled success',async()=>{
  const error=Error('original-private');let async=false;const target={fetch:()=>{if(async)return Promise.reject(error);throw error;}};
  const installed=installOwnedLocalModelFailureFixture('owned-503-v1',config,target);
  try{assert.throws(()=>target.fetch('https://outside.invalid',request()),e=>e===error);async=true;await assert.rejects(target.fetch('https://outside.invalid',request()),e=>e===error);assert.equal(installed.evidence().capturedFailures,0);}
  finally{installed.restore();}
});

test('Already aborted owned calls reject with the original reason and never capture a503',async()=>{
  const original=()=>{throw Error('blocked');},target={fetch:original},controller=new AbortController(),reason=Error('original-abort');controller.abort(reason);
  const installed=installOwnedLocalModelFailureFixture('owned-503-v1',config,target);
  try{await assert.rejects(target.fetch(url,{...request(),signal:controller.signal}),e=>e===reason);assert.equal(installed.evidence().capturedFailures,0);assert.equal(installed.evidence().delegatedAttempts,0);}
  finally{installed.restore();}
});

test('Invalid installation never changes fetch; changed lifetime still restores the exact previous function',()=>{
  const original=()=>{},target={fetch:original};
  for(const patch of[{baseUrl:'https://example.invalid/v1'},{baseUrl:'http://127.0.0.1:18475/v1?query=1'},{baseUrl:'http://user@127.0.0.1:18475/v1'},{apiKey:'not-owned-key'},{model:'other'}]){
    assert.throws(()=>installOwnedLocalModelFailureFixture('owned-503-v1',{...config,...patch},target),/local_model_failure_fixture_/);assert.equal(target.fetch,original);
  }
  const installed=installOwnedLocalModelFailureFixture('owned-503-v1',config,target);target.fetch=()=>{};
  assert.throws(()=>installed.restore(),/local_model_failure_fixture_lifetime_changed/);assert.equal(target.fetch,original);assert.equal(installed.evidence().restored,true);installed.restore();
});
