import assert from 'node:assert/strict';
import {MODULE_METADATA} from '@nestjs/common/constants.js';

/** Named owned-runtime precondition. Only source bytes/measured facts are
 * substituted. The real ImmutableServiceReleaseArtifact/verifier remains. */
export function createOwnedServiceReleaseFixture({runtime,protocol,onEvidence,variant='matching'}){
  assert.equal(typeof onEvidence,'function');assert.ok(['matching','missing'].includes(variant));const hash='d'.repeat(64);
  const manifest={schemaVersion:1,feature:'whatsapp-service-booking-business-rag',contractVersion:1,...structuredClone(runtime),criterionInventorySha256:hash,
    frontendArtifacts:['storefront','widget','dashboard'].map(id=>({id,sourceRevision:runtime.sourceRevision,artifactSha256:hash})),
    proofs:protocol.SERVICE_RELEASE_CHECKS.map(check=>({id:check.id,files:[...check.files],sourceRevision:runtime.sourceRevision,apiPayloadSha256:runtime.apiPayloadSha256,
      rawEvidenceSha256:hash,executed:1,passed:1,failed:0,skipped:0,exitCode:0,origin:check.origin})),
    ragEvaluation:{sourceRevision:runtime.sourceRevision,datasetSha256:hash,contractSha256:hash,rawEvidenceSha256:hash,businesses:['clinic','salon','consulting'],
      criticalCaseIds:[...protocol.SERVICE_RELEASE_CRITICAL_CASE_IDS],passedCriticalCaseIds:[...protocol.SERVICE_RELEASE_CRITICAL_CASE_IDS],executed:protocol.SERVICE_RELEASE_CRITICAL_CASE_IDS.length,
      invalidObservations:0,failedCritical:0,mode:'owned_runtime'}};
  const source=Object.freeze({readManifest:()=>variant==='missing'?undefined:structuredClone(manifest),measureRuntime:()=>structuredClone(runtime)});
  assert.equal(protocol.verifyServiceReleaseManifest(manifest,runtime).kind,'verified');
  const evidence=Object.freeze({kind:'synthetic_verifier_precondition',variant,sourceOverride:'service-activation.SERVICE_RELEASE_ARTIFACT_SOURCE',
    payloadSha256:runtime.apiPayloadSha256,sourceInputSha256:runtime.sourceInputSha256,revisionIsSynthetic:true,releaseProof:'not_proven',frontendServing:'not_proven',
    ledgerOrigin:'owned_identified_baseline_then_real_migrate_deploy'});
  function install(module,token){
    const original=Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module);assert.ok(Array.isArray(original));
    const matched=original.filter(value=>value&&typeof value==='object'&&value.provide===token);assert.equal(matched.length,1);
    const changed=original.map(value=>value===matched[0]?{provide:token,useValue:source}:value);assert.equal(changed.filter((value,index)=>value!==original[index]).length,1);
    Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,changed,module);let restored=false;onEvidence(evidence);
    return{restore(){if(restored)return;assert.equal(Reflect.getMetadata(MODULE_METADATA.PROVIDERS,module),changed);Reflect.defineMetadata(MODULE_METADATA.PROVIDERS,original,module);restored=true;}};
  }
  // Private direct-process composition uses this SAME datasource and the
  // caller's fixed source/dist artifact module. It never replaces the verifier.
  function composeProcess(artifact){
    let owner;
    try{
      owner=artifact.composeServiceReleaseArtifactSource(source);
      assert.ok(owner instanceof artifact.ImmutableServiceReleaseArtifact);
      assert.equal(artifact.currentServiceReleaseArtifact(),owner);
      const result=owner.read();assert.equal(result.kind,variant==='missing'?'unavailable':'verified');
      if(result.kind==='unavailable')assert.equal(result.blocker,'release_manifest_missing');
      else assert.equal(result.manifest.apiPayloadSha256,runtime.apiPayloadSha256);
      onEvidence(evidence);
      return{owner,evidence,close(){owner.onModuleDestroy();}};
    }catch(error){owner?.onModuleDestroy();throw error;}
  }
  return{install,composeProcess,evidence,assertBindings(app,{ImmutableServiceReleaseArtifact}){const actual=app.get(ImmutableServiceReleaseArtifact);
    assert.ok(actual instanceof ImmutableServiceReleaseArtifact);const verified=actual.read();assert.equal(verified.kind,variant==='missing'?'unavailable':'verified');
    if(verified.kind==='verified')assert.equal(verified.manifest.apiPayloadSha256,runtime.apiPayloadSha256);else assert.equal(verified.blocker,'release_manifest_missing');}};
}
