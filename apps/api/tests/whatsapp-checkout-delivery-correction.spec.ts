import test from 'node:test';
import assert from 'node:assert/strict';
import {CheckoutWhatsAppConversationAdapter} from '../src/modules/whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.js';
import {checkoutSession} from '../src/modules/checkout/__tests__/checkout-test-fixtures.js';
import {buildExperienceFromSession} from '../src/modules/checkout/application/services/checkout-experience.service.js';
import type {WhatsAppConversationState} from '../src/modules/whatsapp-channel/domain/ui/meta-ui.types.js';
function fixture(){
  const session=checkoutSession({shipping:undefined,customer:{fullName:'Pessoa Sintética',email:'own@buyer-journey.example.test',phone:'5511998000064',phone_verified:true,address_verified:true,
    address:{zip:'01310100',street:'Rua Casa Sintética',number:'10',complement:'',neighborhood:'Centro',city:'São Paulo',state:'SP'}}});
  session.shippingOptions=[{carrier:'Entrega própria',method:'Centro',carrierKey:'own_delivery_neighborhood_centro',customerPrice:7.5,deliveryDays:1}];
  const state:WhatsAppConversationState={version:1,conversationId:'conv_1',stage:'checkout',checkoutSessionId:'chk_1',history:[],previousViews:[],revision:'before',page:0};
  const calls:{chat:unknown[];store:unknown[]}={chat:[],store:[]};
  const adapter=new CheckoutWhatsAppConversationAdapter({execute:async(input:unknown)=>{calls.chat.push(structuredClone(input));return{message:'Confira os dados atuais.',actions:[],experience:buildExperienceFromSession(session)};}}as any,
    {getSession:async()=>session}as any,{execute:async(input:unknown)=>{calls.store.push(structuredClone(input));return{message:'Catálogo da loja.',blocks:[],suggested_next:[]};}}as any,
    {executeForMerchant:async()=>({name:'Loja sintética',agentTone:'direct'})}as any,
    {getPaymentCapabilities:async()=>({pix:true,card:true})}as any);
  return{session,state,calls,send:(message:string,current=state)=>adapter.respondStore({merchantId:session.merchantId,buyer:{globalUserId:session.globalUserId,phone:session.customer!.phone!},state:current,message})};
}
test('S4 explicit address, number and complement correction stays in the real checkout dispatcher while freight is pending',async()=>{
  for(const message of['Alterar endereço para 01310200','Alterar número para 25','Alterar complemento para bloco B']){
    const f=fixture(),before=structuredClone(f.session),result=await f.send(message);assert.equal(result.state.stage,'checkout');assert.equal(f.calls.chat.length,1);assert.deepEqual(f.calls.store,[]);
    assert.equal((f.calls.chat[0]as any).userMessage??(f.calls.chat[0]as any).user_message,message);assert.deepEqual(f.session,before);
  }
});
test('S4 completed freight with no payment still routes an explicit delivery correction to checkout, without a charge',async()=>{
  const f=fixture();f.session.shipping=f.session.shippingOptions![0];const before=structuredClone(f.session);const result=await f.send('Alterar endereço para 01310200');
  assert.equal(result.state.stage,'checkout');assert.equal(f.calls.chat.length,1);assert.deepEqual(f.calls.store,[]);assert.equal(result.state.payment,undefined);assert.deepEqual(f.session,before);
});
test('S4 ordinary product question still uses storefront rather than a correction dispatcher',async()=>{
  const f=fixture(),before=structuredClone(f.session);const result=await f.send('Quais produtos vocês vendem?');assert.equal(result.state.stage,'store');assert.equal(f.calls.store.length,1);assert.deepEqual(f.calls.chat,[]);assert.deepEqual(f.session,before);
});
test('S4 full CPF remains intercepted by the original privacy branch before either dispatcher',async()=>{
  const f=fixture(),before=structuredClone(f.session);const result=await f.send('Meu CPF é 52998224725');assert.deepEqual(f.calls,{chat:[],store:[]});
  assert.match(result.agentMessage,/Não é necessário enviar seu CPF/);assert.doesNotMatch(result.agentMessage,/52998224725/);assert.deepEqual(f.session,before);
});
