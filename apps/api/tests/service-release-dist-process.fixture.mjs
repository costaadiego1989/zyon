import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import * as artifact from '../dist/shared/bookings/service-release-artifact.js';
import * as protocol from '../dist/shared/bookings/service-release-manifest.js';
import {assertServiceArtifacts} from './service-test-artifacts.mjs';
import {createOwnedServiceReleaseFixture} from './service-release-owned-fixture.mjs';

/** Private measured precondition only for direct writers importing dist. */
export function composeOwnedDistServiceRelease(variant){
  assert.ok(variant==='matching'||variant==='missing','service_release_process_variant_invalid');
  assertServiceArtifacts();
  const runtime=artifact.measureServiceReleaseRuntime(fileURLToPath(new URL('../',import.meta.url)),'e'.repeat(40));
  return createOwnedServiceReleaseFixture({runtime,protocol,variant,onEvidence:()=>{}}).composeProcess(artifact);
}
