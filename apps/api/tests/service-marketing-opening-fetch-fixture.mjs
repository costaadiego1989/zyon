import assert from 'node:assert/strict';

// Owned native-journey transport only. No production URL or credential is
// accepted, and unmatched traffic never falls through to a network client.
const consentText='Quer receber novidades e ofertas desta loja pelo WhatsApp?';
export function createOwnedMarketingOpeningFetch(capture){
  assert.equal(typeof capture,'function');
  return async function ownedMarketingOpeningFetch(input,init){
    assert.equal(typeof input,'string','local_marketing_url_required');
    const url=new URL(input);
    assert.equal(url.origin,'https://graph.facebook.com','local_marketing_origin_forbidden');
    assert.match(url.pathname,/^\/v\d+\.\d+\/900046\d{6}\/messages$/,'local_marketing_owned_phone_id_required');
    assert.equal(url.search+url.hash+url.username+url.password,'','local_marketing_url_suffix_forbidden');
    assert.ok(init&&Object.keys(init).every(key=>['method','redirect','signal','headers','body'].includes(key)),'local_marketing_init_invalid');
    assert.equal(init.method,'POST');assert.equal(init.redirect,'error');
    assert.ok(init.signal instanceof AbortSignal&&!init.signal.aborted,'local_marketing_bounded_signal_required');
    const headers=new Headers(init.headers);
    assert.deepEqual([...headers.keys()].sort(),['authorization','content-type']);
    assert.equal(headers.get('authorization'),'Bearer synthetic-not-a-provider-secret');
    assert.equal(headers.get('content-type'),'application/json');
    assert.equal(typeof init.body,'string');assert.ok(init.body.length<4096);
    const payload=JSON.parse(init.body);
    assert.deepEqual(Object.keys(payload).sort(),['interactive','messaging_product','to','type']);
    assert.equal(payload.messaging_product,'whatsapp');assert.match(payload.to,/^5511998\d{6}$/);
    assert.equal(payload.type,'interactive');
    assert.deepEqual(payload.interactive,{type:'button',body:{text:consentText},action:{buttons:[
      {type:'reply',reply:{id:'marketing_accept_v1',title:'Quero receber'}},
      {type:'reply',reply:{id:'marketing_decline_v1',title:'Agora n\u00e3o'}},
    ]}});
    const messageId=capture(structuredClone(payload));
    assert.equal(typeof messageId,'string');assert.match(messageId,/^synthetic-whatsapp-\d+$/);
    return new Response(JSON.stringify({messages:[{id:messageId}]}),{status:200,headers:{'content-type':'application/json'}});
  };
}

// Install only the documented optional DI seam in its declaring module. All
// original providers, authentication and repositories retain object identity.
export function installOwnedMarketingOpeningFetchProvider(module,token,fetcher,metadata,key){
  assert.equal(typeof token,'symbol');assert.equal(typeof fetcher,'function');
  const original=metadata.getMetadata(key,module);
  assert.ok(Array.isArray(original),'local_marketing_providers_required');
  assert.equal(original.filter(value=>value&&typeof value==='object'&&value.provide===token).length,0,'local_marketing_fetch_must_be_absent');
  const replacement=[...original,{provide:token,useValue:fetcher}];
  metadata.defineMetadata(key,replacement,module);let restored=false;
  return{overrides:['whatsapp-channel.MERCHANT_MARKETING_FETCH'],restore(){
    if(restored)return;assert.equal(metadata.getMetadata(key,module),replacement,'local_marketing_provider_metadata_changed');
    metadata.defineMetadata(key,original,module);restored=true;assert.equal(metadata.getMetadata(key,module),original);
  }};
}
