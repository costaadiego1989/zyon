import assert from 'node:assert/strict';

const PROFILE='manual-only-v1',OPERATOR_PROFILE='operator-manual-only-v1',TARGET='RecoveryTemplateMonitorJob.onModuleInit';
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)
  &&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);

// Only the owned operator HTTP fixture selects this profile. Its explicit
// local sender may use the default outcome or an existing scripted outcome.
// Direct handoff, queue-only, voice and recipient-alert fixtures keep defaults.
export function selectOwnedOperatorRecoveryTemplateMonitorFixture(options){
  const whatsapp=options.whatsapp;
  const transport=whatsapp===true||plain(whatsapp)
    &&Array.isArray(whatsapp.operatorOutcomes)&&whatsapp.operatorOutcomes.length>0
    &&whatsapp.operatorOutcomesByRecipient===undefined
    &&Object.keys(whatsapp.voiceTranscripts??{}).length===0;
  return options.operatorDelivery===true&&options.provider==='META_CLOUD'&&transport?OPERATOR_PROFILE:undefined;
}

export function validateOwnedRecoveryTemplateMonitorFixture(options){
  assert.ok(plain(options),'recovery_monitor_fixture_invalid');
  const profile=options.recoveryTemplateMonitorFixture;
  if(profile===undefined)return undefined;
  assert.ok(profile===PROFILE||profile===OPERATOR_PROFILE,'recovery_monitor_fixture_invalid');
  if(profile===OPERATOR_PROFILE){
    const whatsapp=options.whatsapp;
    const scripted=plain(whatsapp)&&Array.isArray(whatsapp.operatorOutcomes)&&whatsapp.operatorOutcomes.length>0
      &&whatsapp.operatorOutcomesByRecipient===undefined&&Object.keys(whatsapp.voiceTranscripts??{}).length===0;
    // validateLocalWhatsAppOptions(true) yields only the empty voice map.
    // The worker adds its verified private64hex secret before this validation.
    // Raw {} or callback/voice/recipient profiles cannot use this default arm.
    const normalizedDefault=plain(whatsapp)&&Object.keys(whatsapp).length===2
      &&Object.hasOwn(whatsapp,'voiceTranscripts')&&plain(whatsapp.voiceTranscripts)&&Object.keys(whatsapp.voiceTranscripts).length===0
      &&Object.hasOwn(whatsapp,'metaSecret')&&typeof whatsapp.metaSecret==='string'&&/^[a-f0-9]{64}$/.test(whatsapp.metaSecret);
    assert.ok(options.local===true&&(whatsapp===true||scripted||normalizedDefault)
      &&options.metaCapabilitiesFixture===undefined&&options.c60MetaCapabilitiesFixture===undefined
      &&options.c60RecoveryTemplateMonitorFixture===undefined&&options.graph!==true&&options.buyerBooking!==true,
    'recovery_monitor_fixture_requires_operator_delivery');
    return profile;
  }
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
  assert.ok(profile===PROFILE||profile===OPERATOR_PROFILE,'recovery_monitor_fixture_invalid');
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
    evidence:()=>Object.freeze({profile,excludedLifecycle:TARGET,excludedInitializerCalls,restored}),
    restore(){
      if(restored)return;
      try{assert.ok(Object.getPrototypeOf(job)===Job.prototype&&job.onModuleInit===ownedManualOnlyInitializer
        &&Job.prototype.onModuleInit===original&&job.runOnce===runOnce&&job.onModuleDestroy===destroy,
      'recovery_monitor_fixture_lifetime_changed');}
      finally{if(descriptor)Object.defineProperty(job,'onModuleInit',descriptor);else delete job.onModuleInit;restored=true;}
    },
  });
}
