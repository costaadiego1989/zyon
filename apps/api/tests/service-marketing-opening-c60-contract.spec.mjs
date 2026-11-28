import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedMarketingOpeningFetch,ownedC60MarketingOpeningProfile} from './service-marketing-opening-fetch-fixture.mjs';

const cases=Object.freeze([
  ['c60-catalog','owned-c60-catalog-empty-v1','900060000001','5511998000060'],
  ['c60-search','owned-c60-search-empty-v1','900062000001','5511998000062'],
  ['c60-discovery','owned-c60-discovery-empty-v1','900063000001','5511998000063'],
  ['c60-cart','owned-c60-commerce-empty-v1','900064000001','5511998000064'],
  ['c60-contact-delivery','owned-c60-commerce-empty-v1','900064000002','5511998000064'],
  ['c60-payment','owned-c60-commerce-empty-v1','900064000002','5511998000064'],
]);
const url=phone=>'https://graph.facebook.com/v23.0/'+phone+'/messages';
function request(buyer){return{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
  headers:{Authorization:'Bearer synthetic-no-external-meta-secret','Content-Type':'application/json'},
  body:JSON.stringify({messaging_product:'whatsapp',to:buyer,type:'interactive',interactive:{type:'button',
    body:{text:'Quer receber novidades e ofertas desta loja pelo WhatsApp?'},action:{buttons:[
      {type:'reply',reply:{id:'marketing_accept_v1',title:'Quero receber'}},
      {type:'reply',reply:{id:'marketing_decline_v1',title:'Agora n\u00e3o'}},
    ]}}})};}

test('six explicit C60 purposes capture only their exact native opening and preserve both real controls',async()=>{
  for(const[purpose,metaProfile,phone,buyer]of cases){
    const captured=[],fetch=createOwnedMarketingOpeningFetch(payload=>{captured.push(payload);return'synthetic-whatsapp-1';},purpose);
    const profile=ownedC60MarketingOpeningProfile(purpose,metaProfile);assert.ok(Object.isFrozen(profile));
    assert.equal(profile.phoneNumberId,phone);assert.equal(profile.buyerPhone,buyer);
    const response=await fetch(url(phone),request(buyer));assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{messages:[{id:'synthetic-whatsapp-1'}]});assert.equal(captured.length,1);
    assert.deepEqual(captured[0].interactive.action.buttons.map(row=>row.reply),[
      {id:'marketing_accept_v1',title:'Quero receber'},{id:'marketing_decline_v1',title:'Agora n\u00e3o'},
    ]);
  }
});

test('unknown or executable purposes and missing/cross-profile pairings cannot activate C60 capture',()=>{
  for(const purpose of[null,true,false,{},[],()=>{},'__proto__','constructor','c60-other','https://outside.example.test']){
    assert.throws(()=>ownedC60MarketingOpeningProfile(purpose),/local_c60_marketing_purpose_invalid/);
    assert.throws(()=>createOwnedMarketingOpeningFetch(()=>assert.fail('must not capture'),purpose),/local_c60_marketing_purpose_invalid/);
  }
  for(const[purpose,profile]of cases){
    assert.throws(()=>ownedC60MarketingOpeningProfile(purpose,undefined),/local_c60_marketing_profile_mismatch/);
    for(const other of['owned-empty-v1','owned-c60-buyer-empty-v1','unknown'])
      assert.throws(()=>ownedC60MarketingOpeningProfile(purpose,other),/local_c60_marketing_profile_mismatch/);
    assert.equal(ownedC60MarketingOpeningProfile(purpose,profile).metaProfile,profile);
  }
});

test('C60 capture rejects every other Graph phone/buyer/Bearer/version while leaving capture count zero',async()=>{
  for(const[purpose,,phone,buyer]of cases){
    let calls=0;const fetch=createOwnedMarketingOpeningFetch(()=>{calls++;return'synthetic-whatsapp-1';},purpose);
    for(const other of['900046000093','123456','900064999999',...cases.map(row=>row[2]).filter(value=>value!==phone)])
      await assert.rejects(fetch(url(other),request(buyer)));
    for(const other of['5511988888888','5511998000093',...cases.map(row=>row[3]).filter(value=>value!==buyer)])
      await assert.rejects(fetch(url(phone),request(other)));
    for(const authorization of['Bearer synthetic-not-a-provider-secret','Bearer real-like-secret','Basic synthetic-no-external-meta-secret']){
      const init=request(buyer);init.headers.Authorization=authorization;await assert.rejects(fetch(url(phone),init));
    }
    for(const other of[url(phone).replace('/v23.0/','/v24.0/'),url(phone)+'?token=x',
      url(phone).replace('https:','http:'),url(phone).replace('graph.facebook.com','outside.example.test')])
      await assert.rejects(fetch(other,request(buyer)));
    assert.equal(calls,0);
  }
});

test('C60 capture refuses altered body, extra headers, wrong method and unbounded requests',async()=>{
  for(const[purpose,,phone,buyer]of cases){
    let calls=0;const fetch=createOwnedMarketingOpeningFetch(()=>{calls++;return'synthetic-whatsapp-1';},purpose);
    for(const patch of[{method:'GET'},{redirect:'follow'},{signal:undefined},{signal:AbortSignal.abort()}])
      await assert.rejects(fetch(url(phone),{...request(buyer),...patch}));
    const extra=request(buyer);extra.headers['x-extra']='no';await assert.rejects(fetch(url(phone),extra));
    for(const alter of[p=>p.interactive.action.buttons.pop(),p=>p.interactive.body.text='Other prompt',p=>p.type='text',p=>p.other='field']){
      const init=request(buyer),body=JSON.parse(init.body);alter(body);init.body=JSON.stringify(body);await assert.rejects(fetch(url(phone),init));
    }
    assert.equal(calls,0);
  }
});

test('omitted purpose preserves the original native/T93 identity policy and does not admit any C60 identity',async()=>{
  let calls=0;const fetch=createOwnedMarketingOpeningFetch(()=>{calls++;return'synthetic-whatsapp-'+calls;});
  const native=request('5511998000093');native.headers.Authorization='Bearer synthetic-not-a-provider-secret';
  assert.equal((await fetch(url('900046000093'),native)).status,200);assert.equal(calls,1);
  for(const[, ,phone,buyer]of cases)await assert.rejects(fetch(url(phone),request(buyer)));
  assert.equal(calls,1);
});
