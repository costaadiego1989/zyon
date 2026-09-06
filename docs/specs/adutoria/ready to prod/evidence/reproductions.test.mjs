import test from 'node:test';
import assert from 'node:assert/strict';
import {Agent,createServer} from 'node:http';
import {JwtService} from '../../../../../apps/api/src/modules/auth/domain/services/jwt.service.ts';
import {RefreshTokenUseCase} from '../../../../../apps/api/src/modules/auth/application/refresh-token.use-case.ts';
import {PaymentIntentEntity} from '../../../../../apps/api/src/modules/payment/domain/payment-intent.entity.ts';
import {CheckoutSession} from '../../../../../apps/widget_v2/src/api/checkout-session.ts';
import {ProcessRefundUseCase} from '../../../../../apps/api/src/modules/returns/application/use-cases/process-refund.use-case.ts';

test('R01 - expired JWT can refresh twice despite rotation',()=>{
 const jwt=new JwtService('audit-local-only-secret',3600);
 const old=jwt.sign({userId:'u',merchantId:'m',email:'audit@example.invalid',role:'owner'},Math.floor(Date.now()/1000)-3601);
 const refresh=new RefreshTokenUseCase(jwt);
 assert.ok(refresh.execute(old));
 assert.ok(refresh.execute(old));
});

test('R02 - native HTTP Agent is not a fetch dispatcher',async()=>{
 const server=createServer((_req,res)=>res.end('ok'));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await assert.rejects(fetch(`http://127.0.0.1:${server.address().port}`,{dispatcher:new Agent()}),e=>/dispatch is not a function/.test(String(e.cause)));}
 finally{await new Promise(resolve=>server.close(resolve));}
});

test('R03 - raw payment snapshot does not satisfy widget contract',()=>{
 const intent=PaymentIntentEntity.create({merchantId:'m',sessionId:'s',idempotencyKey:'k',amountCents:10000,currency:'BRL',method:'pix'});
 intent.setBuyerFacingPayload({qrCodeCopyPaste:'test-pix',clientSecret:'test-secret'});
 const response=intent.snapshot();
 assert.equal(response.intent_id,undefined);
 assert.equal(response.pix_code,undefined);
 assert.equal(response.stripe_client_secret,undefined);
 assert.ok(response.id);
 assert.equal(response.buyerFacing.qrCodeCopyPaste,'test-pix');
});

test('R04 - real widget client omits session_id on payment status',async()=>{
 const original=globalThis.fetch;const requests=[];
 globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});return new Response(JSON.stringify(String(url).endsWith('/start')?{session_id:'s'}:{status:'approved'}));};
 try{
  const client=new CheckoutSession({embedToken:'audit',merchantId:'m',apiBaseUrl:'https://api.example.invalid'});
  await client.start();await client.getPaymentStatus('pi');
  assert.equal(new URL(requests.at(-1).url).searchParams.get('session_id'),null);
 }finally{globalThis.fetch=original;}
});

test('R05 - real widget shipping parser drops valid API quote results',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url)=>new Response(JSON.stringify(String(url).endsWith('/start')?{session_id:'s'}:{session_id:'s',results:[{carrier_key:'pac',label:'PAC',price:1500,eta_days:5,is_free:false}]}));
 try{
  const client=new CheckoutSession({embedToken:'audit',merchantId:'m',apiBaseUrl:'https://api.example.invalid'});
  await client.start();assert.deepEqual(await client.fetchShippingQuote('01001000'),[]);
 }finally{globalThis.fetch=original;}
});

test('R06 - refund marks COMPLETED at fixed 1000 cents per item without provider',async()=>{
 const calls=[];const returned={canRefund:true,items:[{quantity:3}]};
 const repo={findById:async()=>returned,updateStatus:async(...args)=>calls.push(['status',...args]),saveRefund:async(x)=>calls.push(['refund',x]),updateRefundStatus:async(...args)=>calls.push(['refundStatus',...args])};
 await new ProcessRefundUseCase(repo).execute('m','r');
 assert.deepEqual(calls.find(x=>x[0]==='refund')[1],{returnId:'r',amountInCents:3000,status:'COMPLETED'});
 assert.ok(calls.some(x=>x[0]==='status'&&x[2]==='REFUND_COMPLETED'));
});
