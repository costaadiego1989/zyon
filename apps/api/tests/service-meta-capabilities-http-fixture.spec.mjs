import assert from 'node:assert/strict';
import test from 'node:test';
import {validateOwnedEmptyMetaCapabilitiesFixture,installOwnedEmptyMetaCapabilitiesHttpFixture} from './service-meta-capabilities-http-fixture.mjs';

const profile='owned-empty-v1',secret='synthetic-not-a-provider-secret';
const urls={
  product_catalogs:'https://graph.facebook.com/v23.0/900046999/product_catalogs?fields=id&limit=2',
  flows:'https://graph.facebook.com/v23.0/900046999/flows?fields=id,name,status&limit=100',
};
const request=()=>({headers:{Authorization:'Bearer '+secret},redirect:'error',signal:new AbortController().signal});
function fixture(env={}){
  const delegated=[],blocked=async(...args)=>{delegated.push(args);throw Error('original_provider_trap');};
  const target={fetch:blocked},originalEnv={...env};
  const selected=installOwnedEmptyMetaCapabilitiesHttpFixture(profile,target,env);
  return{target,env,blocked,delegated,selected,originalEnv};
}

test('Meta capability HTTP profile is closed, explicitly local and requires the original WhatsApp fixture',()=>{
  assert.equal(validateOwnedEmptyMetaCapabilitiesFixture({}),undefined);
  assert.equal(validateOwnedEmptyMetaCapabilitiesFixture({local:true,whatsapp:true,metaCapabilitiesFixture:profile}),profile);
  assert.equal(validateOwnedEmptyMetaCapabilitiesFixture({local:true,whatsapp:{voiceTranscripts:{}},metaCapabilitiesFixture:profile,storefrontQueryModel:true}),profile);
  for(const value of[true,false,null,{},[], 'empty','published', 'OWNED-EMPTY-V1'])
    assert.throws(()=>validateOwnedEmptyMetaCapabilitiesFixture({local:true,whatsapp:true,metaCapabilitiesFixture:value}),/meta_capabilities_fixture_invalid/);
  for(const options of[{},{local:false,whatsapp:true},{local:true},{local:true,whatsapp:false},
    {local:true,whatsapp:true,graph:true},{local:true,whatsapp:true,buyerBooking:true}])
    assert.throws(()=>validateOwnedEmptyMetaCapabilitiesFixture({...options,metaCapabilitiesFixture:profile}),/meta_capabilities_fixture_requires_whatsapp/);
});

test('Omitted Meta capability HTTP profile changes neither the original blocked fetch nor application defaults',()=>{
  const blocked=async()=>{throw Error('unused');},target={fetch:blocked},env={UNRELATED:'keep',WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'};
  const before={...env};
  assert.equal(installOwnedEmptyMetaCapabilitiesHttpFixture(undefined,target,env),undefined);
  assert.equal(target.fetch,blocked);assert.deepEqual(env,before);
});

test('Only the two literal authenticated GET reads return empty Graph envelopes and safe aggregate metadata',async()=>{
  const f=fixture({UNRELATED:'keep'});try{
    for(const url of Object.values(urls)){
      const response=await f.target.fetch(url,request());
      assert.equal(response.status,200);assert.equal(response.ok,true);
      assert.deepEqual(await response.json(),{data:[]});
    }
    assert.deepEqual(f.delegated,[]);
    const evidence=f.selected.evidence();
    assert.deepEqual(evidence,{profile,restored:false,capturedReads:{product_catalogs:1,flows:1},delegatedAttempts:0});
    const serialized=JSON.stringify(evidence);
    for(const privateValue of[secret,'900046999','https://','Authorization','Bearer','"body"','"url"','"data"'])
      assert.equal(serialized.includes(privateValue),false);
    assert.equal(f.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION,'false');
  }finally{f.selected.restore();}
});

test('Wrong URL, WABA, query, header, method, redirect or body delegates unchanged to the same original trap',async()=>{
  const f=fixture();try{
    const valid=request();
    const calls=[
      ['https://graph.facebook.com.evil.test/v23.0/900046999/flows?fields=id,name,status&limit=100',valid],
      [urls.flows.replace('https:','http:'),valid],[urls.flows.replace('/v23.0/','/v24.0/'),valid],
      [urls.flows.replace('900046999','900046998'),valid],[urls.flows.replace('/flows?','/products?'),valid],
      [urls.flows+'&after=cursor',valid],[urls.flows.replace('limit=100','limit=1'),valid],
      [urls.flows.replace('fields=id,name,status','fields=id'),valid],
      ['https://graph.facebook.com/v23.0/900046999/flows?limit=100&fields=id,name,status',valid],
      [urls.product_catalogs+'&access_token='+secret,valid],
      [urls.flows,{...valid,headers:{Authorization:'Bearer wrong'}}],
      [urls.flows,{...valid,headers:{Authorization:'Basic '+secret}}],
      [urls.flows,{...valid,headers:{Authorization:'Bearer '+secret,'x-extra':'blocked'}}],
      [urls.flows,{...valid,headers:{}}],
      ...['POST','PUT','DELETE','get',null].map(method=>[urls.flows,{...valid,method}]),
      [urls.flows,{...valid,body:'{}'}],[urls.flows,{...valid,body:null}],
      [urls.flows,{...valid,body:undefined}],[urls.flows,{...valid,redirect:'follow'}],
      [urls.flows,{...valid,redirect:undefined}],[urls.flows,{...valid,signal:undefined}],
      [urls.flows,{...valid,credentials:'include'}],
      [new URL(urls.flows),valid],[new Request(urls.flows,{headers:valid.headers}),valid],
      [urls.flows,undefined],
    ];
    for(const [input,init]of calls){
      const before=f.delegated.length;
      await assert.rejects(()=>f.target.fetch(input,init),/original_provider_trap/);
      assert.equal(f.delegated.length,before+1);
      assert.equal(f.delegated[before][0],input);assert.equal(f.delegated[before][1],init);
    }
    assert.deepEqual(f.selected.evidence(),{profile,restored:false,capturedReads:{product_catalogs:0,flows:0},delegatedAttempts:calls.length});
  }finally{f.selected.restore();}
});

test('Meta HTTP capture keeps auto-provision disabled through the owned app lifetime and restores exact prior fetch and environment',async()=>{
  for(const initial of[{UNRELATED:'keep'},{UNRELATED:'keep',WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'},
    {WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:''},{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:undefined}]){
    const f=fixture({...initial});const wrapper=f.target.fetch;
    try{
      assert.notEqual(wrapper,f.blocked);
      await Promise.resolve();assert.equal(f.target.fetch,wrapper);
      assert.equal(f.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION,'false');
      await f.target.fetch(urls.flows,request());
      await Promise.resolve();assert.equal(f.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION,'false');
    }finally{f.selected.restore();}
    assert.equal(f.target.fetch,f.blocked);assert.deepEqual(f.env,initial);
    assert.equal(Object.hasOwn(f.env,'WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION'),Object.hasOwn(initial,'WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION'));
    f.selected.restore();
    assert.deepEqual(f.selected.evidence(),{profile,restored:true,capturedReads:{product_catalogs:0,flows:1},delegatedAttempts:0});
  }
});

test('Construction or close failure still restores both original resources without masking a changed transport',()=>{
  const f=fixture({WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'});
  assert.throws(()=>{
    try{throw Error('synthetic_app_construction_failure');}finally{f.selected.restore();}
  },/synthetic_app_construction_failure/);
  assert.equal(f.target.fetch,f.blocked);assert.deepEqual(f.env,f.originalEnv);
  const changed=fixture({WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'});
  changed.target.fetch=async()=>new Response('{}');changed.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION='true';
  assert.throws(()=>changed.selected.restore(),/meta_capabilities_fixture_lifetime_changed/);
  assert.equal(changed.target.fetch,changed.blocked);assert.deepEqual(changed.env,changed.originalEnv);
  assert.equal(changed.selected.evidence().restored,true);
});

test('An already aborted canonical read is not a successful empty response and causes no provider attempt',async()=>{
  const f=fixture();try{
    const controller=new AbortController();controller.abort();
    await assert.rejects(()=>f.target.fetch(urls.flows,{...request(),signal:controller.signal}),{name:'AbortError'});
    assert.deepEqual(f.delegated,[]);
    assert.deepEqual(f.selected.evidence(),{profile,restored:false,capturedReads:{product_catalogs:0,flows:0},delegatedAttempts:0});
  }finally{f.selected.restore();}
});

test('A retained wrapper after restoration cannot manufacture any further capability response',async()=>{
  const f=fixture(),wrapper=f.target.fetch;f.selected.restore();
  const input=urls.flows,init=request();
  await assert.rejects(()=>wrapper(input,init),/original_provider_trap/);
  assert.equal(f.target.fetch,f.blocked);
  assert.equal(f.delegated.length,1);assert.equal(f.delegated[0][0],input);assert.equal(f.delegated[0][1],init);
  assert.deepEqual(f.selected.evidence(),{profile,restored:true,capturedReads:{product_catalogs:0,flows:0},delegatedAttempts:1});
});
