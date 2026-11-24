import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {createOwnedServiceReleaseFixture} from './service-release-owned-fixture.mjs';
import * as protocol from '../src/shared/bookings/service-release-manifest.ts';
import * as artifact from '../src/shared/bookings/service-release-artifact.ts';
import {composeOwnedSourceServiceRelease} from './service-release-source-process.fixture.ts';
const runtime=()=>({sourceRevision:'e'.repeat(40),sourceInputSha256:'d'.repeat(64),apiPayloadSha256:'d'.repeat(64),
  managedSchema:[{migrationId:'synthetic_owned',checksum:'d'.repeat(64)}],writers:protocol.SERVICE_RELEASE_WRITERS.map(value=>({...value,emittedSha256:'d'.repeat(64)}))});

test('T94 direct process synthetic precondition retains actual verifier and module owner',async t=>{
  await t.test('creating a fixture does not compose; explicit matching verifies and close removes only its real owner',()=>{
    const before=artifact.currentServiceReleaseArtifact(),events=[],fixture=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,onEvidence:e=>events.push(e)});
    assert.equal(artifact.currentServiceReleaseArtifact(),before);const scope=fixture.composeProcess(artifact);
    try{assert.ok(scope.owner instanceof artifact.ImmutableServiceReleaseArtifact);assert.equal(artifact.currentServiceReleaseArtifact(),scope.owner);
      assert.equal(scope.owner.read().kind,'verified');assert.equal(events.length,1);assert.equal(scope.evidence.releaseProof,'not_proven');
      assert.equal(scope.evidence.frontendServing,'not_proven');assert.equal(scope.evidence.kind,'synthetic_verifier_precondition');
      assert.equal(scope.evidence.variant,'matching');
    }finally{scope.close();scope.close();}
    assert.notEqual(artifact.currentServiceReleaseArtifact(),scope.owner);assert.deepEqual(scope.owner.read(),{kind:'unavailable',blocker:'release_manifest_missing'});
  });
  await t.test('explicit missing remains unavailable under the same real verifier, never ready by truthiness',()=>{
    const fixture=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,variant:'missing',onEvidence:()=>{}}),scope=fixture.composeProcess(artifact);
    try{assert.equal(artifact.currentServiceReleaseArtifact(),scope.owner);assert.deepEqual(scope.owner.read(),{kind:'unavailable',blocker:'release_manifest_missing'});
      assert.equal(scope.evidence.variant,'missing');assert.equal(scope.evidence.releaseProof,'not_proven');
    }finally{scope.close();}
  });
  await t.test('another owner cannot replace an active source and evidence failure closes the actual composed owner',()=>{
    const fixture=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,onEvidence:()=>{}}),scope=fixture.composeProcess(artifact);
    try{assert.throws(()=>fixture.composeProcess(artifact),/service_release_source_already_composed/);assert.equal(artifact.currentServiceReleaseArtifact(),scope.owner);assert.equal(scope.owner.read().kind,'verified');}
    finally{scope.close();}
    const failure=Error('synthetic evidence collector failed');let attempted;
    const broken=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,onEvidence:()=>{attempted=artifact.currentServiceReleaseArtifact();throw failure;}});
    assert.throws(()=>broken.composeProcess(artifact),error=>error===failure);assert.ok(attempted instanceof artifact.ImmutableServiceReleaseArtifact);
    assert.notEqual(artifact.currentServiceReleaseArtifact(),attempted);assert.deepEqual(attempted.read(),{kind:'unavailable',blocker:'release_manifest_missing'});
  });
  await t.test('the fixed source wrapper requires an explicit closed variant before measuring or composing',()=>{
    const before=artifact.currentServiceReleaseArtifact();
    for(const variant of [undefined,null,true,false,'ready','production',{},[]])assert.throws(()=>composeOwnedSourceServiceRelease(variant),/service_release_process_variant_invalid/);
    assert.equal(artifact.currentServiceReleaseArtifact(),before);
  });
});
