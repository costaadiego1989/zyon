import { SERVICE_RELEASE_WRITERS, SERVICE_RELEASE_CHECKS, SERVICE_RELEASE_CRITICAL_CASE_IDS, type ServiceReleaseRuntimeFacts, type ServiceActivationRelease } from "../src/shared/bookings/service-release-manifest.js";
import type { ServiceReleaseArtifactSource } from "../src/shared/bookings/service-release-artifact.js";

/** Explicit synthetic manifest PRECONDITION. Never write this to the productive
 * asset or pass its counters to T95 as evidence of a real release. */
export function ownedServiceReleaseFixtureData(runtime: ServiceReleaseRuntimeFacts): { fixtureOnly: true; manifest: ServiceActivationRelease; source: ServiceReleaseArtifactSource } {
  const hash = "d".repeat(64);
  const manifest: ServiceActivationRelease = { schemaVersion: 1, feature: "whatsapp-service-booking-business-rag", contractVersion: 1,
    sourceRevision: runtime.sourceRevision, sourceInputSha256: runtime.sourceInputSha256, apiPayloadSha256: runtime.apiPayloadSha256, criterionInventorySha256: hash,
    frontendArtifacts: ["storefront", "widget", "dashboard"].map(id => ({ id: id as "storefront" | "widget" | "dashboard", sourceRevision: runtime.sourceRevision, artifactSha256: hash })),
    managedSchema: structuredClone(runtime.managedSchema), writers: structuredClone(runtime.writers),
    proofs: SERVICE_RELEASE_CHECKS.map(check => ({ id: check.id, files: [...check.files], sourceRevision: runtime.sourceRevision, apiPayloadSha256: runtime.apiPayloadSha256,
      rawEvidenceSha256: hash, executed: 1, passed: 1, failed: 0, skipped: 0, exitCode: 0, origin: check.origin as "local_http_sql_redis" | "served_browser" })),
    ragEvaluation: { sourceRevision: runtime.sourceRevision, datasetSha256: hash, contractSha256: hash, rawEvidenceSha256: hash, businesses: ["clinic", "salon", "consulting"],
      criticalCaseIds: [...SERVICE_RELEASE_CRITICAL_CASE_IDS], passedCriticalCaseIds: [...SERVICE_RELEASE_CRITICAL_CASE_IDS], executed: SERVICE_RELEASE_CRITICAL_CASE_IDS.length,
      invalidObservations: 0, failedCritical: 0, mode: "owned_runtime" } };
  return { fixtureOnly: true, manifest, source: Object.freeze({ readManifest: () => structuredClone(manifest), measureRuntime: () => structuredClone(runtime) }) };
}
export function syntheticServiceReleaseRuntime(): ServiceReleaseRuntimeFacts {
  const hash = "d".repeat(64);
  return { sourceRevision: "e".repeat(40), sourceInputSha256: hash, apiPayloadSha256: hash,
    managedSchema: [{ migrationId: "synthetic_owned", checksum: hash }], writers: SERVICE_RELEASE_WRITERS.map(value => ({ ...value, emittedSha256: hash })) };
}
