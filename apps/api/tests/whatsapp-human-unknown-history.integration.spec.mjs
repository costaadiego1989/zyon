import assert from 'node:assert/strict';
import test from 'node:test';
import {createHumanUnknownHistoryDbFixture} from './whatsapp-human-unknown-history-db-fixture.mjs';
import {SERVICE_LOCAL_TEST_MS} from './service-test-startup.mjs';

// Mandatory Full56/57 companion; not selected on the independent55 repair base.
test('T56/T57 unknown historical notice after canonical close and new handoff',{timeout:SERVICE_LOCAL_TEST_MS},async t=>{
  const f=await createHumanUnknownHistoryDbFixture();
  try{
    await t.test('old unknown notice never mutates the new canonical handoff',async st=>{
      const kind='meta';
      const x=await f.unknownAttempt(kind,st);
      assert.equal(x.physicalAttempts(),1);assert.equal(x.modelCalls(),0);assert.equal(x.first.ok,false);
      assert.equal(x.first.code,kind==='meta'?'whatsapp_send_result_unknown':'whatsapp_delivery_requires_reconciliation');
      const original=await x.stored(),before=await x.snapshot();
      if(kind==='meta'){assert.equal(original.phase,'dispatching');assert.deepEqual(original.sent,[]);assert.equal(original.purpose,'human_handoff');}
      else{assert.equal(original.state,'submission_unknown');assert.equal(original.providerMessageId,null);assert.equal(original.response.handoffNotice.confirmed,true);}
      const repeated=await x.replay();
      if(repeated.code!==(kind==='meta'?'whatsapp_turn_result_unknown':'whatsapp_delivery_requires_reconciliation')||x.physicalAttempts()!==1){
        console.log('human_unknown_replay_diagnostic '+JSON.stringify({kind,firstCode:x.first.code,replayCode:repeated.code??null,
          physicalRequests:x.physicalAttempts(),modelCalls:x.modelCalls(),originalReceiptKind:kind==='meta'?original.phase:original.state}));
      }
      assert.deepEqual(repeated,{ok:false,code:kind==='meta'?'whatsapp_turn_result_unknown':'whatsapp_delivery_requires_reconciliation'});
      assert.equal(x.physicalAttempts(),1);assert.equal(x.modelCalls(),0);assert.deepEqual(await x.stored(),original);assert.deepEqual(await x.snapshot(),before);
      if(kind==='meta'){
        const next=await f.replaceHandoff(x.value,x.notice);assert.notEqual(next.notice.ticketId,x.notice.ticketId);
        const current=await f.raw.whatsAppHandoffBinding.findUniqueOrThrow({where:{id:next.notice.bindingId}});
        assert.deepEqual(await x.replay(),{ok:true});
        const consumed=await x.stored();assert.equal(consumed.purpose,'human_received');assert.deepEqual(consumed.sent,[]);
        assert.deepEqual(consumed.aiAuthority,original.aiAuthority);assert.equal(x.physicalAttempts(),1);assert.equal(x.modelCalls(),0);
        assert.deepEqual(await f.raw.whatsAppHandoffBinding.findUniqueOrThrow({where:{id:next.notice.bindingId}}),current);
      }
    });
  }finally{await f.close();}
});
