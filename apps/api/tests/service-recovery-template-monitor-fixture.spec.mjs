import assert from 'node:assert/strict';
import test from 'node:test';
import {RecoveryTemplateMonitorJob} from '../src/modules/whatsapp-templates/infrastructure/recovery-template-monitor.job.js';
import {validateOwnedRecoveryTemplateMonitorFixture,isolateOwnedRecoveryTemplateAutoStart} from './service-recovery-template-monitor-fixture.mjs';

const profile='manual-only-v1';
function fixture(){
  const seedCalls=[],dueCalls=[];
  const repo={async seedMerchantPage(cursor){seedCalls.push(cursor);return 'next-page';}};
  const lifecycle={async processDue(){dueCalls.push('real-job-called-port');}};
  const job=new RecoveryTemplateMonitorJob(repo,lifecycle);
  return{job,repo,lifecycle,seedCalls,dueCalls};
}

test('Recovery monitor fixture selector is closed and confined to the named local native WhatsApp composition',()=>{
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture({}),undefined);
  const options={local:true,whatsapp:true,metaCapabilitiesFixture:'owned-empty-v1',recoveryTemplateMonitorFixture:profile};
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture(options),profile);
  for(const value of[true,false,null,{},[], 'disabled','manual','MANUAL-ONLY-V1'])
    assert.throws(()=>validateOwnedRecoveryTemplateMonitorFixture({...options,recoveryTemplateMonitorFixture:value}),/recovery_monitor_fixture_invalid/);
  for(const patch of[{local:false},{whatsapp:undefined},{whatsapp:false},{metaCapabilitiesFixture:undefined},
    {metaCapabilitiesFixture:'published'},{buyerBooking:true},{graph:true}])
    assert.throws(()=>validateOwnedRecoveryTemplateMonitorFixture({...options,...patch}),/recovery_monitor_fixture_requires_native_whatsapp/);
});

test('Omission preserves the exact instance descriptor, dependencies and original automatic initializer',()=>{
  const f=fixture(),before=Object.getOwnPropertyDescriptors(f.job),prototype=Object.getPrototypeOf(f.job);
  assert.equal(isolateOwnedRecoveryTemplateAutoStart(undefined,f.job,RecoveryTemplateMonitorJob),undefined);
  assert.deepEqual(Object.getOwnPropertyDescriptors(f.job),before);assert.equal(Object.getPrototypeOf(f.job),prototype);
  assert.equal(f.job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  assert.equal(f.job.repo,f.repo);assert.equal(f.job.lifecycle,f.lifecycle);
  assert.deepEqual(f.seedCalls,[]);assert.deepEqual(f.dueCalls,[]);
});

test('Only automatic onModuleInit is excluded while actual explicit runOnce and dependency state remain real',async()=>{
  const f=fixture(),runOnce=f.job.runOnce,destroy=f.job.onModuleDestroy;
  const prototype=Object.getPrototypeOf(f.job),prototypeDescriptor=Object.getOwnPropertyDescriptor(prototype,'onModuleInit');
  const isolation=isolateOwnedRecoveryTemplateAutoStart(profile,f.job,RecoveryTemplateMonitorJob);
  try{
    f.job.onModuleInit();
    assert.deepEqual(f.seedCalls,[]);assert.deepEqual(f.dueCalls,[]);assert.equal(f.job.timer,undefined);
    assert.equal(f.job.runOnce,runOnce);assert.equal(f.job.onModuleDestroy,destroy);
    assert.equal(f.job.repo,f.repo);assert.equal(f.job.lifecycle,f.lifecycle);
    await f.job.runOnce();
    assert.deepEqual(f.seedCalls,[undefined]);assert.deepEqual(f.dueCalls,['real-job-called-port']);
    assert.equal(f.job.cursor,'next-page');assert.equal(f.job.running,false);
    assert.deepEqual(isolation.evidence(),{profile,excludedLifecycle:'RecoveryTemplateMonitorJob.onModuleInit',excludedInitializerCalls:1,restored:false});
    f.job.onModuleDestroy();
  }finally{isolation.restore();}
  assert.equal(Object.hasOwn(f.job,'onModuleInit'),false);
  assert.equal(f.job.onModuleInit,prototypeDescriptor.value);
  assert.equal(Object.getPrototypeOf(f.job),prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype,'onModuleInit'),prototypeDescriptor);
  assert.equal(f.job.cursor,'next-page');
});

test('A present descriptor must be the genuine initializer and is restored with its exact flags',()=>{
  const f=fixture(),original=RecoveryTemplateMonitorJob.prototype.onModuleInit;
  const descriptor={value:original,writable:false,enumerable:true,configurable:true};
  Object.defineProperty(f.job,'onModuleInit',descriptor);
  const isolation=isolateOwnedRecoveryTemplateAutoStart(profile,f.job,RecoveryTemplateMonitorJob);
  f.job.onModuleInit();isolation.restore();isolation.restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.job,'onModuleInit'),descriptor);
  const altered=fixture(),replacement=()=>{};
  Object.defineProperty(altered.job,'onModuleInit',{value:replacement,writable:true,configurable:true});
  assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,altered.job,RecoveryTemplateMonitorJob),/recovery_monitor_fixture_initializer_changed/);
  assert.equal(altered.job.onModuleInit,replacement);
});

test('Wrong identity, subclasses, active state, non-restorable descriptors and spoofed objects are rejected before mutation',()=>{
  class OtherMonitor extends RecoveryTemplateMonitorJob{}
  const invalid=[{},Object.create(RecoveryTemplateMonitorJob.prototype),new OtherMonitor({},{}),
    {...fixture().job,onModuleInit:RecoveryTemplateMonitorJob.prototype.onModuleInit}];
  for(const job of invalid){
    const before=Object.getOwnPropertyDescriptors(job);
    assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,job,RecoveryTemplateMonitorJob),/recovery_monitor_fixture_instance_invalid/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(job),before);
  }
  const legitimate=fixture().job;
  for(const Expected of[undefined,null,()=>{},OtherMonitor]){
    assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,legitimate,Expected),/recovery_monitor_fixture_instance_invalid/);
    assert.equal(Object.hasOwn(legitimate,'onModuleInit'),false);
  }
  assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,new OtherMonitor({},{}),OtherMonitor),/recovery_monitor_fixture_instance_invalid/);
  for(const patch of[{timer:{}},{running:true},{cursor:'already-scanned'}]){
    const f=fixture();Object.assign(f.job,patch);const before=Object.getOwnPropertyDescriptors(f.job);
    assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,f.job,RecoveryTemplateMonitorJob),/recovery_monitor_fixture_already_started/);
    assert.deepEqual(Object.getOwnPropertyDescriptors(f.job),before);
  }
  const frozen=fixture();Object.defineProperty(frozen.job,'onModuleInit',{value:RecoveryTemplateMonitorJob.prototype.onModuleInit,configurable:false});
  assert.throws(()=>isolateOwnedRecoveryTemplateAutoStart(profile,frozen.job,RecoveryTemplateMonitorJob),/recovery_monitor_fixture_initializer_changed/);
});

test('Setup or close failure restores the original descriptor and reports unexpected hook changes honestly',()=>{
  const f=fixture(),isolation=isolateOwnedRecoveryTemplateAutoStart(profile,f.job,RecoveryTemplateMonitorJob);
  assert.throws(()=>{try{throw Error('synthetic_app_init_failure');}finally{isolation.restore();}},/synthetic_app_init_failure/);
  assert.equal(Object.hasOwn(f.job,'onModuleInit'),false);
  assert.equal(f.job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  const changed=fixture(),selected=isolateOwnedRecoveryTemplateAutoStart(profile,changed.job,RecoveryTemplateMonitorJob);
  changed.job.onModuleInit=()=>{};
  assert.throws(()=>selected.restore(),/recovery_monitor_fixture_lifetime_changed/);
  assert.equal(Object.hasOwn(changed.job,'onModuleInit'),false);
  assert.equal(changed.job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  assert.equal(selected.evidence().restored,true);
});

test('Duplicate or borrowed lifecycle calls cannot start a timer and restoration is idempotent',()=>{
  const f=fixture(),isolation=isolateOwnedRecoveryTemplateAutoStart(profile,f.job,RecoveryTemplateMonitorJob),hook=f.job.onModuleInit;
  assert.throws(()=>hook.call({}),/recovery_monitor_fixture_hook_scope_invalid/);
  f.job.onModuleInit();
  assert.throws(()=>f.job.onModuleInit(),/recovery_monitor_fixture_duplicate_initializer/);
  assert.deepEqual(f.seedCalls,[]);assert.deepEqual(f.dueCalls,[]);assert.equal(f.job.timer,undefined);
  isolation.restore();isolation.restore();
  assert.throws(()=>hook.call(f.job),/recovery_monitor_fixture_restored/);
  assert.equal(f.job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  assert.deepEqual(isolation.evidence(),{profile,excludedLifecycle:'RecoveryTemplateMonitorJob.onModuleInit',excludedInitializerCalls:1,restored:true});
});
