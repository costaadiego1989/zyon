import assert from 'node:assert/strict';
import test from 'node:test';
import {createHumanUnknownDbFixture} from './whatsapp-human-unknown-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

test('T109 actual unknown notice receipts cannot authorize another SDK attempt',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHumanUnknownDbFixture();
  try{
    for(const kind of ['meta','legacy'])await t.test(kind+' persists actual first unknown and refuses blind replay',async st=>{
      const x=await f.unknownAttempt(kind,st);
      assert.equal(x.physicalAttempts(),1);assert.equal(x.modelCalls(),0);assert.equal(x.first.ok,false);
      assert.equal(x.first.code,kind==='meta'?'whatsapp_send_result_unknown':'whatsapp_delivery_requires_reconciliation');
      const original=await x.stored(),before=await x.snapshot();
      const authority=kind==='meta'?original.aiAuthority:original.response.aiAuthority;assert.equal(authority.epoch,0);assert.equal(authority.bindingId,null);
      if(kind==='meta'){assert.equal(original.phase,'dispatching');assert.deepEqual(original.sent,[]);assert.equal(original.purpose,'human_handoff');}
      else{assert.equal(original.state,'submission_unknown');assert.equal(original.providerMessageId,null);assert.equal(original.response.handoffNotice.confirmed,true);}
      const repeated=await x.replay();
      if(repeated.code!==(kind==='meta'?'whatsapp_turn_result_unknown':'whatsapp_delivery_requires_reconciliation')||x.physicalAttempts()!==1){
        console.log('human_unknown_replay_diagnostic '+JSON.stringify({kind,firstCode:x.first.code,replayCode:repeated.code??null,
          physicalRequests:x.physicalAttempts(),modelCalls:x.modelCalls(),originalReceiptKind:kind==='meta'?original.phase:original.state}));
      }
      assert.deepEqual(repeated,{ok:false,code:kind==='meta'?'whatsapp_turn_result_unknown':'whatsapp_delivery_requires_reconciliation'});
      assert.equal(x.physicalAttempts(),1);assert.equal(x.modelCalls(),0);assert.deepEqual(await x.stored(),original);assert.deepEqual(await x.snapshot(),before);

    });
  }finally{await f.close();}
});
