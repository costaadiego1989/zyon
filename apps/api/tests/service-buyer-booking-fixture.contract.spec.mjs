import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuyerBookingFixtureChannel,validateBuyerBookingFixtureRequest} from './service-test-runtime.mjs';

const runId='6c5300a2-2017-4300-967f-000000000040',origin='https://booking.example.test',credential='e'.repeat(96);
const claims=()=>{const now=Math.floor(Date.now()/1000);return{typ:'aacp_embed_v1',merchantId:'merchant',issuedAtUnix:now,expiresAtUnix:now+60,
 nonce:'original-nonce',allowedOrigin:origin,storefrontCartRef:'owned-cart',scopes:['checkout:start','appointments:confirm']};};
const token=value=>Buffer.from(JSON.stringify(value)).toString('base64url')+'.'+'s'.repeat(43);
function fixture(apiOrigin='http://127.0.0.1:19440'){
 const state={requests:[],sent:[],claims:claims()},issued=token(state.claims);
 const channel=createBuyerBookingFixtureChannel({enabled:true,runId,apiOrigin:()=>apiOrigin,send:value=>{state.sent.push(value);return true;},
  fetchOwned:async(url,options)=>{state.requests.push({url,options});return{status:201,json:async()=>({embed_session_token:issued,expires_at_unix:state.claims.expiresAtUnix})};}});
 const admit=()=>channel.accept({type:'local_buyer_booking_credential',runId,credential});
 const issue=()=>channel.public.issue({merchantId:'merchant',body:{cart_ref:'owned-cart',conversation_token:'owned-conversation',allowed_origin:origin,
  scopes:['checkout:start','appointments:confirm'],ttl_seconds:60}});
 const shorten=()=>channel.public.shorten({token:issued,seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin});
 return{channel,state,issued,admit,issue,shorten};
}

test('T40 owned buyer-booking fixture controls',async t=>{
 await t.test('the default has no private channel, credential transfer or HTTP request',()=>{
  let effects=0;assert.equal(createBuyerBookingFixtureChannel({enabled:false,runId,apiOrigin:()=>{effects++;return origin;},send:()=>{effects++;},fetchOwned:()=>{effects++;}}),undefined);
  assert.equal(effects,0);
 });
 await t.test('wrong run and unrecognized credential fields are refused without authority',async()=>{
  const f=fixture();try{
   for(const message of[{type:'local_buyer_booking_credential',runId:'foreign',credential},{type:'local_buyer_booking_credential',runId,credential,secret:'extra'}])
    assert.throws(()=>f.channel.accept(message),/buyer_booking_fixture_control_invalid/);
   await assert.rejects(f.issue,/buyer_booking_fixture_credential_unavailable/);assert.deepEqual(f.state.requests,[]);
  }finally{f.channel.close();}
 });
 await t.test('private credentials arrive once and never appear in the public facade',()=>{
  const f=fixture();try{
   assert.equal(f.admit(),true);assert.throws(f.admit,/buyer_booking_fixture_credential_duplicate/);
   assert.deepEqual(Object.keys(f.channel.public).sort(),['issue','shorten']);
   assert.equal(JSON.stringify(f.channel.public).includes(credential),false);assert.equal(Object.hasOwn(f.channel.public,'credential'),false);
  }finally{f.channel.close();}
 });
 await t.test('only the literal owned loopback issuer receives the ephemeral credential',async()=>{
  const f=fixture();try{
   f.admit();const response=await f.issue();assert.equal(response.status,201);assert.equal(response.body.embed_session_token,f.issued);
   assert.equal(f.state.requests.length,1);assert.equal(f.state.requests[0].url,'http://127.0.0.1:19440/embed-sessions');
   assert.equal(f.state.requests[0].options.redirect,'error');assert.equal(f.state.requests[0].options.headers['x-internal-service-token'],credential);
   assert.equal(f.state.requests[0].options.headers['x-merchant-id'],'merchant');assert.equal(JSON.stringify(response).includes(credential),false);
  }finally{f.channel.close();}
  const foreign=fixture('https://foreign.example.test');try{foreign.admit();await assert.rejects(foreign.issue,/buyer_booking_fixture_owned_http_required/);assert.equal(foreign.state.requests.length,0);}finally{foreign.channel.close();}
 });
 await t.test('unknown operations, foreign run and unbounded shortening never form worker commands',()=>{
  const valid={type:'local_buyer_booking_request',runId,requestId:'a'.repeat(32),operation:'shorten',input:{token:'opaque',seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin}};
  assert.deepEqual(validateBuyerBookingFixtureRequest(valid,runId),valid);
  for(const message of[{...valid,operation:'issue'},{...valid,runId:'foreign'},{...valid,input:{...valid.input,seconds:6}},
   {...valid,input:{...valid.input,merchantId:'foreign',origin:'not-origin'}},{...valid,unknown:true}])
   assert.throws(()=>validateBuyerBookingFixtureRequest(message,runId),/buyer_booking_fixture_control_invalid/);
 });
  await t.test('the private issuer channel cannot request unrelated scopes or unbounded credentials',async()=>{
   const f=fixture();try{
    f.admit();const body={cart_ref:'owned-cart',conversation_token:'owned-conversation',allowed_origin:origin,
     scopes:['checkout:start','appointments:confirm'],ttl_seconds:60};
    for(const changed of[{...body,scopes:['payments:create']},{...body,ttl_seconds:999999},{...body,conversation_token:''},
     {...body,allowed_origin:'https://booking.example.test/path'}])
     await assert.rejects(()=>f.channel.public.issue({merchantId:'merchant',body:changed}),/buyer_booking_fixture_control_invalid/);
    assert.deepEqual(f.state.requests,[]);assert.deepEqual(f.state.sent,[]);
   }finally{f.channel.close();}
  });
 await t.test('shortening requires this fixture real-issuer result and exact source binding',async()=>{
  const f=fixture();try{
   f.admit();await assert.rejects(f.shorten,/buyer_booking_fixture_original_capability_required/);assert.deepEqual(f.state.sent,[]);
   await f.issue();await assert.rejects(()=>f.channel.public.shorten({token:f.issued,seconds:3,merchantId:'foreign',cartRef:'owned-cart',origin}),/buyer_booking_fixture_original_capability_required/);
   assert.deepEqual(f.state.sent,[]);
  }finally{f.channel.close();}
 });
 await t.test('worker reply must preserve every claim except strictly lower expiration',async()=>{
  const f=fixture();try{
   f.admit();await f.issue();const pending=f.shorten(),message=f.state.sent[0];assert.equal(message.operation,'shorten');assert.equal(message.runId,runId);
   const short={...f.state.claims,expiresAtUnix:Math.floor(Date.now()/1000)+3};
   const result={token:token(short),expiresAtUnix:short.expiresAtUnix,fixtureShortTTL:true};
   assert.equal(f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result}),true);
   assert.deepEqual(await pending,result);
   assert.throws(()=>f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result}),/buyer_booking_fixture_reply_unknown/);
  }finally{f.channel.close();}
 });
 await t.test('a changed nonce in a signer response is rejected and cannot be published',async()=>{
  const f=fixture();try{
   f.admit();await f.issue();const pending=f.shorten(),rejected=assert.rejects(pending,/buyer_booking_fixture_control_invalid/),message=f.state.sent[0];
   const changed={...f.state.claims,nonce:'foreign-nonce',expiresAtUnix:Math.floor(Date.now()/1000)+3};
   assert.throws(()=>f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result:{token:token(changed),expiresAtUnix:changed.expiresAtUnix,fixtureShortTTL:true}}),/buyer_booking_fixture_control_invalid/);
   await rejected;
  }finally{f.channel.close();}
 });
 await t.test('close rejects bounded pending work, refuses new calls and does not adopt late replies',async()=>{
  const f=fixture();f.admit();await f.issue();const pending=f.shorten(),rejected=assert.rejects(pending,/buyer_booking_fixture_closed/),message=f.state.sent[0];
  f.channel.close();await rejected;await assert.rejects(f.issue,/buyer_booking_fixture_closed/);
  assert.equal(f.state.sent.length,1);assert.equal(f.state.requests.length,1);
  assert.equal(f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result:{}}),false);
 });
});


test('T40 issuer fixture supplies valid independent command keys to the unchanged API',async()=>{
 const {IdempotencyKeySchema}=await import('@zyon/contracts');
 const f=fixture();try{
  f.admit();await f.issue();await f.issue();
  assert.equal(f.state.requests.length,2);
  const keys=f.state.requests.map(request=>request.options.headers['idempotency-key']);
  for(const key of keys){assert.equal(IdempotencyKeySchema.safeParse(key).success,true);assert.equal(typeof key,'string');assert.equal(key.includes(credential),false);}
  assert.notEqual(keys[0],keys[1]);
  assert.deepEqual(f.state.requests.map(request=>request.options.headers['x-merchant-id']),['merchant','merchant']);
 }finally{f.channel.close();}
});


test('T40 fixture forwards omitted issuer TTL without choosing or extending API authority',async()=>{
 const requests=[],original=claims();original.expiresAtUnix=original.issuedAtUnix+900;
 const issued=token(original);
 const channel=createBuyerBookingFixtureChannel({enabled:true,runId,apiOrigin:()=> 'http://127.0.0.1:19440',send:()=>true,
  fetchOwned:async(url,options)=>{requests.push({url,options});return{status:201,json:async()=>({embed_session_token:issued,expires_at_unix:original.expiresAtUnix})};}});
 try{
  channel.accept({type:'local_buyer_booking_credential',runId,credential});
  const body={cart_ref:'owned-cart',conversation_token:'owned-conversation',allowed_origin:origin,scopes:['checkout:start','appointments:confirm']};
  const result=await channel.public.issue({merchantId:'merchant',body});
  assert.equal(result.status,201);assert.equal(result.body.embed_session_token,issued);
  assert.equal(result.body.expires_at_unix,original.issuedAtUnix+900);
  assert.deepEqual(JSON.parse(requests[0].options.body),body);
  assert.equal(Object.hasOwn(JSON.parse(requests[0].options.body),'ttl_seconds'),false);
  await assert.rejects(()=>channel.public.shorten({token:issued,seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin}),/buyer_booking_fixture_original_capability_required/);
  for(const ttl_seconds of [null,'900',0,59,901,Infinity]){
   await assert.rejects(()=>channel.public.issue({merchantId:'merchant',body:{...body,ttl_seconds}}),/buyer_booking_fixture_control_invalid/);
  }
  assert.equal(requests.length,1);assert.equal(JSON.stringify(result).includes(credential),false);
 }finally{channel.close();}
});
