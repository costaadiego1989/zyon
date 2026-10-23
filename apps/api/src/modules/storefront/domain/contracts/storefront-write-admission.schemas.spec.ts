import assert from "node:assert/strict";
import test from "node:test";
import { storefrontLocalCartWriteIntentSchema, storefrontWriteScopeSchema } from "./storefront-local-cart-write.schemas.js";

const load = () => import("./storefront-write-admission.schemas.js");
const scope = { merchantId: "merchant", conversationId: "conversation", cartId: "cart", principalId: "principal" };
const intent = { version: 1, message_id: "message", expected_revision: 0,
  command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } } };
const claim = { requestId: "11111111-1111-4111-8111-111111111111", claimToken: "22222222-2222-4222-8222-222222222222", claimGeneration: 1 };
const request = () => ({ scope: { ...scope }, intent: structuredClone(intent), fingerprint: { version: 1, bytes: Uint8Array.from({ length: 16 }, (_, index) => index) } });

for (const bad of ["bad\0id", "bad\ud800", "\udc00bad", "\ud800x\udc00", "\udc00\udc00"]) {
  for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const) test(`internal scope rejects SQL-incompatible ${field} ${JSON.stringify(bad)}`, () => {
    assert.equal(storefrontWriteScopeSchema.safeParse({ ...scope, [field]: bad }).success, false);
  });
  for (const field of ["message_id", "variantId"] as const) test(`internal intent rejects SQL-incompatible ${field} ${JSON.stringify(bad)}`, () => {
    const value = field === "message_id" ? { ...intent, message_id: bad }
      : { ...intent, command: { ...intent.command, args: { ...intent.command.args, variantId: bad } } };
    assert.equal(storefrontLocalCartWriteIntentSchema.safeParse(value).success, false);
  });
}

test("valid Unicode and significant surrounding spaces are preserved, never normalized", () => {
  const id = "  variação e\u0301 🛒 \ufffd  ";
  assert.equal(storefrontWriteScopeSchema.parse({ ...scope, merchantId: id }).merchantId, id);
  assert.equal(storefrontLocalCartWriteIntentSchema.parse({ ...intent, message_id: id }).message_id, id);
});

test("admission snapshot is detached before awaits, including pooled Buffer backing memory and omitted quantity", async () => {
  const { snapshotStorefrontWriteAdmissionRequest } = await load();
  const bytes = Buffer.alloc(48, 7).subarray(8, 40);
  const source = { ...request(), intent: { ...intent, command: { tool: "add_item_to_cart", args: { variantId: "variant" } } }, fingerprint: { version: 2, bytes } };
  const snapshot = snapshotStorefrontWriteAdmissionRequest(source);
  await Promise.resolve();
  source.scope.principalId = "changed";
  source.intent.command.args.variantId = "changed";
  source.fingerprint.version = 3;
  bytes.fill(99);
  assert.deepEqual(snapshot.scope, scope);
  assert.deepEqual(snapshot.intent, intent);
  assert.equal(snapshot.fingerprint.version, 2);
  assert.deepEqual([...snapshot.fingerprint.bytes], Array(32).fill(7));
  assert.notEqual(snapshot.fingerprint.bytes.buffer, bytes.buffer);
  assert.equal(Buffer.isBuffer(snapshot.fingerprint.bytes), false);
  assert.equal(Object.hasOwn(source.intent.command.args, "quantity"), false);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.scope));
  assert.ok(Object.isFrozen(snapshot.intent));
  assert.ok(Object.isFrozen(snapshot.intent.command));
  assert.ok(Object.isFrozen(snapshot.intent.command.args));
  assert.ok(Object.isFrozen(snapshot.fingerprint));
});

for (const length of [16, 128]) test(`fingerprint accepts opaque Uint8Array length ${length}`, async () => {
  const { storefrontWriteAdmissionRequestSchema } = await load();
  for (const version of [1, 32767]) assert.equal(storefrontWriteAdmissionRequestSchema.safeParse({ ...request(), fingerprint: { version, bytes: new Uint8Array(length) } }).success, true);
});
for (const bytes of [new Uint8Array(15), new Uint8Array(129), [1, 2], "opaque", new Uint16Array(16), new DataView(new ArrayBuffer(16)), null]) {
  test(`fingerprint rejects invalid bytes ${Object.prototype.toString.call(bytes)} ${bytes?.constructor?.name}`, async () => {
    const { storefrontWriteAdmissionRequestSchema } = await load();
    assert.equal(storefrontWriteAdmissionRequestSchema.safeParse({ ...request(), fingerprint: { version: 1, bytes } }).success, false);
  });
}
for (const version of [0, 32768, 1.5, "1", null, undefined, NaN, Infinity]) test(`fingerprint version rejects ${String(version)}`, async () => {
  const { storefrontWriteAdmissionRequestSchema } = await load();
  assert.equal(storefrontWriteAdmissionRequestSchema.safeParse({ ...request(), fingerprint: { version, bytes: new Uint8Array(16) } }).success, false);
});
for (const value of [
  { ...request(), execute: true },
  { ...request(), scope: { ...scope, token: "not-a-token" } },
  { ...request(), fingerprint: { version: 1, bytes: new Uint8Array(16), algorithm: "not-selected" } },
  { ...request(), intent: { ...intent, command: { ...intent.command, args: { ...intent.command.args, price: 0 } } } },
]) test(`admission rejects authority or algorithm extra ${JSON.stringify(value)}`, async () => {
  const { storefrontWriteAdmissionRequestSchema } = await load();
  assert.equal(storefrontWriteAdmissionRequestSchema.safeParse(value).success, false);
});

for (const kind of ["identity_conflict", "lane_blocked", "revision_conflict", "scope_unavailable"] as const) {
  test(`kind-only ${kind} result is strict and cannot leak internal data`, async () => {
    const { storefrontWriteAdmissionResultSchema } = await load();
    assert.deepEqual(storefrontWriteAdmissionResultSchema.parse({ kind }), { kind });
    for (const extra of [{ requestId: claim.requestId }, { claim }, { fingerprint: request().fingerprint }, { principalId: "private" }]) {
      assert.equal(storefrontWriteAdmissionResultSchema.safeParse({ kind, ...extra }).success, false);
    }
  });
}
test("claimed result contains only fresh claim UUIDs and generation one", async () => {
  const { storefrontWriteAdmissionResultSchema } = await load();
  assert.deepEqual(storefrontWriteAdmissionResultSchema.parse({ kind: "claimed", claim }), { kind: "claimed", claim });
  for (const changed of [{ ...claim, requestId: "not-uuid" }, { ...claim, claimToken: "not-uuid" },
    { ...claim, claimGeneration: 2 }, { ...claim, claimGeneration: "1" }, { ...claim, bytes: new Uint8Array(16) }]) {
    assert.equal(storefrontWriteAdmissionResultSchema.safeParse({ kind: "claimed", claim: changed }).success, false);
  }
});
test("duplicate receipt exposes no claim capability and only processing or unknown state", async () => {
  const { storefrontWriteAdmissionResultSchema } = await load();
  for (const state of ["processing", "unknown"]) assert.deepEqual(storefrontWriteAdmissionResultSchema.parse({ kind: "receipt_required", requestId: claim.requestId, state }), { kind: "receipt_required", requestId: claim.requestId, state });
  for (const state of ["completed", "rejected", "reconciled", "expired", "Processing"]) {
    assert.equal(storefrontWriteAdmissionResultSchema.safeParse({ kind: "receipt_required", requestId: claim.requestId, state }).success, false);
  }
  assert.equal(storefrontWriteAdmissionResultSchema.safeParse({ kind: "receipt_required", requestId: claim.requestId, state: "processing", claimToken: claim.claimToken }).success, false);
  assert.equal(storefrontWriteAdmissionResultSchema.safeParse({ kind: "completed" }).success, false);
});
test("markUnknown input snapshots scope and capability; its only results do not release the lane", async () => {
  const { snapshotStorefrontWriteMarkUnknownRequest, storefrontWriteMarkUnknownRequestSchema, storefrontWriteMarkUnknownResultSchema } = await load();
  const source = { scope: { ...scope }, claim: { ...claim } };
  const snapshot = snapshotStorefrontWriteMarkUnknownRequest(source);
  await Promise.resolve();
  source.scope.principalId = "changed";
  source.claim.claimToken = "changed";
  assert.deepEqual(snapshot, { scope, claim });
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.scope));
  assert.ok(Object.isFrozen(snapshot.claim));
  assert.equal(storefrontWriteMarkUnknownRequestSchema.safeParse({ scope, claim, release: true }).success, false);
  for (const kind of ["marked_unknown", "not_current"]) assert.deepEqual(storefrontWriteMarkUnknownResultSchema.parse({ kind }), { kind });
  assert.equal(storefrontWriteMarkUnknownResultSchema.safeParse({ kind: "marked_unknown", claim }).success, false);
  assert.equal(storefrontWriteMarkUnknownResultSchema.safeParse({ kind: "released" }).success, false);
});

