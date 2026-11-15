import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';

export function validateLocalWhatsAppOptions(value){
  assert.ok(value===true||value&&typeof value==='object'&&!Array.isArray(value),'local_whatsapp_fixture_required');
  const options=value===true?{}:value;
  assert.ok(Object.keys(options).every(key=>key==='voiceTranscripts'),'local_whatsapp_fixture_options_invalid');
  const transcripts=options.voiceTranscripts??{};
  assert.ok(transcripts&&typeof transcripts==='object'&&!Array.isArray(transcripts)&&Object.keys(transcripts).length<=20,'local_voice_fixture_invalid');
  for(const [mediaId,text]of Object.entries(transcripts))assert.ok(/^\d{1,80}$/.test(mediaId)&&typeof text==='string'&&text.trim()&&text.length<=4000,'local_voice_fixture_invalid');
  return {voiceTranscripts:{...transcripts}};
}

/** Test child DI only. No global network function or production module source
 * is changed; the original metadata is restored immediately after creation. */
export function createLocalWhatsAppProviderFixture(options,onEvent){
  const normalized=validateLocalWhatsAppOptions(options);let sequence=0;
  const emit=(kind,input,result)=>{const event={sequence:++sequence,kind,input:structuredClone(input),result:structuredClone(result)};onEvent(event);return result;};
  const sender={
    async sendText(input){return emit('sendText',input,{messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'});},
    async sendMedia(input){return emit('sendMedia',input,{messageId:'synthetic-whatsapp-'+(sequence+1),status:'queued'});},
  };
  const media={async interpret(merchantId,deviceId,input,context){
    const text=normalized.voiceTranscripts[input.id];
    const result=text&&context&&input.mimeType?.split(';')[0]==='audio/ogg'
      ?{kind:'audio_transcript',text,scope:{merchantId,deviceId,inboxId:context.inboxId,conversationId:context.conversationId,mediaId:input.id}}:undefined;
    return emit('voiceInterpret',{merchantId,deviceId,media:input,context},result);
  }};
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
  return{sender,media,install,attempts:()=>sequence};
}
