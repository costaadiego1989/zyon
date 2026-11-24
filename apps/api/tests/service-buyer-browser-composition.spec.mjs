import assert from 'node:assert/strict';
import test from 'node:test';
import {isAllowedBuyerBookingFixture,isOwnedBuyerBrowserRenewalWindow} from './service-buyer-booking-fixture-options.mjs';
import {createBuyerBookingFixtureChannel,validateBuyerBookingFixtureRequest} from './service-test-runtime.mjs';

const runId='6c5300a2-2017-4300-967f-000000000093';
const script=[{phase:'storefront.intent',response:{schemaVersion:2,domain:'STORE_COMMERCE',intent:'COMPLEX_QUESTION',confidence:1,
  requiresTool:true,needsProductDiscovery:false,shoppingPhase:null,serviceRequest:'live_facts',serviceAction:'browse'}},
{phase:'storefront.sales',serviceToolCall:{name:'get_service_professionals',args:{productId:'service',variantId:'variant'}}}];
const options={local:true,buyerBooking:true,buyerBrowser:true,storefrontQueryModel:true,modelScript:script};

test('T93 private buyer browser composes only with the existing buyer and scripted storefront capability',()=>{
  assert.equal(isAllowedBuyerBookingFixture(options),true);
  for(const patch of[{buyerBooking:false},{buyerBrowser:false},{storefrontQueryModel:undefined},{modelScript:undefined},
    {whatsapp:true},{whatsapp:{}},{graph:true},{supportQueryModel:true},{observeBusinessRag:true}])
    assert.equal(isAllowedBuyerBookingFixture({...options,...patch}),false);
  assert.equal(isAllowedBuyerBookingFixture({buyerBooking:true}),true);
});
test('T93 browser opt-in adds only private mailbox and compiled Next lifecycle, preserving the default issuer facade',async()=>{
  const create=browserEnabled=>createBuyerBookingFixtureChannel({enabled:true,browserEnabled,runId,
    apiOrigin:()=> 'http://127.0.0.1:23456',send:()=>true,fetchOwned:()=>{throw Error('unexpected network');}});
  const original=create(false),browser=create(true);
  try{
    assert.deepEqual(Object.keys(original.public).sort(),['issue','shorten']);
    assert.equal(Object.hasOwn(original.public,'openStorefront'),false);
    assert.throws(()=>original.accept({type:'local_buyer_browser_email',runId,sequence:1,email:'buyer@buyer-journey.example.test',code:'123456'}));
    await assert.rejects(browser.public.openStorefront(),/credential_unavailable/);
    assert.throws(()=>browser.public.emailCode('buyer@buyer-journey.example.test'),/delivery_not_observed/);
    browser.accept({type:'local_buyer_browser_email',runId,sequence:1,email:'buyer@buyer-journey.example.test',code:'123456'});
    assert.deepEqual(browser.public.emailCode('buyer@buyer-journey.example.test'),{code:'123456',sequence:1});
    assert.deepEqual(browser.public.browserEvidence(),{capturedEmailCount:1,externalEmailDeliveries:0});
    assert.equal(JSON.stringify(browser.public).includes('123456'),false);
    assert.equal(Object.hasOwn(browser.public,'credential'),false);
  }finally{await original.closeStorefront();await browser.closeStorefront();original.close();browser.close();}
  assert.throws(()=>browser.public.emailCode('buyer@buyer-journey.example.test'),/fixture_closed/);
});

// These tests model the private HTTP/control boundary only. The original browser
// file remains the real signature/issuer/SQL proof; no fixture response is a
// provider, production, signed-token or completed booking claim.
const browserOrigin='http://127.0.0.1:5188',credential='e'.repeat(96);
const envelope=claims=>Buffer.from(JSON.stringify(claims)).toString('base64url')+'.'+'s'.repeat(43);
function renewedFixture({browserEnabled=true,continuation=true,status=201,window=900,changedNonce=false}={}){
 const now=Math.floor(Date.now()/1000),state={sent:[],requests:[],claims:undefined,token:undefined};
 const original={typ:'aacp_embed_v1',merchantId:'merchant',environment:'live',issuedAtUnix:now-2,expiresAtUnix:now+898,
  nonce:'original-nonce',allowedOrigin:browserOrigin,storefrontCartRef:'owned-cart',aiUserId:'visitor:synthetic',
  scopes:['checkout:start','checkout:track','appointments:confirm','payment:intents:read']};
 const channel=createBuyerBookingFixtureChannel({enabled:true,browserEnabled,runId,apiOrigin:()=> 'http://127.0.0.1:23456',send:value=>{state.sent.push(value);return true;},
  fetchOwned:async(url,options)=>{state.requests.push({url,options});state.claims={...original,nonce:changedNonce?'changed-nonce':original.nonce,expiresAtUnix:Math.floor(Date.now()/1000)+window};
   state.token=envelope(state.claims);return{status,json:async()=>status===201?{embed_session_token:state.token,expires_at_unix:state.claims.expiresAtUnix}:{code:'unauthorized'}};}});
 channel.accept({type:'local_buyer_booking_credential',runId,credential});
 const body={cart_ref:'owned-cart',conversation_token:'original-owned-conversation',allowed_origin:browserOrigin,ttl_seconds:60,scopes:[...original.scopes],
  ...(continuation?{previous_embed_token:envelope(original),buyer_access_token:'synthetic-real-issuer-buyer'}:{})};
 const issue=()=>channel.public.issue({merchantId:'merchant',body});
 const shorten=(patch={})=>channel.public.shorten({token:state.token,seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin:browserOrigin,...patch});
 return{channel,state,issue,shorten,body};
}

test('T93 observed browser renewal expiry admission keeps original non-browser authority',async t=>{
 await t.test('a renewed default900 window preserves the older issuedAt without demanding lifetime60',()=>{
  const now=2000000000,claims={typ:'aacp_embed_v1',merchantId:'merchant',environment:'live',issuedAtUnix:now-2,expiresAtUnix:now+900,
   nonce:'real-nonce',allowedOrigin:browserOrigin,storefrontCartRef:'owned-cart',scopes:['checkout:start','appointments:confirm','payment:intents:read']};
  assert.equal(isOwnedBuyerBrowserRenewalWindow(claims,true,now),true);assert.equal(claims.expiresAtUnix-claims.issuedAtUnix,902);
  assert.equal(isOwnedBuyerBrowserRenewalWindow(claims,false,now),false);assert.equal(isOwnedBuyerBrowserRenewalWindow(claims,undefined,now),false);
  for(const patch of[{environment:'test'},{allowedOrigin:'https://foreign.example.test'},{nonce:'dev_bypass'},{cartRef:'legacy'},
   {whatsappCheckoutSessionId:'private'},{paymentResume:{}},{recoveredCheckoutSessionId:'private'},
   {scopes:['checkout:start','appointments:confirm']},{scopes:['checkout:start','payment:intents:read']},
   {expiresAtUnix:now+901},{expiresAtUnix:now+5},{issuedAtUnix:now+1},{issuedAtUnix:now-86400}])
   assert.equal(isOwnedBuyerBrowserRenewalWindow({...claims,...patch},true,now),false);
 });
 await t.test('only a real201 observed-buyer continuation inside the issuer900 interval enters shortening',async()=>{
  const f=renewedFixture();try{
   const response=await f.issue();assert.equal(response.status,201);const pending=f.shorten(),message=f.state.sent[0];
   assert.equal(message.operation,'shorten');assert.equal(message.runId,runId);assert.equal(f.state.sent.length,1);
   assert.deepEqual(Object.keys(message.input).sort(),['cartRef','merchantId','origin','seconds','token']);
   const shortened={...f.state.claims,expiresAtUnix:Math.floor(Date.now()/1000)+3};
   const result={token:envelope(shortened),expiresAtUnix:shortened.expiresAtUnix,fixtureShortTTL:true};
   assert.equal(f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result}),true);
   assert.deepEqual(await pending,result);assert.ok(result.expiresAtUnix<f.state.claims.expiresAtUnix);
   const {expiresAtUnix:_old,...oldClaims}=f.state.claims,{expiresAtUnix:_new,...newClaims}=shortened;assert.deepEqual(newClaims,oldClaims);
  }finally{f.channel.close();}
 });
 await t.test('default non-browser, fresh browser, wrong900 interval and altered original nonce remain refused before IPC',async()=>{
  for(const options of[{browserEnabled:false},{continuation:false},{window:800},{window:901},{changedNonce:true},{status:401}]){
   const f=renewedFixture(options);try{
    await f.issue();await assert.rejects(f.shorten,/buyer_booking_fixture_original_capability_required/);assert.deepEqual(f.state.sent,[]);
   }finally{f.channel.close();}
  }
 });
 await t.test('merchant cart origin and opaque token substitution never borrow a recorded browser renewal',async()=>{
  const f=renewedFixture();try{
   await f.issue();for(const patch of[{merchantId:'foreign'},{cartRef:'foreign'},{origin:'https://foreign.example.test'},{token:f.state.token+'tampered'}])
    await assert.rejects(()=>f.shorten(patch),/buyer_booking_fixture_original_capability_required/);
   assert.deepEqual(f.state.sent,[]);
  }finally{f.channel.close();}
 });
 await t.test('no caller field can enable browser mode or extend the bounded expiry operation',()=>{
  const valid={type:'local_buyer_booking_request',runId,requestId:'a'.repeat(32),operation:'shorten',input:{token:'opaque',seconds:3,merchantId:'merchant',cartRef:'owned-cart',origin:browserOrigin}};
  for(const patch of[{browserEnabled:true},{buyerBrowser:true},{default900:true},{scopes:['appointments:confirm']},{issuedAtUnix:1},{seconds:6}])
   assert.throws(()=>validateBuyerBookingFixtureRequest({...valid,input:{...valid.input,...patch}},runId),/buyer_booking_fixture_control_invalid/);
  assert.deepEqual(validateBuyerBookingFixtureRequest(valid,runId),valid);
 });
 await t.test('a signer reply changing nonce instead of only lowering expiry remains rejected for the browser path',async()=>{
  const f=renewedFixture();try{
   await f.issue();const pending=f.shorten(),rejection=assert.rejects(pending,/buyer_booking_fixture_control_invalid/),message=f.state.sent[0];
   const changed={...f.state.claims,nonce:'different',expiresAtUnix:Math.floor(Date.now()/1000)+3};
   assert.throws(()=>f.channel.accept({type:'local_buyer_booking_result',runId,requestId:message.requestId,result:{token:envelope(changed),expiresAtUnix:changed.expiresAtUnix,fixtureShortTTL:true}}),/buyer_booking_fixture_control_invalid/);
   await rejection;assert.equal(f.state.sent.length,1);
  }finally{f.channel.close();}
 });
});
