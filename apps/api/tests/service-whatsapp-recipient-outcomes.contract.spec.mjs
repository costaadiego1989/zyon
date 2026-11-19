import assert from 'node:assert/strict';
import test from 'node:test';
import {createLocalWhatsAppProviderFixture,validateLocalWhatsAppOptions} from './service-whatsapp-provider-fixture.mjs';

function sender(options){
  let scope;const events=[];
  const boundary={currentScope:()=>scope,start:async(actual,work)=>{assert.equal(actual,scope);return work();}};
  const fixture=createLocalWhatsAppProviderFixture(options,event=>events.push(event),boundary);
  return{events,async send(recipient,id){
    scope=Object.freeze({kind:'whatsapp',provider:'META_CLOUD',deviceId:'META_CLOUD:synthetic',recipient,messageId:id});
    return fixture.sender.sendText({provider:scope.provider,deviceId:scope.deviceId,toNumber:recipient,correlationId:id,text:'Synthetic reply'});
  }};
}
test('recipient outcomes are independent of which scenario sends first and cannot be mutated by a returned result',async()=>{
  const options={operatorOutcomesByRecipient:{'5511999991000':{status:'unknown',messageId:''},'5511999992000':{status:'sent',messageId:'accepted-owner'}}};
  const f=sender(options);
  const owner=await f.send('+5511999992000','owner-first');assert.deepEqual(owner,{status:'sent',messageId:'accepted-owner'});
  owner.status='unknown';options.operatorOutcomesByRecipient['5511999991000'].status='sent';
  assert.deepEqual(await f.send('5511999991000','staff-later'),{status:'unknown',messageId:''});
  assert.deepEqual(await f.send('+5511999992000','owner-again'),{status:'sent',messageId:'accepted-owner'});
  assert.deepEqual(f.events.map(event=>event.input.correlationId),['owner-first','staff-later','owner-again']);
  assert.deepEqual(f.events.map(event=>event.result.status),['sent','unknown','sent']);
});
test('recipient outcome options are bounded static responses and cannot mix ordinal scripts, destinations or credentials',()=>{
  const value={'5511999991000':{status:'unknown',messageId:''}};
  assert.deepEqual(validateLocalWhatsAppOptions({operatorOutcomesByRecipient:value}),{voiceTranscripts:{},operatorOutcomesByRecipient:value});
  for(const map of [null,[],{}, {'https://outside.example.test':{status:'sent',messageId:'fake'}},{'+5511999991000':{status:'unknown',messageId:''}},
    {'5511999991000':{status:'read',messageId:'fake'}},{'5511999991000':{status:'sent',messageId:''}},
    {'5511999991000':{status:'sent',messageId:'ok',accessToken:'forbidden'}},
    Object.fromEntries(Array.from({length:21},(_,i)=>['551199999'+String(1000+i),{status:'unknown',messageId:''}]))])
    assert.throws(()=>validateLocalWhatsAppOptions({operatorOutcomesByRecipient:map}),/local_operator_recipient_fixture_invalid/);
  assert.throws(()=>validateLocalWhatsAppOptions({operatorOutcomes:[],operatorOutcomesByRecipient:value}),/local_operator_script_mode_invalid/);
});
test('an unscripted operator recipient fails explicitly before emitting any fake provider response',async()=>{
  const f=sender({operatorOutcomesByRecipient:{'5511999991000':{status:'unknown',messageId:''}}});
  await assert.rejects(f.send('5511999993000','unconfigured-case'),/local_operator_recipient_outcome_required/);
  assert.deepEqual(f.events,[]);
});
test('the existing ordinal and default transport behavior remains unchanged when recipient scripting is absent',async()=>{
  const f=sender({operatorOutcomes:[{status:'unknown',messageId:''},{status:'sent',messageId:'old-second'}]});
  assert.deepEqual(await f.send('5511999992000','first'),{status:'unknown',messageId:''});
  assert.deepEqual(await f.send('5511999991000','second'),{status:'sent',messageId:'old-second'});
  const plain=sender(true);assert.deepEqual(await plain.send('5511999992000','default'),{messageId:'synthetic-whatsapp-1',status:'queued'});
});
