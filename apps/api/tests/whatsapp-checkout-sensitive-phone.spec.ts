import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckoutWhatsAppConversationAdapter} from '../src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js';
import {checkoutSession} from '../src/modules/checkout/__tests__/checkout-test-fixtures.js';
import {buildExperienceFromSession} from '../src/modules/checkout/application/services/checkout-experience.service.js';
import {deriveChatStage,missingFieldsForStage} from '../src/modules/checkout/domain/services/customer-extraction.service.js';
import type {WhatsAppConversationState} from '../src/modules/whatsapp-channel/domain/ui/meta-ui.types.js';
function fixture(){
  const senderPhone='5511998000064';
  const session=checkoutSession({shipping:undefined,customer:{fullName:'Pessoa Sintética',email:'own@buyer-journey.example.test',
    phone:undefined,phone_verified:false,address_verified:true,
    address:{zip:'01310100',street:'Rua Casa Sintética',number:'10',complement:'',neighborhood:'Centro',city:'São Paulo',state:'SP'}}});
  const profile={globalUserId:session.globalUserId,displayName:'Pessoa Sintética',phone:senderPhone,email:'own@buyer-journey.example.test'};
  session.shippingOptions=[{carrier:'Entrega própria',method:'Centro',carrierKey:'own_delivery_neighborhood_centro',customerPrice:7.5,deliveryDays:1}];
  const state:WhatsAppConversationState={version:1,conversationId:'conv_1',stage:'checkout',checkoutSessionId:'chk_1',history:[],previousViews:[],revision:'before',page:0};
  const calls={chat:[] as any[],store:[] as any[],recognize:[] as any[],save:[] as any[]};
  const adapter=new CheckoutWhatsAppConversationAdapter(
    {execute:async(input:unknown)=>{calls.chat.push(structuredClone(input));return{message:'Confira os dados atuais.',actions:[],experience:buildExperienceFromSession(session)};}}as any,
    {getSession:async()=>session,saveSession:async(input:unknown)=>{calls.save.push(structuredClone(input));throw Error('no_profile_write_expected');}}as any,
    {execute:async(input:unknown)=>{calls.store.push(structuredClone(input));return{message:'Catálogo da loja.',blocks:[],suggested_next:[]};}}as any,
    {executeForMerchant:async()=>({name:'Loja sintética',agentTone:'direct'})}as any,
    {getPaymentCapabilities:async()=>({pix:true,card:true})}as any,
    undefined,undefined,undefined,undefined,undefined,undefined,
    {recognize:async(input:unknown)=>{calls.recognize.push(structuredClone(input));return{status:'not_found'};}}as any);
  assert.equal(missingFieldsForStage(session,deriveChatStage(session))[0],'telefone','actual_phone_stage_required');
  return{session,profile,state,calls,send:(message:string)=>adapter.respondStore({merchantId:session.merchantId,buyer:{globalUserId:session.globalUserId,phone:senderPhone},state,message})};
}
test('S4 privacy overlay blocks explicit and formatted CPF while requesting phone, before either dispatcher or identity/profile work',async()=>{
  for(const message of['Meu CPF é 52998224725','529.982.247-25']){
    const f=fixture(),before={session:structuredClone(f.session),profile:structuredClone(f.profile)},result=await f.send(message);
    assert.deepEqual(f.calls,{chat:[],store:[],recognize:[],save:[]});
    assert.match(result.agentMessage,/Não é necessário enviar seu CPF/);
    assert.doesNotMatch(JSON.stringify(result),/52998224725|529\.982\.247-25/);
    assert.deepEqual(f.session,before.session);assert.deepEqual(f.profile,before.profile);
  }
});
test('S4 privacy overlay preserves plain eleven-digit phone input in the actual phone stage, including ambiguous checksum digits',async()=>{
  for(const message of['11998000064','52998224725']){
    const f=fixture(),before={session:structuredClone(f.session),profile:structuredClone(f.profile)},result=await f.send(message);
    assert.equal(f.calls.chat.length,1);assert.equal(f.calls.chat[0].user_message,message);assert.deepEqual(f.calls.store,[]);assert.deepEqual(f.calls.save,[]);
    assert.doesNotMatch(result.agentMessage,/Não é necessário enviar seu CPF/);
    assert.deepEqual(f.session,before.session);assert.deepEqual(f.profile,before.profile);
  }
});
