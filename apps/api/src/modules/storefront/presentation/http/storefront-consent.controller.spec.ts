import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { StorefrontConsentController } from "./storefront-consent.controller.js";

function harness() {
  const writes: any[] = [];
  const reads: any[] = [];
  const controller = new StorefrontConsentController({
    async replace(input: any) { writes.push(input); },
    async getGrantedChannels(input: any) { reads.push(input); return ["email"]; },
  } as never, { async getProfile(id: string) { return id === "store-1" ? { merchantId: id } : undefined; } } as never);
  return { controller, reads, writes };
}
const request = { user: { globalUserId: "buyer-1", email: "buyer@example.test", merchantId: "store-1" } };
const body = { channels: ["email"], policy_version: "storefront_privacy_2026_10_05", decided_at: new Date().toISOString() };

test("storefront contact permission is bound to the authenticated buyer and store", async () => {
  const h = harness();
  await h.controller.replace(request, "store-1", { ...body, global_user_id: "borrowed-buyer" } as never);
  assert.equal(h.writes[0].globalUserId, "buyer-1");
  assert.equal(h.writes[0].merchantId, "store-1");
  assert.equal(h.writes[0].source, "storefront_consent");
  assert.deepEqual(h.writes[0].channels, ["email"]);
  assert.equal(h.writes[0].evidence.decidedAt, body.decided_at);
  assert.ok(h.writes[0].evidence.recordedAt);
  assert.deepEqual(await h.controller.get(request, "store-1"), { success: true, channels: ["email"] });
});
test("refusal revokes both optional channels using an empty replacement", async () => {
  const h = harness();
  await h.controller.replace(request, "store-1", { ...body, channels: [] });
  assert.deepEqual(h.writes[0].channels, []);
});
test("unauthenticated, cross-store and unknown-store reads and writes are denied", async () => {
  const h = harness();
  await assert.rejects(h.controller.get({}, "store-1"), /missing_authenticated_buyer/);
  await assert.rejects(h.controller.replace({}, "store-1", body), /missing_authenticated_buyer/);
  await assert.rejects(h.controller.get(request, "store-2"), /consent_merchant_mismatch/);
  await assert.rejects(h.controller.replace(request, "store-2", body), /consent_merchant_mismatch/);
  await assert.rejects(h.controller.replace({ user: { globalUserId: "buyer-1" } }, "unknown", body), /store_not_found/);
  assert.equal(h.writes.length, 0);
});
test("invalid channels, policy versions and evidence cannot grant permission", async () => {
  const h = harness();
  for (const invalid of [{ channels: ["sms"] }, { channels: "email" }, { policy_version: "old" }, { decided_at: "yesterday" }, { decided_at: new Date(Date.now() + 120_000).toISOString() }]) {
    await assert.rejects(h.controller.replace(request, "store-1", { ...body, ...invalid }), /campaign_consent_fields_invalid/);
  }
  assert.equal(h.writes.length, 0);
});
