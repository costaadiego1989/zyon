import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createCapturedAsaasProductFixture} from './product-captured-payment-fixture.mjs';
import {capturedPaymentLink} from './product-payment-viewer-link.mjs';
const runId='6c5300a2-2017-4300-967f-000000000095';
const tenant={run:async(_scope,operation)=>operation()};
// Component-only collaborators below prove the private capture, not Auth/SQL/PSP.
async function setup(options){
  const fixture=createCapturedAsaasProductFixture(runId,()=>{},options),env={};
  const environment=fixture.installEnvironment(env);
  let connection,secret,observed;
  const input={merchantId:'owned',sessionId:'session_owned',intentId:'pay_int_owned',provider:'asaas',providerAccountFingerprint:'owned-account',
    currency:'BRL',amountCents:2700,method:'pix',platformFeeCents:100};
  const row={id:input.intentId,merchantId:input.merchantId,sessionId:input.sessionId,currency:'BRL',amountCents:2700,method:'pix',status:'pending',providerPaymentId:null,creation:{input}};
  const platform={getConnection:async()=>connection,getConnectionSecret:async()=>secret,listConnections:async()=>[],
    saveConnection:async value=>{connection={...value};secret=value.secret;}};
  const prisma={merchant:{findUnique:async()=>({businessMode:'products',businessModeNeedsReview:false})},
    paymentIntent:{findFirst:async({where})=>where.id===row.id&&where.merchantId===row.merchantId?row:null}};
  class Module{} class RoutingPaymentAdapter{}
  const token=Symbol('provider'),providers=[{provide:token,inject:[1,2,3,4,5,6],useFactory:()=>{throw Error('unused');}}];
  Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,providers,Module);
  const installation=fixture.install(Module,{PAYMENT_PROVIDER_PORT:token,PRISMA_CLIENT:Symbol('db'),
    isStripeConfigured:()=>false,isAsaasConfigured:()=>true,isMercadoPagoConfigured:()=>false,
    readAsaasConnection:()=>({baseUrl:'https://api-sandbox.asaas.com'}),readMercadoPagoConnection:()=>({}),
    resolvePaymentProvider:value=>{observed=value;return new RoutingPaymentAdapter();}});
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module)[0].useFactory('asaas','stripe','mp','evm',platform,'http',prisma);
  await fixture.bindOwner('component-token',{jwt:{authenticate:async()=>({merchantId:'owned',userId:'owner',role:'owner',email:'owner@buyer-journey.example.test'})},tenantContext:tenant});
  const send=(path,body,method=body?'POST':'GET')=>fixture.fetch('https://api-sandbox.asaas.com'+path,{
    method,headers:{access_token:env.ASAAS_API_KEY_SANDBOX},...(body?{body:JSON.stringify(body)}:{})});
  const customer=await(await send('/v3/customers',{name:'Pessoa sintética',email:'buyer@buyer-journey.example.test',cpfCnpj:'52998224725'})).json();
  input.asaasCustomerId=customer.id;
  const created=await(await send('/v3/payments',{customer:customer.id,billingType:'PIX',value:27,dueDate:'2099-01-01',
    description:'Componente sintético',externalReference:row.id,split:[{walletId:'wallet_captured_platform_'+runId.replaceAll('-',''),fixedValue:1}]})).json();
  row.providerPaymentId=created.id;
  return {fixture,row,created,observed,send,env,close(){installation.restore();assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module),providers);environment.restore();assert.deepEqual(env,{});fixture.close();}};
}
test('S5 private factory retains each production provider-config filter and inject identity',()=>{
  for(const configured of[[false,false,false],[true,false,true],[false,true,false]]){
    const fixture=createCapturedAsaasProductFixture(runId);class Module{}class RoutingPaymentAdapter{}
    const token=Symbol('provider'),db=Symbol('db'),foreign={provide:Symbol('other'),useValue:{}};
    const original=[foreign,{provide:token,inject:[1,2,3,4,5,6],useFactory(){throw Error('unused');}}];
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,Module);let observed;const calls=[0,0,0];
    const installed=fixture.install(Module,{PAYMENT_PROVIDER_PORT:token,PRISMA_CLIENT:db,
      isStripeConfigured:()=>{calls[0]++;return configured[0];},isAsaasConfigured:()=>{calls[1]++;return configured[1];},
      isMercadoPagoConfigured:()=>{calls[2]++;return configured[2];},readAsaasConnection:()=>({baseUrl:'asaas-base'}),readMercadoPagoConnection:()=>({baseUrl:'mp-base'}),
      resolvePaymentProvider:value=>{observed=value;return new RoutingPaymentAdapter();}});
    try{
      const replacement=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module);
      assert.equal(replacement[0],foreign);assert.deepEqual(replacement[1].inject,[1,2,3,4,5,6,db]);
      const [asaas,stripe,mp,evm,platform,http,prisma]=Array.from({length:7},()=>({}));
      replacement[1].useFactory(asaas,stripe,mp,evm,platform,http,prisma);
      assert.equal(observed.stripe,configured[0]?stripe:null);assert.equal(observed.asaas,configured[1]?asaas:null);
      assert.equal(observed.mercadopago,configured[2]?mp:null);assert.equal(observed.evmCrypto,evm);
      assert.equal(observed.platformConnections,platform);assert.equal(observed.fetchImpl,fixture.fetch);
      assert.deepEqual(calls,[1,1,1]);
    }finally{installed.restore();assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module),original);fixture.close();}
  }
});
test('S5 invalid synthetic notifications leave PSP pending until matching, never approving SQL themselves',async()=>{
  const own=await setup();
  try{
    for(const variant of['bad_token','wrong_value','wrong_reference']){
      const envelope=await own.fixture.notification(own.row.id,variant,tenant);
      assert.equal(envelope.path,'/webhooks/asaas');assert.equal(envelope.body.event,'PAYMENT_RECEIVED');
      if(variant==='wrong_value')assert.equal(envelope.body.payment.value,27.01);
      if(variant==='wrong_reference')assert.notEqual(envelope.body.payment.externalReference,own.row.id);
      assert.equal((await(await own.send('/v3/payments/'+own.created.id)).json()).status,'PENDING');
      assert.equal(own.row.status,'pending');assert.equal(own.row.approvedAmountCents,undefined);
    }
    const matching=await own.fixture.notification(own.row.id,'matching',tenant);
    assert.equal(matching.body.payment.externalReference,own.row.id);assert.equal(matching.body.payment.value,27);
    assert.equal((await(await own.send('/v3/payments/'+own.created.id)).json()).status,'RECEIVED');
    const duplicate=await own.fixture.notification(own.row.id,'matching',tenant);
    assert.equal(duplicate.body.id,matching.body.id);assert.equal(own.row.status,'pending');
    assert.equal(own.fixture.evidence().externalProviderCalls,0);
  }finally{own.close();}
});
test('S5 optional captured PNG travels only in Pix wire with nonpayable payload; omission is unchanged',async()=>{
  const original=await setup(),image=await setup({pixImage:'nonpayable-png-v1'});
  try{
    const plain=await(await original.send('/v3/payments/'+original.created.id+'/pixQrCode')).json();
    assert.deepEqual(Object.keys(plain),['payload']);assert.match(plain.payload,/^CAPTURED_PIX_NOT_PAYABLE:/);
    const wire=await(await image.send('/v3/payments/'+image.created.id+'/pixQrCode')).json();
    assert.match(wire.payload,/^CAPTURED_PIX_NOT_PAYABLE:/);assert.match(wire.encodedImage,/^iVBORw0KGgo/);
    assert.ok(Buffer.from(wire.encodedImage,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
    assert.equal(image.row.status,'pending');assert.equal(image.fixture.evidence().externalProviderCalls,0);
  }finally{original.close();image.close();}
});
test('S5 captured image option is closed and rejects arbitrary content without provider setup',()=>{
  for(const value of[null,true,{pixImage:true},{pixImage:'https://external.invalid'},{pixImage:'nonpayable-png-v1',url:'forged'}])
    assert.throws(()=>createCapturedAsaasProductFixture(runId,()=>{},value),/image_option_invalid/);
  assert.doesNotThrow(()=>createCapturedAsaasProductFixture(runId,()=>{},{pixImage:'nonpayable-png-v1'}).close());
});
test('S5 private viewer exposes only actual captured HTTPS cta_url fields, never a new action or unsafe URL',()=>{
  const wire=url=>({interactive:{type:'cta_url',action:{name:'cta_url',parameters:{display_text:'Pagar pedido',url}}}});
  assert.deepEqual(capturedPaymentLink(wire('https://sandbox.asaas.com/i/owned')),{title:'Pagar pedido',url:'https://sandbox.asaas.com/i/owned'});
  for(const value of[{},wire('http://127.0.0.1/fake'),wire('javascript:alert(1)'),wire('https://user:secret@example.test/i'),wire('https://sandbox.asaas.com:444/i')])
    assert.equal(capturedPaymentLink(value),undefined);
  assert.equal(capturedPaymentLink({interactive:{type:'button',action:{parameters:{display_text:'Fake',url:'https://sandbox.asaas.com/i'}}}}),undefined);
});
