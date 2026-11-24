import assert from 'node:assert/strict';
import test from 'node:test';
import {modeledUnitServiceRelease,createModeledServiceReleaseLedger} from './service-release-modeled-unit.fixture.mjs';
import {composeOwnedSourceServiceRelease} from './service-release-source-process.fixture.ts';
import * as artifact from '../src/shared/bookings/service-release-artifact.ts';
import {serviceActivationReadinessWithin} from '../src/shared/bookings/service-activation-readiness.ts';
const ledgerSql=['SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'];
function tx(query){return{$queryRaw:query,merchant:{findUnique:async()=>({businessMode:'services',businessModeSelectedAt:new Date(),businessModeNeedsReview:false})},
  serviceBusinessPolicy:{findUnique:async()=>({version:1,configuredAt:new Date(),admissionsEnabled:true,holdEnabled:false,paymentMode:'at_attendance'})},serviceReservation:{findFirst:async()=>null}};}

test('T94 explicit modeled unit schema precondition does not certify applied SQL or bypass readiness',async t=>{
  await t.test('rows come from the actual measured owner and the real guard still refuses missing migration facts',async t=>{
    const fixture=modeledUnitServiceRelease(t),current=artifact.currentServiceReleaseArtifact(),result=current.read();assert.equal(result.kind,'verified');
    assert.deepEqual(fixture.measuredSchema,result.manifest.managedSchema);assert.ok(fixture.measuredSchema.length>0);
    assert.equal(fixture.evidence.kind,'modeled_unit_precondition');assert.equal(fixture.evidence.ledgerApplied,false);assert.equal(fixture.evidence.releaseProof,'not_proven');
    assert.equal(fixture.evidence.frontendServing,'not_proven');assert.equal(fixture.evidence.ledgerOrigin,'modeled_schema_rows_from_owned_runtime_measurement');
    const prepared=tx(fixture.wrapQueryRaw(()=>assert.fail('ledger read cannot become a lock')));
    assert.deepEqual(await serviceActivationReadinessWithin(prepared,'services'),{ready:true,blockers:[],policyVersion:1});
    assert.deepEqual(await serviceActivationReadinessWithin(tx(async()=>[]),'services'),{ready:false,blockers:['migration_incompatible'],policyVersion:1});
    assert.deepEqual(fixture.observations(),[{ordinal:1,kind:'modeled_ledger_read'}]);
  });
  await t.test('every call remains visible, unrelated receiver arguments results and failures stay original',async t=>{
    const fixture=modeledUnitServiceRelease(t),calls=[],receiver={},returned={unchanged:true},failure=Error('original mock IO failure');
    function original(...args){calls.push({receiver:this,args});if(args[1]===failure)throw failure;return returned;}
    const wrapped=fixture.wrapQueryRaw(original),query=['SELECT id FROM merchants WHERE id=',' FOR UPDATE'];
    assert.equal(wrapped.call(receiver,query,'services'),returned);assert.equal(calls[0].receiver,receiver);assert.equal(calls[0].args[0],query);assert.equal(calls[0].args[1],'services');
    const rows=await wrapped.call(receiver,ledgerSql);assert.equal(calls.length,1);assert.deepEqual(rows,fixture.measuredSchema.map(row=>({migration_name:row.migrationId,checksum:row.checksum})));
    rows.pop();assert.equal((await wrapped.call(receiver,ledgerSql)).length,fixture.measuredSchema.length);
    assert.throws(()=>wrapped.call(receiver,query,failure),error=>error===failure);assert.equal(calls.length,2);assert.equal(calls[1].args[1],failure);
    assert.deepEqual(fixture.observations(),[{ordinal:1,kind:'delegated'},{ordinal:2,kind:'modeled_ledger_read'},{ordinal:3,kind:'modeled_ledger_read'},{ordinal:4,kind:'delegated'}]);
    const copy=fixture.observations();copy.length=0;assert.equal(fixture.observations().length,4);
  });
  await t.test('other migration SQL and parameters cannot silently receive modeled success rows',async t=>{
    const fixture=modeledUnitServiceRelease(t);let delegated=0;const wrapped=fixture.wrapQueryRaw(()=>{delegated++;return[];});
    for(const input of [[['DELETE FROM _prisma_migrations']],[[ledgerSql[0]],'injected'],[['SELECT migration_name, checksum FROM _prisma_migrations']]])assert.throws(()=>wrapped(...input),/modeled_unit_ledger_query_invalid/);
    assert.equal(delegated,0);assert.deepEqual(fixture.observations(),[{ordinal:1,kind:'refused'},{ordinal:2,kind:'refused'},{ordinal:3,kind:'refused'}]);
  });
  await t.test('missing release stays missing instead of being promoted by a modeled ledger',async()=>{
    const scope=composeOwnedSourceServiceRelease('missing');try{
      assert.throws(()=>createModeledServiceReleaseLedger(scope),/modeled_unit_verified_source_required/);
      assert.deepEqual(await serviceActivationReadinessWithin(tx(async()=>[]),'services'),{ready:false,blockers:['release_manifest_missing'],policyVersion:1});
    }finally{scope.close();}
  });
  await t.test('explicit per-case composition is shared only in that case and registration failure closes the owner',async t=>{
    const before=artifact.currentServiceReleaseArtifact();assert.throws(()=>modeledUnitServiceRelease({}),/modeled_unit_context_required/);assert.equal(artifact.currentServiceReleaseArtifact(),before);
    const failure=Error('original after registration failure');let attempted;
    assert.throws(()=>modeledUnitServiceRelease({after(){attempted=artifact.currentServiceReleaseArtifact();throw failure;}}),error=>error===failure);
    assert.notEqual(artifact.currentServiceReleaseArtifact(),attempted);assert.deepEqual(attempted.read(),{kind:'unavailable',blocker:'release_manifest_missing'});
    const fixture=modeledUnitServiceRelease(t),owner=artifact.currentServiceReleaseArtifact();assert.equal(modeledUnitServiceRelease(t),fixture);assert.equal(artifact.currentServiceReleaseArtifact(),owner);assert.equal(owner.read().kind,'verified');
  });
});
