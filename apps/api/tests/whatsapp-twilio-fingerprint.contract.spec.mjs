import assert from 'node:assert/strict';
import test from 'node:test';
import {PrismaWhatsAppWebhookInbox,isEquivalentTwilioReplay} from '../dist/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js';

const payload={merchantId:'synthetic-merchant',deviceId:'synthetic-device',provider:'TWILIO',fromNumber:'+5511999999999',body:'Original provider message',messageType:'text',timestamp:1000};
test('T50 replay retains provider identifiers, selection and nested media fields',()=>{
  for(const [field,original,changed]of [
    ['providerMessageId','SM-original','SM-changed'],['interactiveId','selection-original','selection-changed'],
    ['metaMedia',{id:'12345',mimeType:'audio/ogg'},{id:'67890',mimeType:'audio/ogg'}],
    ['flowResponse',{selected:'original'},{selected:'changed'}],['catalogOrder',{items:[{id:'one',quantity:1}]},{items:[{id:'one',quantity:2}]}],
  ]){
    const previous={...payload,[field]:original};
    assert.equal(isEquivalentTwilioReplay(previous,{...previous,timestamp:2000}),true,field+' same data');
    assert.equal(isEquivalentTwilioReplay(previous,{...previous,[field]:changed,timestamp:2000}),false,field+' changed data');
  }
});
test('T50 duplicate boundary does not grant the message exception to status, Meta or BubbleWhats',async()=>{
  for(const[kind,provider]of [['status','TWILIO'],['message','META_CLOUD'],['message','BUBBLEWHATS']]){
    const previous=Object.freeze({...payload,provider});
    // A narrow unit transaction fixture supplies an existing immutable row;
    // no AppModule/auth/repository is replaced in the real native tests.
    const tx={$executeRaw:async()=>0,$queryRaw:async()=>[{payload_hash:'original-hash',payload:previous}]};
    const repo=new PrismaWhatsAppWebhookInbox({$transaction:async work=>work(tx)});
    await assert.rejects(repo.accept([{dedupKey:'synthetic-dedup',eventId:'synthetic-event',kind,merchantId:payload.merchantId,
      configId:'synthetic-config',deviceId:payload.deviceId,streamKey:'synthetic-stream',payload:{...previous,timestamp:2000},payloadHash:'different-hash'}]),
      error=>error.getStatus()===409&&error.message==='webhook_event_payload_conflict',kind+' '+provider);
  }
});
