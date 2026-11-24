import assert from "node:assert/strict";
import test from "node:test";
import { ImmutableServiceReleaseArtifact } from "./service-release-artifact.js";
import { ownedServiceReleaseFixtureData, syntheticServiceReleaseRuntime } from "../../../tests/service-release-fixture-data.js";

test("T94 immutable datasource provider", async t => {
  await t.test("missing asset is unavailable and does not require measuring an unrelated payload", () => {
    const artifact = new ImmutableServiceReleaseArtifact({ readManifest: () => undefined, measureRuntime: () => assert.fail("missing data never authorizes readiness") });
    assert.deepEqual(artifact.read(), { kind: "unavailable", blocker: "release_manifest_missing" });
  });
  await t.test("read failures and measurement failures expose only blocker codes", () => {
    const missing = new ImmutableServiceReleaseArtifact({ readManifest: () => { throw Object.assign(new Error("private/path"), { code: "ENOENT" }); }, measureRuntime: syntheticServiceReleaseRuntime });
    assert.deepEqual(missing.read(), { kind: "unavailable", blocker: "release_manifest_missing" });
    const invalid = new ImmutableServiceReleaseArtifact({ readManifest: () => { throw Error("private/path"); }, measureRuntime: syntheticServiceReleaseRuntime });
    assert.deepEqual(invalid.read(), { kind: "unavailable", blocker: "release_manifest_invalid" });
    const changed = new ImmutableServiceReleaseArtifact({ readManifest: () => ({}), measureRuntime: () => { throw Error("private/path"); } });
    assert.deepEqual(changed.read(), { kind: "unavailable", blocker: "release_payload_changed" });
  });
  await t.test("private synthetic bytes traverse the real verifier and are frozen after the initial read", () => {
    const fixture = ownedServiceReleaseFixtureData(syntheticServiceReleaseRuntime()); let reads = 0;
    const provider = new ImmutableServiceReleaseArtifact({ readManifest: () => { reads++; return fixture.source.readManifest(); }, measureRuntime: fixture.source.measureRuntime });
    const first = provider.read(); assert.equal(first.kind, "verified"); fixture.manifest.sourceRevision = "f".repeat(40);
    assert.equal(provider.read(), first); assert.equal(reads, 1); assert.ok(Object.isFrozen(first));
    if (first.kind !== "verified") assert.fail("verified precondition required"); assert.ok(Object.isFrozen(first.manifest.writers));
  });
  await t.test("a changed measured runtime is rejected by the same provider instead of a ready boolean", () => {
    const fixture = ownedServiceReleaseFixtureData(syntheticServiceReleaseRuntime());
    const provider = new ImmutableServiceReleaseArtifact({ readManifest: fixture.source.readManifest,
      measureRuntime: () => ({ ...fixture.source.measureRuntime(), apiPayloadSha256: "f".repeat(64) }) });
    assert.deepEqual(provider.read(), { kind: "unavailable", blocker: "release_payload_changed" });
  });
});
