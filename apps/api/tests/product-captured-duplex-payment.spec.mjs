import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createCapturedAsaasProductFixture} from './product-captured-payment-fixture.mjs';

const runId='6c5300a2-2017-4300-967f-000000000095';
const tenant={run:async(_scope,operation)=>operation()};
// Component-only collaborators below prove the private capture, not Auth/SQL/PSP.
async function setup(options,method='card'){
  const fixture=createCapturedAsaasProductFixture(runId,()=>{},options),env={};
  const environment=fixture.installEnvironment(env);
  let connection,secret,observed;
  const input={merchantId:'owned',sessionId:'session_owned',intentId:'pay_int_owned',provider:'asaas',providerAccountFingerprint:'owned-account',
    currency:'BRL',amountCents:2700,method,platformFeeCents:100};
  const row={id:input.intentId,merchantId:input.merchantId,sessionId:input.sessionId,currency:'BRL',amountCents:2700,method,status:'pending',providerPaymentId:null,creation:{input}};
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
  const created=await(await send('/v3/payments',{customer:customer.id,billingType:method==='pix'?'PIX':'CREDIT_CARD',value:27,dueDate:'2099-01-01',
    description:'Componente sintético',externalReference:row.id,split:[{walletId:'wallet_captured_platform_'+runId.replaceAll('-',''),fixedValue:1}]})).json();
  row.providerPaymentId=created.id;
  return {fixture,row,created,observed,send,env,close(){installation.restore();assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Module),providers);environment.restore();assert.deepEqual(env,{});fixture.close();}};
}
test('S5 duplex capture acknowledges standalone pending card/Pix DELETE only, with original identity and unpaid read-back',async()=>{
  for(const method of['card','pix']){
    const own=await setup(undefined,method);
    try{
      const path='/v3/payments/'+own.created.id;
      const before=await(await own.send(path)).json();assert.equal(before.billingType,method==='card'?'CREDIT_CARD':'PIX');
      assert.equal(before.status,'PENDING');assert.equal(before.deleted,false);
      assert.deepEqual(await(await own.send(path,undefined,'DELETE')).json(),{id:own.created.id,deleted:true});
      const after=await(await own.send(path)).json();assert.equal(after.id,before.id);assert.equal(after.externalReference,before.externalReference);
      assert.equal(after.customer,before.customer);assert.equal(after.value,before.value);assert.equal(after.currency,'BRL');
      assert.equal(after.status,'PENDING');assert.equal(after.deleted,true);
      await assert.rejects(own.send(path,undefined,'DELETE'),/cancellation_unsupported/);
      assert.equal(own.row.status,'pending');assert.equal(own.row.approvedAmountCents,undefined);
      assert.equal(own.fixture.evidence().externalProviderCalls,0);
    }finally{own.close();}
  }
});
test('S5 duplex capture never deletes a card already observed RECEIVED and never mutates approval SQL',async()=>{
  const own=await setup(undefined,'card');
  try{
    const matching=await own.fixture.notification(own.row.id,'matching',tenant);assert.equal(matching.body.payment.status,'RECEIVED');
    await assert.rejects(own.send('/v3/payments/'+own.created.id,undefined,'DELETE'),/cancellation_unsupported/);
    const observed=await(await own.send('/v3/payments/'+own.created.id)).json();assert.equal(observed.status,'RECEIVED');assert.equal(observed.deleted,false);
    assert.equal(own.row.status,'pending');assert.equal(own.row.approvedAmountCents,undefined);assert.equal(own.fixture.evidence().externalProviderCalls,0);
  }finally{own.close();}
});
