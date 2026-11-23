import assert from 'node:assert/strict';

const PROFILE='manual-only-v1',TARGET='RecoveryTemplateMonitorJob.onModuleInit';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

export function validateOwnedRecoveryTemplateMonitorFixture(options){
  assert.ok(plain(options),'recovery_monitor_fixture_invalid');
  const profile=options.recoveryTemplateMonitorFixture;
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'recovery_monitor_fixture_invalid');
  assert.ok(options.local===true&&(options.whatsapp===true||plain(options.whatsapp))
    &&options.metaCapabilitiesFixture==='owned-empty-v1'&&options.graph!==true&&options.buyerBooking!==true,
  'recovery_monitor_fixture_requires_native_whatsapp');
  return profile;
}

/** Private automatic-start exclusion on one genuine worker-owned DI instance.
 * No prototype, runOnce, dependency, template status, provider or timer is changed.
 * The worker supplies the known productive class and its exact selected instance. */
export function isolateOwnedRecoveryTemplateAutoStart(profile,job,Job){
  if(profile===undefined)return undefined;
  assert.equal(profile,PROFILE,'recovery_monitor_fixture_invalid');
  assert.ok(typeof Job==='function'&&Job.name==='RecoveryTemplateMonitorJob'&&Job.prototype&&job instanceof Job
    &&Object.getPrototypeOf(job)===Job.prototype&&Object.hasOwn(job,'repo')&&Object.hasOwn(job,'lifecycle')
    &&Object.hasOwn(job,'running')&&job.repo&&job.lifecycle
    &&typeof Job.prototype.onModuleInit==='function'&&typeof Job.prototype.runOnce==='function'
    &&job.runOnce===Job.prototype.runOnce&&job.onModuleDestroy===Job.prototype.onModuleDestroy,
  'recovery_monitor_fixture_instance_invalid');
  assert.ok(job.timer===undefined&&job.running===false&&job.cursor===undefined,'recovery_monitor_fixture_already_started');
  const descriptor=Object.getOwnPropertyDescriptor(job,'onModuleInit');
  const original=Job.prototype.onModuleInit,runOnce=job.runOnce,destroy=job.onModuleDestroy;
  assert.ok(descriptor===undefined||descriptor.configurable===true&&Object.hasOwn(descriptor,'value')
    &&descriptor.value===original,'recovery_monitor_fixture_initializer_changed');
  let excludedInitializerCalls=0,restored=false;
  function ownedManualOnlyInitializer(){
    assert.ok(!restored,'recovery_monitor_fixture_restored');
    assert.ok(this===job,'recovery_monitor_fixture_hook_scope_invalid');
    assert.ok(excludedInitializerCalls===0,'recovery_monitor_fixture_duplicate_initializer');
    excludedInitializerCalls++;
  }
  Object.defineProperty(job,'onModuleInit',{value:ownedManualOnlyInitializer,writable:true,enumerable:descriptor?.enumerable??false,configurable:true});
  return Object.freeze({
    evidence:()=>Object.freeze({profile:PROFILE,excludedLifecycle:TARGET,excludedInitializerCalls,restored}),
    restore(){
      if(restored)return;
      try{assert.ok(Object.getPrototypeOf(job)===Job.prototype&&job.onModuleInit===ownedManualOnlyInitializer
        &&Job.prototype.onModuleInit===original&&job.runOnce===runOnce&&job.onModuleDestroy===destroy,
      'recovery_monitor_fixture_lifetime_changed');}
      finally{if(descriptor)Object.defineProperty(job,'onModuleInit',descriptor);else delete job.onModuleInit;restored=true;}
    },
  });
}
