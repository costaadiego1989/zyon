import assert from "node:assert/strict";
import test from "node:test";
import { nextPublicWorkVersion, publicWorkSequence, samePublicWorkContent, publicWorkRetryAt,
  ownsPublicWorkLease, type PublicWorkContent, type PublicWorkLeaseState } from "./public-source-work-state.js";
import { projectPublicBusinessSource, withdrawnPublicBusinessSource, type PublicBusinessSourceType } from "../domain/public-business-source.js";

const source: PublicWorkContent = { merchantId: "tenant-a", sourceType: "company", sourceId: "company-a", sourceHash: "a".repeat(64), publicationState: "published" };
const now = new Date("2030-01-01T12:00:00.000Z");
const lease: PublicWorkLeaseState = { merchantId: "tenant-a", id: "work-a", status: "processing", leaseToken: "owner-a", leaseExpiresAt: new Date(now.getTime() + 1000) };

test("T64", async t => {
  await t.test("missing source retirement uses the same empty public fingerprint and no invented content", () => {
    const retired = withdrawnPublicBusinessSource("tenant-a", "company", "company-a", "missing-source");
    const stored = projectPublicBusinessSource("tenant-a", { merchantId: "tenant-a", sourceType: "company", sourceId: "company-a", sourceVersion: "older",
      publicationState: "withdrawn", row: { name: "PRIVATE-CONTENT" } });
    assert.equal(retired.sourceHash, stored.sourceHash);assert.deepEqual(retired.publicData, {});assert.equal(retired.text, "");
    for (const sourceType of ["company", "business_hours", "professional", "service", "faq", "policy"] as PublicBusinessSourceType[]) {
      const item = withdrawnPublicBusinessSource("tenant-a", sourceType, "removed", "missing-source");
      assert.equal(item.sourceType, sourceType);assert.equal(item.publicationState, "withdrawn");assert.deepEqual(item.publicData, {});assert.equal(item.text, "");
    }
  });
  await t.test("canonical revisions advance independently of UUID or equal millisecond timestamps", () => {
    const first = nextPublicWorkVersion(null), second = nextPublicWorkVersion(first);
    assert.equal(first, "public-v1:00000000000000000001");assert.equal(second, "public-v1:00000000000000000002");
    assert.equal(publicWorkSequence(second), 2);assert.ok(second > first);
    assert.throws(() => nextPublicWorkVersion("legacy-opaque-uuid"), /public_work_version_invalid/);
  });
  await t.test("returning A to B to A allocates another revision rather than reopening completed work", () => {
    const a = nextPublicWorkVersion(null), b = nextPublicWorkVersion(a), again = nextPublicWorkVersion(b);
    assert.equal(publicWorkSequence(again), 3);assert.notEqual(again, a);assert.notEqual(again, b);
    assert.equal(samePublicWorkContent(source, { ...source }), true);
    assert.equal(samePublicWorkContent(source, { ...source, sourceHash: "b".repeat(64) }), false);
  });
  await t.test("revision parsing rejects malformed, zero, unsafe and exhausted counters", () => {
    for (const value of ["public-v1:1", "public-v1:00000000000000000000", "public-v1:00009007199254740992", "public-v1:0000000000000000000x", "private-error"])
      assert.throws(() => publicWorkSequence(value), /public_work_version_invalid/);
    const maximum = "public-v1:" + String(Number.MAX_SAFE_INTEGER).padStart(20, "0");
    assert.equal(publicWorkSequence(maximum), Number.MAX_SAFE_INTEGER);
    assert.throws(() => nextPublicWorkVersion(maximum), /public_work_version_exhausted/);
  });
  await t.test("dedup requires exact tenant source identity as well as current public hash and publication", () => {
    for (const change of [{ merchantId: "tenant-b" }, { sourceType: "service" }, { sourceId: "another-company" }])
      assert.throws(() => samePublicWorkContent(source, { ...source, ...change }), /public_work_scope_mismatch/);
    assert.equal(samePublicWorkContent(source, { ...source, publicationState: "withdrawn" }), false);
  });
  await t.test("retry time comes from the supplied server clock and has bounded exponential delay", () => {
    assert.equal(publicWorkRetryAt(now, 1).getTime(), now.getTime() + 1000);
    assert.equal(publicWorkRetryAt(now, 2).getTime(), now.getTime() + 2000);
    assert.equal(publicWorkRetryAt(now, 10).getTime(), now.getTime() + 300000);
    assert.equal(publicWorkRetryAt(now, 1000000).getTime(), now.getTime() + 300000);
    assert.equal(now.toISOString(), "2030-01-01T12:00:00.000Z");
    for (const attempt of [0, -1, 1.5, NaN]) assert.throws(() => publicWorkRetryAt(now, attempt), /public_work_retry_invalid/);
    assert.throws(() => publicWorkRetryAt(new Date(NaN), 1), /public_work_retry_invalid/);
  });
  await t.test("expired, foreign, terminal or replaced leases never own completion", () => {
    const claim = { merchantId: lease.merchantId, id: lease.id, leaseToken: lease.leaseToken! };
    assert.equal(ownsPublicWorkLease(lease, claim, now), true);
    for (const changed of [{ merchantId: "tenant-b" }, { id: "work-b" }, { leaseToken: "owner-b" }])
      assert.equal(ownsPublicWorkLease(lease, { ...claim, ...changed }, now), false);
    for (const row of [{ ...lease, leaseToken: null }, { ...lease, status: "completed" }, { ...lease, leaseExpiresAt: now }, { ...lease, leaseExpiresAt: null }])
      assert.equal(ownsPublicWorkLease(row, claim, now), false);
    assert.equal(ownsPublicWorkLease(lease, claim, new Date(now.getTime() + 1000)), false);
  });
});
