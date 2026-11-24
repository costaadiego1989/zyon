import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createCapturedProductPaymentChannel} from './product-captured-payment-channel.mjs';
import {validateCapturedProductPaymentOptions,validateCapturedProductPaymentControl,createCapturedAsaasProductFixture} from './product-captured-payment-fixture.mjs';
const runId='6c5300a2-2017-4300-967f-000000000094';

test('REG02 captured payment opt-in is absent by default and exclusive to each existing buyer channel',()=>{
  assert.equal(validateCapturedProductPaymentOptions({local:true}),false);
  assert.equal(validateCapturedProductPaymentOptions({local:true,buyerBooking:true,buyerBrowser:true,capturedProductPayments:true}),true);
  assert.equal(validateCapturedProductPaymentOptions({local:true,whatsapp:true,capturedProductPayments:true}),true);
  for(const value of[false,'asaas',{},null])assert.throws(()=>validateCapturedProductPaymentOptions({local:true,whatsapp:true,capturedProductPayments:value}));
  for(const patch of[{},{buyerBooking:true},{buyerBrowser:true},{buyerBooking:true,buyerBrowser:true,whatsapp:true},
    {whatsapp:true,graph:true},{whatsapp:true,supportQueryModel:true},{whatsapp:true,observeBusinessRag:true}])
    assert.throws(()=>validateCapturedProductPaymentOptions({local:true,capturedProductPayments:true,...patch}));
});

test('REG02 private payment control rejects tenant fields arbitrary bodies headers states and destinations',()=>{
  const base={type:'local_product_payment_request',runId,requestId:'a'.repeat(32),operation:'bind',input:{ownerToken:'actual-owner-token'}};
  assert.deepEqual(validateCapturedProductPaymentControl(base,runId),base);
  for(const input of[{...base.input,merchantId:'forged'},{...base.input,role:'owner'},{...base.input,secret:'forged'}])
    assert.throws(()=>validateCapturedProductPaymentControl({...base,input},runId));
  const notification={...base,operation:'notification',input:{intentId:'pay_int_owned',variant:'matching'}};
  assert.deepEqual(validateCapturedProductPaymentControl(notification,runId),notification);
  for(const input of[{...notification.input,status:'approved'},{...notification.input,url:'https://external.invalid'},
    {...notification.input,headers:{}},{...notification.input,amountCents:1},{...notification.input,variant:'refund'}])
    assert.throws(()=>validateCapturedProductPaymentControl({...notification,input},runId));
  assert.throws(()=>validateCapturedProductPaymentControl({...notification,runId:'another-run'},runId));
});

test('REG02 unbound closed and unannounced PSP requests fail without network or synthetic success',async()=>{
  const fixture=createCapturedAsaasProductFixture(runId);
  await assert.rejects(fixture.fetch('https://api-sandbox.asaas.com/v3/payments',{method:'POST'}),/scope_required/);
  assert.equal(fixture.evidence().localCapturedPSPCalls,0);
  assert.equal(fixture.evidence().externalProviderCalls,0);
  fixture.close();
  await assert.rejects(fixture.fetch('https://api-sandbox.asaas.com/v3/payments'),/closed/);
});

test('REG02 payment metadata delta preserves original inject entries and restores the exact array',()=>{
  const fixture=createCapturedAsaasProductFixture(runId);
  class Module{}
  const token=Symbol('payment'),prismaToken=Symbol('prisma'),foreign={provide:Symbol('foreign'),useValue:{}};
  const original=[foreign,{provide:token,inject:[1,2,3,4,5,6],useFactory:()=>{throw Error('not executed');}}];
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,Module);
  const installation=fixture.install(Module,{PAYMENT_PROVIDER_PORT:token,PRISMA_CLIENT:prismaToken,
    resolvePaymentProvider:()=>{throw Error('not executed');},readAsaasConnection:()=>({}),readMercadoPagoConnection:()=>({})});
  const replacement=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module);
  assert.equal(replacement.length,original.length);
  assert.equal(replacement[0],foreign);
  assert.deepEqual(replacement[1].inject,[1,2,3,4,5,6,prismaToken]);
  assert.deepEqual(installation.overrides,['payment.PAYMENT_PROVIDER_PORT.fetch']);
  installation.restore();installation.restore();
  assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module),original);
  fixture.close();
});

test('REG02 ephemeral Asaas secrets stay in worker environment and restore prior values exactly',()=>{
  const fixture=createCapturedAsaasProductFixture(runId),env={ASAAS_SANDBOX:'old',UNRELATED:'preserved'};
  const installation=fixture.installEnvironment(env);
  assert.equal(env.ASAAS_SANDBOX,'true');assert.equal(env.UNRELATED,'preserved');
  assert.equal(env.ASAAS_BASE_URL_SANDBOX,'https://api-sandbox.asaas.com');
  const evidence=JSON.stringify(fixture.evidence());
  assert.equal(evidence.includes(env.ASAAS_WEBHOOK_TOKEN),false);
  assert.equal(evidence.includes(env.ASAAS_API_KEY_SANDBOX),false);
  installation.restore();assert.deepEqual(env,{ASAAS_SANDBOX:'old',UNRELATED:'preserved'});
  fixture.close();
});
test('REG02 parent payment closure delivers only to owned original webhook and withholds secret envelope',async()=>{
  assert.equal(createCapturedProductPaymentChannel({enabled:false}),undefined);
  let channel,observed;const secret='a'.repeat(64);
  channel=createCapturedProductPaymentChannel({enabled:true,runId,apiOrigin:()=> 'http://127.0.0.1:23456',
    send(message){queueMicrotask(()=>channel.accept({type:'local_product_payment_result',runId,requestId:message.requestId,
      result:message.operation==='bind'?{merchantId:'owned',syntheticSandboxConnection:true}:
      {path:'/webhooks/asaas',headers:{'content-type':'application/json','asaas-access-token':secret},
        body:{id:'event',event:'PAYMENT_RECEIVED',payment:{id:'pay',value:10}}}}));return true;},
    fetchOwned:async(url,init)=>{observed={url,init};return Response.json({outcome:'processed',effect:'component_response_only'});}});
  try{
    assert.deepEqual(await channel.public.bind('actual-owner-token'),{merchantId:'owned',syntheticSandboxConnection:true});
    const result=await channel.public.notify('pay_int_owned');
    assert.equal(observed.url,'http://127.0.0.1:23456/webhooks/asaas');
    assert.equal(observed.init.headers['asaas-access-token'],secret);assert.equal(observed.init.redirect,'error');
    assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(Object.hasOwn(channel.public,'secret'),false);
    assert.deepEqual(Object.keys(channel.public).sort(),['bind','notify']);
  }finally{channel.close();}
  await assert.rejects(channel.public.notify('pay_int_owned'),/closed/);
});

test('REG02 payment closure refuses a remote API origin before any transport invocation',async()=>{
  let channel,calls=0;
  channel=createCapturedProductPaymentChannel({enabled:true,runId,apiOrigin:()=> 'https://external.invalid',
    send(message){queueMicrotask(()=>channel.accept({type:'local_product_payment_result',runId,requestId:message.requestId,
      result:{path:'/webhooks/asaas',headers:{'content-type':'application/json','asaas-access-token':'a'.repeat(64)},
        body:{event:'PAYMENT_RECEIVED'}}}));return true;},fetchOwned:()=>{calls++;throw Error('must not send');}});
  try{await assert.rejects(channel.public.notify('pay_int_owned'),/owned_http_required/);assert.equal(calls,0);}finally{channel.close();}
});