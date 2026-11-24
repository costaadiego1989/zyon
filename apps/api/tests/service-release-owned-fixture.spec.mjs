import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import {MODULE_METADATA} from '@nestjs/common/constants.js';
import {createOwnedServiceReleaseFixture} from './service-release-owned-fixture.mjs';
import * as protocol from '../src/shared/bookings/service-release-manifest.ts';
import {ImmutableServiceReleaseArtifact} from '../src/shared/bookings/service-release-artifact.ts';
const runtime=()=>({sourceRevision:'e'.repeat(40),sourceInputSha256:'d'.repeat(64),apiPayloadSha256:'d'.repeat(64),
  managedSchema:[{migrationId:'synthetic_owned',checksum:'d'.repeat(64)}],writers:protocol.SERVICE_RELEASE_WRITERS.map(value=>({...value,emittedSha256:'d'.repeat(64)}))});
test('T94 private owned datasource fixture ABI',async t=>{
  await t.test('matching and missing bytes consume the same actual verifier and disclose their synthetic scope',()=>{
    for(const variant of ['matching','missing']){
      const evidence=[],fixture=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,variant,onEvidence:value=>evidence.push(value)}),token=Symbol('datasource');class Host{}
      const original=[{provide:token,useFactory:()=>assert.fail('replaced local datasource')},{provide:Symbol('preserved-guard'),useValue:{}}];
      Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,Host);const installed=fixture.install(Host,token);
      try{const providers=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Host);assert.equal(providers[1],original[1]);
        const artifact=new ImmutableServiceReleaseArtifact(providers[0].useValue);fixture.assertBindings({get:requested=>{assert.equal(requested,ImmutableServiceReleaseArtifact);return artifact;}},{ImmutableServiceReleaseArtifact});
        assert.equal(evidence[0].releaseProof,'not_proven');assert.equal(evidence[0].frontendServing,'not_proven');assert.equal(evidence[0].variant,variant);
      }finally{installed.restore();assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Host),original);}
    }
  });
  await t.test('no ready boolean, arbitrary variant, issuer or shorter writer descriptor is accepted',()=>{
    for(const variant of [true,false,'ready','production'])assert.throws(()=>createOwnedServiceReleaseFixture({runtime:runtime(),protocol,variant,onEvidence:()=>{}}));
    const short=runtime();short.writers.pop();assert.throws(()=>createOwnedServiceReleaseFixture({runtime:short,protocol,onEvidence:()=>{}}));
  });
  await t.test('provider metadata must contain exactly the named datasource and cleanup restores it after failure',()=>{
    const token=Symbol('datasource'),fixture=createOwnedServiceReleaseFixture({runtime:runtime(),protocol,onEvidence:()=>{}});class Host{}
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,[],Host);assert.throws(()=>fixture.install(Host,token));
    const original=[{provide:token,useValue:{}}];Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,Host);const installed=fixture.install(Host,token);
    try{assert.throws(()=>{throw Error('synthetic construct failure');});}finally{installed.restore();}
    assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,Host),original);
  });
});
