import assert from "node:assert/strict";
import test from "node:test";
import { ImmutableServiceReleaseArtifact } from "../../../shared/bookings/service-release-artifact.js";
import { serviceActivationReadinessWithin } from "../../../shared/bookings/service-activation-readiness.js";
import { ownedServiceReleaseFixtureData, syntheticServiceReleaseRuntime } from "../../../../tests/service-release-fixture-data.js";

function example() {
  const runtime = syntheticServiceReleaseRuntime(), data = ownedServiceReleaseFixtureData(runtime), artifact = new ImmutableServiceReleaseArtifact(data.source);
  const merchant = { businessMode: "services" as "products" | "services", businessModeSelectedAt: new Date("2030-01-01"), businessModeNeedsReview: false };
  const policy = { admissionsEnabled: false, holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", version: 3, configuredAt: new Date("2030-01-01") };
  let unresolved = false, ledger = runtime.managedSchema.map(value => ({ migration_name: value.migrationId, checksum: value.checksum }));
  const tx: any = { merchant: { findUnique: async (input: any) => { assert.equal(input.where.id, "merchant"); return merchant; } },
    serviceBusinessPolicy: { findUnique: async (input: any) => { assert.equal(input.where.merchantId, "merchant"); return policy; } },
    serviceReservation: { findFirst: async (input: any) => { assert.equal(input.where.merchantId, "merchant"); return unresolved ? { id: "unresolved" } : null; } },
    $queryRaw: async () => ledger };
  return { data, artifact, tx, merchant, policy, missingMapping: () => { unresolved = true; }, missingLedger: () => { ledger = []; } };
}
test("T94", async t => {
  await t.test("a valid verifier precondition and actual same-transaction tenant facts can be ready for activation", async () => {
    const f = example(), result = await serviceActivationReadinessWithin(f.tx, "merchant", undefined, f.artifact);
    assert.deepEqual(result, { ready: true, blockers: [], policyVersion: 3 }); assert.equal(f.policy.admissionsEnabled, false);
  });
  await t.test("products never activate even with a complete release fixture", async () => {
    const f = example(); f.merchant.businessMode = "products"; const result = await serviceActivationReadinessWithin(f.tx, "merchant", undefined, f.artifact);
    assert.equal(result.ready, false); assert.ok(result.blockers.includes("products_mode"));
  });
  await t.test("unclassified company, missing policy, mapping and migration evidence independently block", async () => {
    for (const reason of ["classification", "policy", "mapping", "migration"]) {
      const f = example(); if (reason === "classification") f.merchant.businessModeNeedsReview = true;
      if (reason === "policy") f.policy.configuredAt = null as any; if (reason === "mapping") f.missingMapping(); if (reason === "migration") f.missingLedger();
      assert.equal((await serviceActivationReadinessWithin(f.tx, "merchant", undefined, f.artifact)).ready, false);
    }
  });
  await t.test("missing or mismatched release evidence does not gain readiness from valid policy", async () => {
    for (const source of [{ readManifest: () => undefined, measureRuntime: syntheticServiceReleaseRuntime },
      { readManifest: () => example().data.manifest, measureRuntime: () => ({ ...syntheticServiceReleaseRuntime(), sourceRevision: "f".repeat(40) }) }]) {
      const f = example(), result = await serviceActivationReadinessWithin(f.tx, "merchant", undefined, new ImmutableServiceReleaseArtifact(source));
      assert.equal(result.ready, false); assert.ok(result.blockers.some(value => value.startsWith("release_")));
    }
  });
  await t.test("a root/autocommit client or a boolean reader cannot replace the private transaction/verifier", async () => {
    const f = example(); await assert.rejects(serviceActivationReadinessWithin({ ...f.tx, $transaction() {} }, "merchant", undefined, f.artifact), /transaction_required/);
    await assert.rejects(serviceActivationReadinessWithin(f.tx, "merchant", undefined, { read: () => ({ kind: "verified" }) } as any), /release_source_required/);
  });
  await t.test("result exposes only bounded blocker codes and policy version, never release files or proof data", async () => {
    const f = example(); f.missingLedger(); const result = await serviceActivationReadinessWithin(f.tx, "merchant", undefined, f.artifact);
    assert.deepEqual(Object.keys(result).sort(), ["ready", "blockers", "policyVersion"].sort()); assert.deepEqual(result.blockers, ["migration_incompatible"]);
    assert.equal(JSON.stringify(result).includes("synthetic_owned"), false);
  });
});
