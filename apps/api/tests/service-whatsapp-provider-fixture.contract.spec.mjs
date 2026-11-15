import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createLocalWhatsAppProviderFixture,validateLocalWhatsAppOptions} from './service-whatsapp-provider-fixture.mjs';

test('local WhatsApp fixture rejects endpoints, credentials, malformed and oversized transcripts',()=>{
  assert.deepEqual(validateLocalWhatsAppOptions(true),{voiceTranscripts:{}});
  for(const value of [false,null,{url:'https://outside.example.test'},{accessToken:'not-allowed'},{voiceTranscripts:{bad:'Text'}},{voiceTranscripts:{'123':'x'.repeat(4001)}},{voiceTranscripts:{'123':''}}])
    assert.throws(()=>validateLocalWhatsAppOptions(value),/local_.*fixture/);
});
test('local sender captures real envelopes and attempt results as queued, never delivered/read',async()=>{
  const events=[],fixture=createLocalWhatsAppProviderFixture(true,event=>events.push(event));
  const first={provider:'META_CLOUD',deviceId:'META_CLOUD:synthetic',toNumber:'5511999991000',text:'Synthetic notice'};
  assert.deepEqual(await fixture.sender.sendText(first),{messageId:'synthetic-whatsapp-1',status:'queued'});
  const second={...first,mediaUrl:'https://synthetic.example.test/animation.webp',mimetype:'image/webp'};
  assert.deepEqual(await fixture.sender.sendMedia(second),{messageId:'synthetic-whatsapp-2',status:'queued'});
  assert.deepEqual(events,[{sequence:1,kind:'sendText',input:first,result:{messageId:'synthetic-whatsapp-1',status:'queued'}},
    {sequence:2,kind:'sendMedia',input:second,result:{messageId:'synthetic-whatsapp-2',status:'queued'}}]);
  assert.equal(fixture.attempts(),2);
});
test('child module override changes only explicit provider entries and restores original identity after failure',()=>{
  const token=Symbol('synthetic-sender'),auth={provide:Symbol('auth'),useValue:{}},repository={provide:Symbol('repository'),useValue:{}};
  class Channel{}class Media{}
  const original=[auth,{provide:token,useValue:{original:true}},repository,Media];
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,Channel);
  const fixture=createLocalWhatsAppProviderFixture(true,()=>{}),installation=fixture.install(Channel,token,Media);
  try{
    const active=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Channel);
    assert.equal(active[0],auth);assert.equal(active[2],repository);assert.equal(active[3],Media);assert.equal(active[1].useValue,fixture.sender);
    assert.deepEqual(installation.overrides,['whatsapp-channel.WHATSAPP_SENDER_PORT']);
    assert.throws(()=>{throw new Error('synthetic_app_construction_failed');},/synthetic_app_construction_failed/);
  }finally{installation.restore();}
  assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Channel),original);installation.restore();
  assert.throws(()=>fixture.install(Channel,Symbol('missing'),Media),/local_exact_sender_provider_required/);
  assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Channel),original);
});
test('explicit synthetic voice emits its exact requested scope and media identity, with no network',async()=>{
  const events=[],fixture=createLocalWhatsAppProviderFixture({voiceTranscripts:{'12345':'Quero falar com atendente'}},event=>events.push(event));
  const context={inboxId:'synthetic-inbox',conversationId:'synthetic-conversation'};
  const result=await fixture.media.interpret('synthetic-business','META_CLOUD:synthetic',{id:'12345',mimeType:'audio/ogg'},context);
  assert.deepEqual(result,{kind:'audio_transcript',text:'Quero falar com atendente',scope:{merchantId:'synthetic-business',deviceId:'META_CLOUD:synthetic',...context,mediaId:'12345'}});
  assert.equal(await fixture.media.interpret('synthetic-business','META_CLOUD:synthetic',{id:'12345',mimeType:'image/jpeg'},context),undefined);
  assert.equal(await fixture.media.interpret('synthetic-business','META_CLOUD:synthetic',{id:'99999',mimeType:'audio/ogg'},context),undefined);
  assert.equal(events.length,3);assert.deepEqual(events[0].result,result);assert.equal(fixture.attempts(),3);
});
