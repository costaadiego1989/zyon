import assert from 'node:assert/strict';
import test from 'node:test';
import {installNative18HttpFailures} from './service-native18-http-failures.mjs';
const profile='closed-failures-v1',config={baseUrl:'http://127.0.0.1:18475/v1',apiKey:'a'.repeat(64),model:'synthetic-only'};
const secondBuyerPair=['900046000015','5511998000016'];
const url='https://graph.facebook.com/v23.0/900046000015/messages';
const notice=to=>({method:'POST',redirect:'error',signal:AbortSignal.timeout(15_000),
  headers:{Authorization:'Bearer synthetic-not-a-provider-secret','Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',to,biz_opaque_callback_data:'service_notification:'+'b'.repeat(64),type:'text',text:{body:'Private canonical notice'}})});

test('Actual case13 A15 and authenticated second buyer B16 share the same merchant connection; only explicit B whitelist adds its failure response',async()=>{
  const denied=Error('unchanged-blocked-fetch');let calls=0;
  const original=()=>{calls++;throw denied;},target={fetch:original};
  let fixture=installNative18HttpFailures(profile,config,target);
  try{assert.throws(()=>target.fetch(url,notice(secondBuyerPair[1])),e=>e===denied);assert.equal(fixture.evidence().capturedServiceNoticeFailures,0);}
  finally{fixture.restore();}
  fixture=installNative18HttpFailures(profile,{...config,additionalNoticeRecipients:[secondBuyerPair]},target);
  try{
    for(const to of['5511998000015','5511998000016']){
      const response=await target.fetch(url,notice(to));assert.equal(response.status,503);assert.equal(response.ok,false);assert.equal(await response.text(),'');
    }
    assert.equal(fixture.evidence().capturedServiceNoticeFailures,2);assert.equal(calls,1);
    assert.throws(()=>target.fetch(url,notice('5511998000017')),e=>e===denied);
    assert.throws(()=>target.fetch('https://graph.facebook.com/v23.0/900046000014/messages',notice('5511998000016')),e=>e===denied);
    assert.equal(fixture.evidence().capturedServiceNoticeFailures,2);assert.equal(calls,3);
  }finally{fixture.restore();}
  assert.equal(target.fetch,original);
});

test('Additional recipient configuration is exactly one closed A15/B16 pair and cannot enable arbitrary or extra recipients',()=>{
  const original=()=>{},target={fetch:original};
  for(const additionalNoticeRecipients of[[],[['900046000015','5511998000017']],[['900046000016','5511998000016']],
    [secondBuyerPair,['900046000015','5511998000017']],[...secondBuyerPair],{accountId:secondBuyerPair[0],to:secondBuyerPair[1]},true]){
    assert.throws(()=>installNative18HttpFailures(profile,{...config,additionalNoticeRecipients},target),/native18_http_failure_/);
    assert.equal(target.fetch,original);
  }
});
