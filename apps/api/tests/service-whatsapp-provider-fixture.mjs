import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createOwnedMarketingOpeningFetch} from './service-marketing-opening-fetch-fixture.mjs';

export function validateLocalWhatsAppOptions(value){
  assert.ok(value===true||value&&typeof value==='object'&&!Array.isArray(value),'local_whatsapp_fixture_required');
  const options=value===true?{}:value;
  assert.ok(Object.keys(options).every(key=>['voiceTranscripts','operatorOutcomes','operatorOutcomesByRecipient','operatorStatusCallbacks','marketingOpening'].includes(key)),'local_whatsapp_fixture_options_invalid');
  assert.ok(options.operatorStatusCallbacks===undefined||options.operatorStatusCallbacks===true,'local_operator_status_fixture_invalid');
  assert.ok(options.marketingOpening===undefined||options.marketingOpening===true,'local_marketing_opening_fixture_invalid');
  const transcripts=options.voiceTranscripts??{};
  assert.ok(transcripts&&typeof transcripts==='object'&&!Array.isArray(transcripts)&&Object.keys(transcripts).length<=20,'local_voice_fixture_invalid');
  for(const [mediaId,text]of Object.entries(transcripts))assert.ok(/^\d{1,80}$/.test(mediaId)&&typeof text==='string'&&text.trim()&&text.length<=4000,'local_voice_fixture_invalid');
  const outcomes=options.operatorOutcomes;
  const byRecipient=options.operatorOutcomesByRecipient;
  assert.ok(outcomes===undefined||byRecipient===undefined,'local_operator_script_mode_invalid');
  if(byRecipient!==undefined){
    assert.ok(byRecipient&&typeof byRecipient==='object'&&!Array.isArray(byRecipient)
      &&Object.keys(byRecipient).length>0&&Object.keys(byRecipient).length<=20,'local_operator_recipient_fixture_invalid');
    for(const [recipient,outcome]of Object.entries(byRecipient))assert.ok(/^\d{8,20}$/.test(recipient)
      &&outcome&&typeof outcome==='object'&&!Array.isArray(outcome)&&Object.keys(outcome).length===2
      &&Object.hasOwn(outcome,'status')&&Object.hasOwn(outcome,'messageId')&&['queued','sent','failed','unknown'].includes(outcome.status)
      &&typeof outcome.messageId==='string'&&outcome.messageId.length<=1024
      &&(outcome.status==='queued'||outcome.status==='sent'?!!outcome.messageId&&!/\s|[\u0000-\u001f\u007f]/.test(outcome.messageId):outcome.messageId===''),
    'local_operator_recipient_fixture_invalid');
  }
  if(outcomes!==undefined){
    assert.ok(Array.isArray(outcomes)&&outcomes.length<=20,'local_operator_fixture_invalid');
    for(const outcome of outcomes)assert.ok(outcome&&typeof outcome==='object'&&!Array.isArray(outcome)
      &&Object.keys(outcome).length===2&&Object.hasOwn(outcome,'status')&&Object.hasOwn(outcome,'messageId')
      &&['queued','sent','failed','unknown'].includes(outcome.status)&&typeof outcome.messageId==='string'&&outcome.messageId.length<=1024
      &&(outcome.status==='queued'||outcome.status==='sent'?!!outcome.messageId&&!/\s|[\u0000-\u001f\u007f]/.test(outcome.messageId):outcome.messageId===''),
    'local_operator_fixture_invalid');
  }
  return {voiceTranscripts:{...transcripts},...(outcomes===undefined?{}:{operatorOutcomes:outcomes.map(outcome=>({...outcome}))}),
    ...(byRecipient===undefined?{}:{operatorOutcomesByRecipient:Object.fromEntries(Object.entries(byRecipient).map(([recipient,outcome])=>[recipient,{...outcome}]))}),
    ...(options.operatorStatusCallbacks?{operatorStatusCallbacks:true}:{}),...(options.marketingOpening?{marketingOpening:true}:{})};
}

/** Test child DI only. No global network function or production module source
 * is changed; the original metadata is restored immediately after creation. */
export function createLocalWhatsAppProviderFixture(options,onEvent,submissionBoundary){
  const normalized=validateLocalWhatsAppOptions(options);let sequence=0,operatorSequence=0;
  const emit=(kind,input,result)=>{const event={sequence:++sequence,kind,input:structuredClone(input),result:structuredClone(result)};onEvent(event);return result;};
  const sender={
    async sendText(input){
      const scope=submissionBoundary?.currentScope();
      if(!scope)return emit('sendText',input,{messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'});
      assert.ok(Object.isFrozen(scope)&&scope.kind==='whatsapp','local_operator_scope_required');
      assert.equal(input.deviceId,scope.deviceId);assert.equal(input.provider,scope.provider);
      assert.equal(input.toNumber,scope.recipient);assert.equal(input.correlationId,scope.messageId);
      let result;
      if(normalized.operatorOutcomesByRecipient){
        const recipient=scope.recipient.replace(/^\+/,'');
        assert.ok(Object.hasOwn(normalized.operatorOutcomesByRecipient,recipient),'local_operator_recipient_outcome_required');
        result={...normalized.operatorOutcomesByRecipient[recipient]};
      }else result=normalized.operatorOutcomes?.[operatorSequence++]??{messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'};
      return submissionBoundary.start(scope,async()=>emit('sendText',input,result));
    },
    async sendMedia(input){return emit('sendMedia',input,{messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'});},
  };
  const media={async interpret(merchantId,deviceId,input,context){
    const text=normalized.voiceTranscripts[input.id];
    const result=text&&context&&input.mimeType?.split(';')[0]==='audio/ogg'
      ?{kind:'audio_transcript',text,scope:{merchantId,deviceId,inboxId:context.inboxId,conversationId:context.conversationId,mediaId:input.id}}:undefined;
    return emit('voiceInterpret',{merchantId,deviceId,media:input,context},result);
  }};
  const marketingFetch=normalized.marketingOpening?createOwnedMarketingOpeningFetch((payload)=>{
    const result=emit('sendText',{provider:'META_CLOUD',toNumber:payload.to,text:'',
      uiMessage:{type:'interactive',interactive:payload.interactive},marketingOpening:true},
      {messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'});
    return result.messageId;
  }):undefined;
  function install(channelModule,senderToken,mediaType){
    const original=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,channelModule);
    assert.ok(Array.isArray(original),'local_channel_provider_metadata_required');
    const senderEntries=original.filter(provider=>provider&&typeof provider==='object'&&provider.provide===senderToken);
    assert.equal(senderEntries.length,1,'local_exact_sender_provider_required');
    const withVoice=Object.keys(normalized.voiceTranscripts).length>0;
    if(withVoice)assert.equal(original.filter(provider=>provider===mediaType).length,1,'local_exact_media_provider_required');
    const replacements=original.map(provider=>senderEntries.includes(provider)?{provide:senderToken,useValue:sender}
      :withVoice&&provider===mediaType?{provide:mediaType,useValue:media}:provider);
    assert.equal(replacements.filter((provider,index)=>provider!==original[index]).length,withVoice?2:1);
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,replacements,channelModule);let restored=false;
    return{overrides:withVoice?['whatsapp-channel.WHATSAPP_SENDER_PORT','MetaInboundMediaAdapter']:['whatsapp-channel.WHATSAPP_SENDER_PORT'],restore(){
      if(restored)return;assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,channelModule),replacements,'local_provider_metadata_changed_unexpectedly');
      Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,channelModule);restored=true;
      assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,channelModule),original);
    }};
  }
  return{sender,media,marketingFetch,install,attempts:()=>sequence};
}
