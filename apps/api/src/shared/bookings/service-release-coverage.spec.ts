import assert from "node:assert/strict";
import test from "node:test";
import { SERVICE_RELEASE_CHECKS, verifyServiceReleaseManifest } from "./service-release-manifest.js";
import { ownedServiceReleaseFixtureData, syntheticServiceReleaseRuntime } from "../../../tests/service-release-fixture-data.js";

// These are the four complete T72 gates in the approved task. A transport-only
// script cannot substitute for the actual canonical live observer.
const approvedRagFiles = [
  "apps/api/tests/business-rag-evaluation.spec.mjs",
  "apps/api/tests/business-rag-canonical-live-observer.spec.mjs",
  "apps/api/tests/business-rag-evaluation.truth.spec.mjs",
  "apps/api/tests/business-rag-evaluation.integration.spec.mjs",
];
test("T94 approved critical RAG evidence selection", async t => {
  await t.test("requires each original whole T72 file, including the canonical live observer", () => {
    const actual = SERVICE_RELEASE_CHECKS.find(check => check.id === "critical-rag");
    assert.ok(actual);
    assert.equal(actual.origin, "local_http_sql_redis");
    assert.deepEqual([...actual.files].sort(), [...approvedRagFiles].sort());
    assert.equal(new Set(actual.files).size, 4);
  });
  await t.test("a matching synthetic verifier precondition consumes that same full selection", () => {
    const runtime = syntheticServiceReleaseRuntime(), { manifest } = ownedServiceReleaseFixtureData(runtime);
    const proof = manifest.proofs.find(check => check.id === "critical-rag")!;
    proof.files = [...approvedRagFiles];
    assert.equal(verifyServiceReleaseManifest(manifest, runtime).kind, "verified");
  });
  await t.test("passing transport-only counters cannot replace canonical observer evidence", () => {
    const runtime = syntheticServiceReleaseRuntime(), { manifest } = ownedServiceReleaseFixtureData(runtime);
    const proof = manifest.proofs.find(check => check.id === "critical-rag")!;
    proof.files = approvedRagFiles.map(file => file.includes("canonical-live-observer")
      ? "apps/api/tests/service-served-model-script.contract.spec.mjs" : file);
    assert.deepEqual(verifyServiceReleaseManifest(manifest, runtime), { kind: "unavailable", blocker: "critical_proof_incomplete" });
  });
});
