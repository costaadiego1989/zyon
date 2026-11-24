import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuyerBookingFixtureChannel} from './service-test-runtime.mjs';

// Component transport capture only: these opaque synthetic proofs and response
// envelopes are not JWT/authentication/issuer grants or native HTTP evidence.
const runId='6c5300a2-2017-4300-967f-000000000029';
const origin='https://booking-forward.example.test',credential='f'.repeat(96);
const scopes=['checkout:start','checkout:track','payment:intents:create','payment:intents:read'];
const allScopes=['checkout:start','checkout:track','checkout:chat','appointments:confirm',
  'payment:intents:create','payment:intents:confirm','payment:intents:read','offers:apply','coupons:apply'];
function fixture({apiOrigin='http://127.0.0.1:19429',admit=true,status=201,held=false}={}){
  const requests=[],sent=[];let release;
  const now=Math.floor(Date.now()/1000);
  const claims={typ:'aacp_embed_v1',merchantId:'merchant',storefrontCartRef:'owned-cart',allowedOrigin:origin,
    nonce:'server-owned-nonce',issuedAtUnix:now,expiresAtUnix:now+900,scopes:['checkout:track']};
  const issued=Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'s'.repeat(43);
  const responseBody=status===201?{embed_session_token:issued,expires_at_unix:claims.expiresAtUnix}:{error:'canonical_http_denial'};
  const response=()=>({status,json:async()=>structuredClone(responseBody)});
  const channel=createBuyerBookingFixtureChannel({enabled:true,runId,apiOrigin:()=>apiOrigin,
    send:value=>{sent.push(value);return true;},
    fetchOwned:(url,options)=>{requests.push({url,options});return held?new Promise(resolve=>{release=()=>resolve(response());}):Promise.resolve(response());}});
  if(admit)channel.accept({type:'local_buyer_booking_credential',runId,credential});
  const body={cart_ref:'owned-cart',conversation_token:'synthetic-conversation-proof',allowed_origin:origin,
    scopes:[...scopes],ttl_seconds:900,buyer_access_token:'synthetic-current-buyer-proof',
    previous_embed_token:'synthetic-original-embed-proof'};
  const issue=(value=body)=>channel.public.issue({merchantId:'merchant',body:value});
  return{channel,requests,sent,body,issue,issued,claims,responseBody,release:()=>release()};
}

test('T29/T30 private issuer forwards four canonical scopes and buyer continuity proofs exactly without deriving grants',async()=>{
  const f=fixture();try{
    const before=structuredClone(f.body),result=await f.issue();
    assert.deepEqual(f.body,before);
    assert.equal(f.requests.length,1);
    const request=f.requests[0];assert.equal(request.url,'http://127.0.0.1:19429/embed-sessions');
    assert.equal(request.options.method,'POST');assert.equal(request.options.redirect,'error');
    assert.deepEqual(JSON.parse(request.options.body),before);
    assert.equal(request.options.headers['x-internal-service-token'],credential);
    assert.equal(request.options.headers['x-merchant-id'],'merchant');
    assert.match(request.options.headers['idempotency-key'],/^[a-f0-9]{32}$/);
    assert.equal(request.options.signal.aborted,false);
    assert.deepEqual(result,{status:201,body:f.responseBody});
    assert.equal(result.body.embed_session_token,f.issued);
    assert.deepEqual(f.claims.scopes,['checkout:track']);
    assert.equal(JSON.parse(request.options.body).scopes.includes('appointments:confirm'),false);
    assert.equal(JSON.stringify(result).includes(credential),false);
    assert.deepEqual(Object.keys(f.channel.public).sort(),['issue','shorten']);
    assert.deepEqual(f.sent,[]);
  }finally{f.channel.close();}
});

test('T29/T30 private issuer accepts only the existing nine scopes and the exact bounded proof lengths',async()=>{
  const f=fixture();try{
    const body={...f.body,scopes:[...allScopes],conversation_token:'c'.repeat(8192),
      previous_embed_token:'e'.repeat(8192),buyer_access_token:'b'.repeat(4096)};
    const result=await f.issue(body);assert.equal(result.status,201);
    assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(f.requests[0].options.body),body);
    assert.deepEqual(f.sent,[]);
  }finally{f.channel.close();}
});

test('T29/T30 wrong keys, scopes, proof types and lengths are refused before any transport or worker command',async()=>{
  const f=fixture();try{
    const invalid=[
      {...f.body,service_confirmation:true},{...f.body,actor:{role:'admin'}},
      {...f.body,scopes:[]},{...f.body,scopes:[...allScopes,'admin:*']},
      {...f.body,scopes:[...scopes,scopes[0]]},{...f.body,scopes:['payments:create']},
      {...f.body,scopes:['payment:intents:resume']},{...f.body,scopes:[true]},
      {...f.body,scopes:'checkout:start'},
      ...[null,0,false,{},[], '', 'e'.repeat(8193)].map(previous_embed_token=>({...f.body,previous_embed_token})),
      ...[null,0,false,{},[], '', 'b'.repeat(4097)].map(buyer_access_token=>({...f.body,buyer_access_token})),
      ...[null,0,false,{},[], '', 'c'.repeat(8193)].map(conversation_token=>({...f.body,conversation_token})),
      ...[null,'900',59,901].map(ttl_seconds=>({...f.body,ttl_seconds})),
      {...f.body,allowed_origin:origin+'/nested'},
    ];
    for(const body of invalid)await assert.rejects(()=>f.issue(body),/buyer_booking_fixture_control_invalid/);
    await assert.rejects(()=>f.channel.public.issue({merchantId:'merchant',body:f.body,bypass:true}),/buyer_booking_fixture_control_invalid/);
    await assert.rejects(()=>f.channel.public.issue({merchantId:' merchant',body:f.body}),/buyer_booking_fixture_control_invalid/);
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.sent,[]);
  }finally{f.channel.close();}
});

test('T29/T30 continuity proofs never send the private credential to remote or altered issuer origins',async()=>{
  for(const apiOrigin of['https://foreign.example.test','http://localhost:19429','http://127.0.0.1:80',
    'http://127.0.0.1:19429/path','http://127.0.0.1:19429/?next=x','http://127.0.0.1:19429/#fragment',
    'http://user:password@127.0.0.1:19429']){
    const f=fixture({apiOrigin});try{
      await assert.rejects(f.issue,/buyer_booking_fixture_owned_http_required/);
      assert.deepEqual(f.requests,[]);assert.deepEqual(f.sent,[]);
    }finally{f.channel.close();}
  }
});

test('T29/T30 unadmitted and closed private channels produce no issuer or worker effects',async()=>{
  const f=fixture({admit:false});try{
    await assert.rejects(f.issue,/buyer_booking_fixture_credential_unavailable/);
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.sent,[]);
    f.channel.close();
    await assert.rejects(f.issue,/buyer_booking_fixture_closed/);
    assert.equal(f.channel.accept({type:'local_buyer_booking_credential',runId,credential}),false);
    assert.deepEqual(f.requests,[]);assert.deepEqual(f.sent,[]);
  }finally{f.channel.close();}
});

test('T29/T30 closing an in-flight continuity request aborts it and cannot adopt a late response',async()=>{
  const f=fixture({held:true});try{
    const pending=f.issue(),rejected=assert.rejects(pending,/buyer_booking_fixture_closed/);
    assert.equal(f.requests.length,1);const signal=f.requests[0].options.signal;
    f.channel.close();assert.equal(signal.aborted,true);f.release();await rejected;
    await assert.rejects(f.issue,/buyer_booking_fixture_closed/);
    assert.equal(f.requests.length,1);assert.deepEqual(f.sent,[]);
  }finally{f.channel.close();}
});

test('T29/T30 canonical issuer denials remain denials and cannot authorize the private shortening control',async()=>{
  for(const status of[401,403,409]){
    const f=fixture({status});try{
      assert.deepEqual(await f.issue(),{status,body:{error:'canonical_http_denial'}});
      assert.equal(f.requests.length,1);
      await assert.rejects(()=>f.channel.public.shorten({token:f.issued,seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin}),/buyer_booking_fixture_original_capability_required/);
      assert.deepEqual(f.sent,[]);
    }finally{f.channel.close();}
  }
});
