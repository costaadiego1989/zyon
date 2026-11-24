import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {validateServedModelScript} from './service-served-model-script.mjs';
import {createPublicStorefrontModelFixture} from './service-public-storefront-model-fixture.mjs';

const runId='6c5300a2-2017-4300-967f-000000000043';
const names=['get_service_professionals','get_service_dates','get_service_slots','resolve_service_selection'];
const args={productId:'service-a',variantId:'variant-a'};
function transport(step){
 class KnowledgeBaseModule{}class StorefrontModule{}class QueryKnowledgeUseCase{}
 const token=Symbol('owned-provider-transport');
 Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,[QueryKnowledgeUseCase],KnowledgeBaseModule);
 Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,[],StorefrontModule);
 const events=[],fixture=createPublicStorefrontModelFixture(runId,event=>events.push(event),[step]);
 // Only fixture metadata is hosted here. No productive handler/auth/repository
 // is installed or invoked by this transport contract; native tests own that.
 const installation=fixture.install({KnowledgeBaseModule,StorefrontModule,QueryKnowledgeUseCase,STOREFRONT_PROVIDER_FETCH_FACTORY:token});
 const factory=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,StorefrontModule).find(provider=>provider.provide===token).useValue;
 return{events,fetch:factory('primary'),close(){installation.restore();fixture.closeModelScript();}};
}
const request=(name)=>({method:'POST',body:JSON.stringify({stream:false,model:'synthetic',messages:[{role:'system',content:JSON.stringify({id:'storefront.sales'})}],tools:[{type:'function',function:{name}}]})});
test('T43 private model fixture emits the real named read/proposal function and no fabricated handler result',async()=>{
 for(const name of names){
  const step={phase:'storefront.sales',serviceToolCall:{name,args,narration:'MODEL_CLAIM_MUST_NOT_BE_AUTHORITY'}};
  assert.deepEqual(validateServedModelScript([step]),[step]);const f=transport(step);
  try{const response=await f.fetch('http://127.0.0.1:19443/chat/completions',request(name)),body=await response.json();
   assert.equal(body.choices[0].finish_reason,'tool_calls');const message=body.choices[0].message;
   assert.equal(message.content,'MODEL_CLAIM_MUST_NOT_BE_AUTHORITY');assert.equal(message.tool_calls[0].function.name,name);assert.deepEqual(JSON.parse(message.tool_calls[0].function.arguments),args);
   assert.equal(Object.hasOwn(message,'result'),false);assert.equal(f.events.length,1);assert.deepEqual(f.events[0].input.toolNames,[name]);
  }finally{f.close();}
 }
});
test('T43 fixture refuses unannounced/mutating tools and extra/unbounded synthetic authority',async()=>{
 for(const call of[{name:'confirm_service_booking',args},{name:'create_payment',args},{name:names[0],args:[]},{name:names[0],args,narration:'x'.repeat(601)},{name:names[0],args,result:{kind:'selection'}},{name:names[0],args,confirmed:true}])assert.throws(()=>validateServedModelScript([{phase:'storefront.sales',serviceToolCall:call}]));
 assert.throws(()=>validateServedModelScript([{phase:'storefront.sales',serviceToolCall:{name:names[0],args},response:'fake-success'}]));
 const f=transport({phase:'storefront.sales',serviceToolCall:{name:names[0],args}});try{await assert.rejects(f.fetch('http://127.0.0.1:19443/chat/completions',request('search_products')),/real_service_tool_must_be_announced/);}finally{f.close();}
});
