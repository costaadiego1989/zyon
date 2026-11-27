import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {selectOwnedOperatorRecoveryTemplateMonitorFixture,validateOwnedRecoveryTemplateMonitorFixture,isolateOwnedRecoveryTemplateAutoStart} from './service-recovery-template-monitor-fixture.mjs';
import {installConstructionProviderTrap} from './nest-construction-provider-trap.mjs';

assertServiceArtifacts();
const {RecoveryTemplateMonitorJob}=await import('../dist/modules/whatsapp-templates/infrastructure/recovery-template-monitor.job.js');

const profile='operator-manual-only-v1';
const outcomes=[{status:'sent',messageId:'synthetic-operator-accepted'}];
const composition=()=>({operatorDelivery:true,provider:'META_CLOUD',whatsapp:{operatorOutcomes:outcomes}});
const normalizedDefault=()=>({voiceTranscripts:{},metaSecret:'a'.repeat(64)});

test('Only explicit default or scripted Meta operator delivery selects its private monitor lifecycle profile',()=>{
  assert.equal(selectOwnedOperatorRecoveryTemplateMonitorFixture(composition()),profile);
  assert.equal(selectOwnedOperatorRecoveryTemplateMonitorFixture({...composition(),whatsapp:true}),profile);
  assert.equal(selectOwnedOperatorRecoveryTemplateMonitorFixture({provider:'META_CLOUD',whatsapp:true}),undefined);
  assert.equal(selectOwnedOperatorRecoveryTemplateMonitorFixture({...composition(),whatsapp:{operatorOutcomes:outcomes,operatorStatusCallbacks:true}}),profile);
  for(const patch of[{operatorDelivery:false},{operatorDelivery:undefined},{provider:'TWILIO'},{whatsapp:undefined},{whatsapp:{}},
    {whatsapp:{operatorOutcomes:[]}},{whatsapp:{operatorOutcomesByRecipient:{'5511999999999':outcomes[0]}}},
    {whatsapp:{operatorOutcomes:outcomes,voiceTranscripts:{'123':'Synthetic voice'}}}])
    assert.equal(selectOwnedOperatorRecoveryTemplateMonitorFixture({...composition(),...patch}),undefined);
});

test('The operator monitor profile admits only its local default normalization or script and grants no metadata or buyer admission',()=>{
  const options={local:true,whatsapp:{operatorOutcomes:outcomes},recoveryTemplateMonitorFixture:profile};
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture(options),profile);
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture({...options,whatsapp:true}),profile);
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture({...options,whatsapp:normalizedDefault()}),profile);
  // The worker adds its private metaSecret and normalized empty voice map.
  assert.equal(validateOwnedRecoveryTemplateMonitorFixture({...options,whatsapp:{operatorOutcomes:outcomes,voiceTranscripts:{},metaSecret:'a'.repeat(64)}}),profile);
  for(const patch of[{local:false},{whatsapp:false},{whatsapp:undefined},{whatsapp:{}},{whatsapp:{voiceTranscripts:{}}},
    {whatsapp:{voiceTranscripts:{},metaSecret:'invalid'}},{whatsapp:{...normalizedDefault(),operatorStatusCallbacks:true}},
    {whatsapp:{operatorOutcomes:[]}},
    {whatsapp:{operatorOutcomes:outcomes,operatorOutcomesByRecipient:{}}},
    {whatsapp:{operatorOutcomes:outcomes,voiceTranscripts:{'123':'Synthetic voice'}}},
    {graph:true},{buyerBooking:true},{metaCapabilitiesFixture:'owned-empty-v1'},
    {c60MetaCapabilitiesFixture:'owned-c60-catalog-empty-v1'},{c60RecoveryTemplateMonitorFixture:'manual-only-v1'}])
    assert.throws(()=>validateOwnedRecoveryTemplateMonitorFixture({...options,...patch}),/recovery_monitor_fixture_requires_operator_delivery/);
  // Existing native profile still requires its original named metadata fixture.
  assert.throws(()=>validateOwnedRecoveryTemplateMonitorFixture({...options,recoveryTemplateMonitorFixture:'manual-only-v1'}),/recovery_monitor_fixture_requires_native_whatsapp/);
});

test('Operator isolation removes only automatic start; a real explicit monitor run retains the unchanged provider trap',async()=>{
  const trap=await installConstructionProviderTrap(19111,19112),originalFetch=globalThis.fetch;
  let isolation,job;
  const seedCalls=[],dueCalls=[];
  const repo={async seedMerchantPage(cursor){seedCalls.push(cursor);return 'operator-next-page';}};
  const lifecycle={async processDue(){dueCalls.push('explicit-real-monitor-run');await fetch('https://graph.facebook.com/v23.0/90002999/message_templates',{method:'POST'});}};
  const other=new RecoveryTemplateMonitorJob(repo,lifecycle);
  const prototype=Object.getOwnPropertyDescriptors(RecoveryTemplateMonitorJob.prototype),otherBefore=Object.getOwnPropertyDescriptors(other);
  try{
    job=new RecoveryTemplateMonitorJob(repo,lifecycle);
    const runOnce=job.runOnce,destroy=job.onModuleDestroy;
    const selected=validateOwnedRecoveryTemplateMonitorFixture({local:true,whatsapp:normalizedDefault(),recoveryTemplateMonitorFixture:profile});
    isolation=isolateOwnedRecoveryTemplateAutoStart(selected,job,RecoveryTemplateMonitorJob);
    job.onModuleInit();
    assert.equal(job.timer,undefined);assert.deepEqual(seedCalls,[]);assert.deepEqual(dueCalls,[]);
    assert.equal(trap.evidence().providerCalls,0);assert.equal(globalThis.fetch,originalFetch);
    assert.equal(job.runOnce,runOnce);assert.equal(job.onModuleDestroy,destroy);
    await job.runOnce();
    assert.deepEqual(seedCalls,[undefined]);assert.deepEqual(dueCalls,['explicit-real-monitor-run']);
    assert.equal(job.cursor,'operator-next-page');assert.equal(job.running,false);
    assert.deepEqual(trap.evidence(),{fetchCalls:1,unownedSocketAttempts:0,sentinelRequests:0,providerCalls:1});
    assert.equal(trap.diagnostics()[0].kind,'fetch');assert.equal(globalThis.fetch,originalFetch);
    assert.deepEqual(Object.getOwnPropertyDescriptors(other),otherBefore);
    assert.deepEqual(Object.getOwnPropertyDescriptors(RecoveryTemplateMonitorJob.prototype),prototype);
  }finally{
    try{job?.onModuleDestroy();isolation?.restore();}finally{await trap.dispose();}
  }
  assert.equal(Object.hasOwn(job,'onModuleInit'),false);assert.equal(job.onModuleInit,RecoveryTemplateMonitorJob.prototype.onModuleInit);
  assert.deepEqual(isolation.evidence(),{profile,excludedLifecycle:'RecoveryTemplateMonitorJob.onModuleInit',excludedInitializerCalls:1,restored:true});
});
