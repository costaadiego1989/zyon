import assert from 'node:assert/strict';
import test from 'node:test';
import {validateOwnedC60MetaCapabilitiesFixture,validateOwnedC60RecoveryTemplateMonitorFixture,installOwnedC60EmptyMetaCapabilitiesHttpFixture} from './service-c60-whatsapp-http-fixture.mjs';
import {isolateOwnedRecoveryTemplateAutoStart} from './service-recovery-template-monitor-fixture.mjs';
import {RecoveryTemplateMonitorJob} from '../src/modules/whatsapp-templates/infrastructure/recovery-template-monitor.job.js';

const cases=Object.freeze([
  ['owned-c60-catalog-empty-v1','900060999','synthetic-no-external-meta-secret'],
  ['owned-c60-search-empty-v1','900062999','synthetic-no-external-meta-secret'],
  ['owned-c60-discovery-empty-v1','900063999','synthetic-no-external-meta-secret'],
  ['owned-c60-commerce-empty-v1','900064999','synthetic-no-external-meta-secret'],
  ['owned-c60-buyer-empty-v1','900093999','synthetic-not-a-provider-secret'],
]);
const options=profile=>({local:true,whatsapp:true,c60MetaCapabilitiesFixture:profile,c60RecoveryTemplateMonitorFixture:'manual-only-v1'});
const urls=waba=>[
  `https://graph.facebook.com/v23.0/${waba}/product_catalogs?fields=id&limit=2`,
  `https://graph.facebook.com/v23.0/${waba}/flows?fields=id,name,status&limit=100`,
];
const request=secret=>({headers:{Authorization:'Bearer '+secret},redirect:'error',signal:new AbortController().signal});
function fixture(profile=cases[0][0],env={}){
  const calls=[],error=Error('original_provider_trap');
  const blocked=async(...args)=>{calls.push(args);throw error;},target={fetch:blocked},before={...env};
  const installed=installOwnedC60EmptyMetaCapabilitiesHttpFixture(profile,target,env);
  return{target,env,before,blocked,calls,error,installed};
}

test('C60 selectors are finite, paired, explicitly local WhatsApp and exclusive of all legacy native profiles',()=>{
  assert.equal(validateOwnedC60MetaCapabilitiesFixture({}),undefined);
  assert.equal(validateOwnedC60RecoveryTemplateMonitorFixture({}),undefined);
  for(const[profile]of cases){assert.equal(validateOwnedC60MetaCapabilitiesFixture(options(profile)),profile);assert.equal(validateOwnedC60RecoveryTemplateMonitorFixture(options(profile)),'manual-only-v1');}
  for(const value of[true,false,null,{},[],'owned-empty-v1','owned-c60-empty-v1','900060999','__proto__','constructor'])
    assert.throws(()=>validateOwnedC60MetaCapabilitiesFixture(options(value)),/c60_meta_fixture_invalid/);
  for(const patch of[{local:false},{whatsapp:undefined},{whatsapp:false},{buyerBooking:true},{graph:true},
    {c60RecoveryTemplateMonitorFixture:undefined},{c60RecoveryTemplateMonitorFixture:'disabled'},
    {metaCapabilitiesFixture:'owned-empty-v1'},{recoveryTemplateMonitorFixture:'manual-only-v1'},
    {bookingAwaitTrace:true},{localModelFailureFixture:'owned-503-v1'},{native18HttpFailures:'owned-final-503-v1'}])
    assert.throws(()=>validateOwnedC60MetaCapabilitiesFixture({...options(cases[0][0]),...patch}),/c60_meta_fixture_requires_owned_whatsapp/);
  for(const value of[true,false,null,{},[],'manual','MANUAL-ONLY-V1'])
    assert.throws(()=>validateOwnedC60RecoveryTemplateMonitorFixture({...options(cases[0][0]),c60RecoveryTemplateMonitorFixture:value}),/c60_recovery_fixture_invalid/);
  assert.throws(()=>validateOwnedC60RecoveryTemplateMonitorFixture({local:true,whatsapp:true,c60RecoveryTemplateMonitorFixture:'manual-only-v1'}),/c60_recovery_fixture_requires_meta/);
});

test('Omission leaves the original provider trap and exact environment defaults untouched',()=>{
  const blocked=async()=>{throw Error('unused');},target={fetch:blocked},env={UNRELATED:'keep',WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'},before={...env};
  assert.equal(installOwnedC60EmptyMetaCapabilitiesHttpFixture(undefined,target,env),undefined);
  assert.equal(target.fetch,blocked);assert.deepEqual(env,before);
});

test('Each C60 profile captures only its two authenticated empty GETs and exposes no capability or private request data',async()=>{
  for(const[profile,waba,secret]of cases){const f=fixture(profile);try{
    for(const url of urls(waba)){const response=await f.target.fetch(url,request(secret));assert.equal(response.status,200);assert.deepEqual(await response.json(),{data:[]});}
    assert.deepEqual(f.calls,[]);
    const evidence=f.installed.evidence();assert.deepEqual(evidence,{profile,restored:false,capturedReads:{product_catalogs:1,flows:1},delegatedAttempts:0});
    for(const privateValue of[waba,secret,'https://','Bearer','Authorization','"eligible"','"published"','"body"','"data"'])assert.equal(JSON.stringify(evidence).includes(privateValue),false);
    assert.equal(f.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION,'false');
  }finally{f.installed.restore();}}
});

test('Cross-profile identities, credential mismatches, every non-GET shape and all unknown URLs delegate unchanged to the exact trap',async()=>{
  const[profile,waba,secret]=cases[0],f=fixture(profile),[catalog,flow]=urls(waba);try{
    const valid=request(secret),calls=[
      [urls('900046999')[1],valid],[urls('900093999')[1],request(cases[4][2])],
      [urls('900062999')[1],valid],[urls('900060998')[1],valid],[urls('9000609990')[1],valid],
      [flow.replace('graph.facebook.com','graph.facebook.com.evil.test'),valid],[flow.replace('https:','http:'),valid],
      [flow.replace('/v23.0/','/v24.0/'),valid],[flow.replace('/flows?','/products?'),valid],
      [flow+'&after=cursor',valid],[flow.replace('limit=100','limit=1'),valid],
      [flow.replace('fields=id,name,status','fields=id'),valid],
      [flow.replace('fields=id,name,status&limit=100','limit=100&fields=id,name,status'),valid],
      [catalog+'&access_token='+secret,valid],[flow,request(cases[4][2])],
      [flow,{...valid,headers:{Authorization:'Basic '+secret}}],
      [flow,{...valid,headers:{Authorization:'Bearer '+secret,'x-extra':'blocked'}}],
      [flow,{...valid,headers:{}}],...['POST','PUT','DELETE','get',null].map(method=>[flow,{...valid,method}]),
      ...['{}',null,undefined].map(body=>[flow,{...valid,body}]),
      [flow,{...valid,redirect:'follow'}],[flow,{...valid,redirect:undefined}],
      [flow,{...valid,signal:undefined}],[flow,{...valid,credentials:'include'}],
      [new URL(flow),valid],[new Request(flow,{headers:valid.headers}),valid],[flow,undefined],
    ];
    for(const[input,init]of calls){const before=f.calls.length;await assert.rejects(()=>f.target.fetch(input,init),error=>error===f.error);assert.equal(f.calls.length,before+1);assert.equal(f.calls[before][0],input);assert.equal(f.calls[before][1],init);}
    assert.deepEqual(f.installed.evidence(),{profile,restored:false,capturedReads:{product_catalogs:0,flows:0},delegatedAttempts:calls.length});
  }finally{f.installed.restore();}
});

test('Aborted canonical GET does not become a successful empty reply or a provider attempt',async()=>{
  const[profile,waba,secret]=cases[0],f=fixture(profile);try{
    const controller=new AbortController();controller.abort();
    await assert.rejects(()=>f.target.fetch(urls(waba)[1],{...request(secret),signal:controller.signal}),{name:'AbortError'});
    assert.deepEqual(f.calls,[]);assert.deepEqual(f.installed.evidence(),{profile,restored:false,capturedReads:{product_catalogs:0,flows:0},delegatedAttempts:0});
  }finally{f.installed.restore();}
});

test('C60 lifetime restores exact fetch and prior environment presence; retained wrappers cannot capture after restoration',async()=>{
  const[profile,waba,secret]=cases[0];
  for(const initial of[{UNRELATED:'keep'},{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'},{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:''},{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:undefined}]){
    const f=fixture(profile,{...initial}),wrapper=f.target.fetch;try{await f.target.fetch(urls(waba)[1],request(secret));}finally{f.installed.restore();}
    assert.equal(f.target.fetch,f.blocked);assert.deepEqual(f.env,initial);assert.equal(Object.hasOwn(f.env,'WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION'),Object.hasOwn(initial,'WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION'));
    const input=urls(waba)[1],init=request(secret);await assert.rejects(()=>wrapper(input,init),error=>error===f.error);
    assert.equal(f.calls[0][0],input);assert.equal(f.calls[0][1],init);f.installed.restore();
    assert.deepEqual(f.installed.evidence(),{profile,restored:true,capturedReads:{product_catalogs:0,flows:1},delegatedAttempts:1});
  }
});

test('A partial C60 transport installation restores its exact original environment before propagating the setter failure',()=>{
  const blocked=async()=>{throw Error('unused');},failure=Error('synthetic_fetch_setter_failure'),env={WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'};
  const target={};Object.defineProperty(target,'fetch',{get:()=>blocked,set:()=>{throw failure;},configurable:true});const before=Object.getOwnPropertyDescriptors(target);
  assert.throws(()=>installOwnedC60EmptyMetaCapabilitiesHttpFixture(cases[0][0],target,env),error=>error===failure);
  assert.deepEqual(env,{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'});assert.deepEqual(Object.getOwnPropertyDescriptors(target),before);
});

test('Unexpected transport/environment mutation is reported while both original resources are restored',()=>{
  const f=fixture(cases[0][0],{WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION:'true'});
  f.target.fetch=async()=>new Response('{}');f.env.WHATSAPP_NATIVE_ASSETS_AUTO_PROVISION='true';
  assert.throws(()=>f.installed.restore(),/c60_meta_fixture_lifetime_changed/);
  assert.equal(f.target.fetch,f.blocked);assert.deepEqual(f.env,f.before);assert.equal(f.installed.evidence().restored,true);
});

test('Explicit C60 recovery uses the unchanged genuine-instance isolation and keeps manual runOnce, other instances and the prototype intact',async()=>{
  const selected=validateOwnedC60RecoveryTemplateMonitorFixture(options(cases[0][0]));
  const seeds=[],due=[],repo={async seedMerchantPage(cursor){seeds.push(cursor);return 'c60-next';}},lifecycle={async processDue(){due.push('real-runOnce-called-port');}};
  const job=new RecoveryTemplateMonitorJob(repo,lifecycle),other=new RecoveryTemplateMonitorJob(repo,lifecycle);
  const prototype=Object.getOwnPropertyDescriptors(RecoveryTemplateMonitorJob.prototype),otherBefore=Object.getOwnPropertyDescriptors(other),runOnce=job.runOnce,destroy=job.onModuleDestroy;
  const isolated=isolateOwnedRecoveryTemplateAutoStart(selected,job,RecoveryTemplateMonitorJob);try{
    job.onModuleInit();assert.equal(job.timer,undefined);assert.deepEqual(seeds,[]);assert.deepEqual(due,[]);
    assert.equal(job.runOnce,runOnce);assert.equal(job.onModuleDestroy,destroy);assert.equal(job.repo,repo);assert.equal(job.lifecycle,lifecycle);
    await job.runOnce();assert.deepEqual(seeds,[undefined]);assert.deepEqual(due,['real-runOnce-called-port']);assert.equal(job.cursor,'c60-next');assert.equal(job.running,false);
    assert.deepEqual(isolated.evidence(),{profile:'manual-only-v1',excludedLifecycle:'RecoveryTemplateMonitorJob.onModuleInit',excludedInitializerCalls:1,restored:false});
    assert.deepEqual(Object.getOwnPropertyDescriptors(other),otherBefore);assert.deepEqual(Object.getOwnPropertyDescriptors(RecoveryTemplateMonitorJob.prototype),prototype);
    job.onModuleDestroy();
  }finally{isolated.restore();}
  assert.equal(Object.hasOwn(job,'onModuleInit'),false);assert.equal(job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  assert.equal(job.cursor,'c60-next');assert.equal(job.runOnce,runOnce);assert.deepEqual(Object.getOwnPropertyDescriptors(RecoveryTemplateMonitorJob.prototype),prototype);
});
