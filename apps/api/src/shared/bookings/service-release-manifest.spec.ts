import assert from "node:assert/strict";
import test from "node:test";
import { verifyServiceReleaseManifest, SERVICE_RELEASE_WRITERS, SERVICE_RELEASE_CHECKS, SERVICE_RELEASE_CRITICAL_CASE_IDS } from "./service-release-manifest.js";

// Synthetic verifier precondition only, never an actual release artifact.
function example() {
  const hash = "a".repeat(64), revision = "b".repeat(40);
  const runtime = { sourceRevision: revision, sourceInputSha256: hash, apiPayloadSha256: hash,
    writers: SERVICE_RELEASE_WRITERS.map(value => ({ ...value, emittedSha256: hash })), managedSchema: [{ migrationId: "synthetic_schema", checksum: hash }] };
  const manifest: any = { schemaVersion: 1, feature: "whatsapp-service-booking-business-rag", contractVersion: 1,
    sourceRevision: revision, sourceInputSha256: hash, apiPayloadSha256: hash, criterionInventorySha256: hash,
    frontendArtifacts: ["storefront", "widget", "dashboard"].map(id => ({ id, sourceRevision: revision, artifactSha256: hash })),
    managedSchema: structuredClone(runtime.managedSchema), writers: structuredClone(runtime.writers),
    proofs: SERVICE_RELEASE_CHECKS.map(value => ({ id: value.id, files: [...value.files], sourceRevision: revision, apiPayloadSha256: hash,
      rawEvidenceSha256: hash, executed: 1, passed: 1, failed: 0, skipped: 0, exitCode: 0, origin: value.origin })),
    ragEvaluation: { sourceRevision: revision, datasetSha256: hash, contractSha256: hash, rawEvidenceSha256: hash, businesses: ["clinic", "salon", "consulting"],
      criticalCaseIds: [...SERVICE_RELEASE_CRITICAL_CASE_IDS], passedCriticalCaseIds: [...SERVICE_RELEASE_CRITICAL_CASE_IDS], executed: SERVICE_RELEASE_CRITICAL_CASE_IDS.length,
      invalidObservations: 0, failedCritical: 0, mode: "owned_runtime" } };
  return { runtime, manifest };
}
test("T94 immutable release verifier", async t => {
  await t.test("missing, malformed and unsupported assets never assert readiness", () => {
    const f = example(); for (const value of [undefined, null, {}, [], { ...f.manifest, schemaVersion: 2 }])
      assert.equal(verifyServiceReleaseManifest(value, f.runtime).kind, "unavailable");
  });
  await t.test("matching synthetic data exercises the exact verifier without asserting a real release passed", () => {
    const f = example(), result = verifyServiceReleaseManifest(f.manifest, f.runtime); assert.equal(result.kind, "verified"); if (result.kind !== "verified") assert.fail("verified fixture required");
    assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.manifest));
  });
  await t.test("unknown runtime revision and changed source or payload fail closed", () => {
    const f = example(); for (const patch of [{ sourceRevision: "unknown" }, { sourceRevision: "c".repeat(40) },
      { sourceInputSha256: "c".repeat(64) }, { apiPayloadSha256: "c".repeat(64) }])
      assert.equal(verifyServiceReleaseManifest(f.manifest, { ...f.runtime, ...patch }).kind, "unavailable");
  });
  await t.test("a supplied shorter writer list or changed emitted writer cannot authorize activation", () => {
    const f = example(); f.manifest.writers.pop(); assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
    const g = example(); g.manifest.writers[0].emittedSha256 = "c".repeat(64); assert.equal(verifyServiceReleaseManifest(g.manifest, g.runtime).kind, "unavailable");
  });
  await t.test("a shorter migration list or changed checksum fails", () => {
    const f = example(); for (const managedSchema of [[], [{ migrationId: "synthetic_schema", checksum: "c".repeat(64) }]])
      assert.equal(verifyServiceReleaseManifest({ ...f.manifest, managedSchema }, f.runtime).kind, "unavailable");
  });
  await t.test("every fixed proof must execute and pass without skips or an unapproved origin", () => {
    for (const patch of [{ executed: 0, passed: 0 }, { skipped: 1 }, { failed: 1 }, { exitCode: 1 }, { passed: 0 }, { origin: "preview" }]) {
      const f = example(); Object.assign(f.manifest.proofs[0], patch); assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
    }
    const f = example(); f.manifest.proofs.pop(); assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
  });
  await t.test("whole-file selectors and proof artifact identity cannot be shortened or borrowed", () => {
    const f = example(); f.manifest.proofs[0].files = []; assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
    const g = example(); g.manifest.proofs[0].apiPayloadSha256 = "c".repeat(64); assert.equal(verifyServiceReleaseManifest(g.manifest, g.runtime).kind, "unavailable");
  });
  await t.test("critical RAG evidence needs the exact three-business case set and actual owned-runtime mode", () => {
    for (const patch of [{ businesses: ["clinic"] }, { passedCriticalCaseIds: [] }, { failedCritical: 1 }, { invalidObservations: 1 }, { mode: "deterministic_fixture" }]) {
      const f = example(); Object.assign(f.manifest.ragEvaluation, patch); assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
    }
  });
  await t.test("duplicate proof/writer/case identities cannot replace missing evidence", () => {
    for (const field of ["writers", "proofs"] as const) { const f = example(); f.manifest[field][1] = structuredClone(f.manifest[field][0]);
      assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable"); }
    const f = example(); f.manifest.ragEvaluation.passedCriticalCaseIds[1] = f.manifest.ragEvaluation.passedCriticalCaseIds[0];
    assert.equal(verifyServiceReleaseManifest(f.manifest, f.runtime).kind, "unavailable");
  });
  await t.test("caller success flags and extra public fields are not part of the release contract", () => {
    const f = example(); for (const patch of [{ ready: true }, { writersMigrated: true }, { tenantId: "merchant" }, { source: "local_fixture" }])
      assert.equal(verifyServiceReleaseManifest({ ...f.manifest, ...patch }, f.runtime).kind, "unavailable");
  });
});
