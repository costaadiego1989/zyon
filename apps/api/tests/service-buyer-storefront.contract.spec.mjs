import assert from 'node:assert/strict';
import test from 'node:test';
import {buyerStorefrontInit,buyerStorefrontReady,BUYER_STOREFRONT_ORIGIN} from './service-buyer-storefront-contract.mjs';

const runId='6c5300a2-2017-4300-967f-000000000093';
const artifact={buildId:'owned-next-build',manifestSha256:'a'.repeat(64),publicApiBaseUrl:'/api/v1'};
const init={type:'buyer_storefront_init',runId,apiOrigin:'http://127.0.0.1:23456',credential:'b'.repeat(96),artifact};
test('T93 compiled Next private bootstrap accepts only exact loopback issuer binding and same-origin public API',()=>{
  assert.deepEqual(buyerStorefrontInit(init,runId),init);
  assert.equal(BUYER_STOREFRONT_ORIGIN,'http://127.0.0.1:5188');
  assert.deepEqual(buyerStorefrontReady({type:'buyer_storefront_ready',runId,origin:BUYER_STOREFRONT_ORIGIN,
    artifact,actualNextApplication:true},runId,artifact),{origin:BUYER_STOREFRONT_ORIGIN,actualNextApplication:true,artifact});
});
test('T93 private Next ABI refuses credentials in ready evidence and arbitrary upstream, run, output or bundle',()=>{
  for(const patch of[{apiOrigin:'https://prod.example.test'},{apiOrigin:'http://localhost:23456'},
    {apiOrigin:'http://u:p@127.0.0.1:23456'},{apiOrigin:'http://127.0.0.1:23456/prefix'},
    {credential:'unsafe'},{runId:'foreign'},{publicFlag:true},{artifact:{...artifact,publicApiBaseUrl:'https://prod.example.test'}}])
    assert.throws(()=>buyerStorefrontInit({...init,...patch},runId));
  const ready={type:'buyer_storefront_ready',runId,origin:BUYER_STOREFRONT_ORIGIN,artifact,actualNextApplication:true};
  for(const patch of[{credential:init.credential},{origin:'http://127.0.0.1:5189'},
    {artifact:{...artifact,buildId:'changed'}},{runId:'foreign'},{actualNextApplication:false}])
    assert.throws(()=>buyerStorefrontReady({...ready,...patch},runId,artifact));
});
