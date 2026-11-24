import assert from 'node:assert/strict';
import test from 'node:test';
import {createBuyerBookingFixtureChannel} from './service-test-runtime.mjs';

const runId='6c5300a2-2017-4300-967f-000000000045',origin='https://booking.example.test',credential='e'.repeat(96);
function fixture(){
 const requests=[];const now=Math.floor(Date.now()/1000);
 const claims={typ:'aacp_embed_v1',merchantId:'merchant',issuedAtUnix:now,expiresAtUnix:now+60,nonce:'original-nonce',allowedOrigin:origin,storefrontCartRef:'owned-cart',scopes:['checkout:start','payment:intents:read']};
 const token=Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'s'.repeat(43);
 const channel=createBuyerBookingFixtureChannel({enabled:true,runId,apiOrigin:()=> 'http://127.0.0.1:19445',send:()=>{throw Error('issuer must use real HTTP channel');},fetchOwned:async(url,options)=>{requests.push({url,options});return{status:201,json:async()=>({embed_session_token:token,expires_at_unix:claims.expiresAtUnix})};}});
 channel.accept({type:'local_buyer_booking_credential',runId,credential});
 const body={cart_ref:'owned-cart',conversation_token:'signed-conversation',allowed_origin:origin,scopes:['checkout:start','checkout:track','checkout:chat','payment:intents:create','payment:intents:confirm','payment:intents:read','offers:apply','coupons:apply'],ttl_seconds:900};
 return{channel,body,requests};
}
test('T45 private continuity fixture forwards only the existing real issuer fields and keeps credential private',async()=>{
 const f=fixture();try{
  const body={...f.body,previous_embed_token:'signed-original-embed',buyer_access_token:'signed-current-buyer'};
  const result=await f.channel.public.issue({merchantId:'merchant',body});assert.equal(result.status,201);
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'http://127.0.0.1:19445/embed-sessions');
  assert.deepEqual(JSON.parse(f.requests[0].options.body),body);assert.equal(f.requests[0].options.headers['x-internal-service-token'],credential);
  assert.equal(JSON.stringify(result).includes(credential),false);assert.deepEqual(Object.keys(f.channel.public).sort(),['issue','shorten']);
 }finally{f.channel.close();}
});
test('T45 private continuity fixture rejects unknown fields, unrelated scopes and unbounded proofs before HTTP',async()=>{
 const f=fixture();try{
  for(const patch of[{service_confirmation:true},{scopes:['admin:*']},{scopes:['payment:intents:resume']},{scopes:[...f.body.scopes,'appointments:confirm','extra']},{previous_embed_token:''},{previous_embed_token:'x'.repeat(8193)},{buyer_access_token:''},{buyer_access_token:'x'.repeat(4097)}])await assert.rejects(()=>f.channel.public.issue({merchantId:'merchant',body:{...f.body,...patch}}),/buyer_booking_fixture_control_invalid/);
  assert.deepEqual(f.requests,[]);
 }finally{f.channel.close();}
});
