import assert from "node:assert/strict";
import test from "node:test";
import { storefrontWriteStateRequestSchema, snapshotStorefrontWriteStateRequest, storefrontWriteStateResultSchema } from "./storefront-write-state.schemas.js";

const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0", effectId = "a5537938-7496-4ea4-94b4-ec872a418337";
const scope = () => ({ merchantId: "merchant", conversationId: "conversation", cartId: "session", principalId: "principal" });
const result = () => ({ kind: "state", revision: 1, request: { requestId, messageId: "message", protocolVersion: 1,
  expectedRevision: 0, state: "processing", effect: { effectId, revision: 1 } } });
test("state request contains only full server-verified scope, no hash, claim or intent", () => {
  assert.deepEqual(storefrontWriteStateRequestSchema.parse({ scope: scope() }), { scope: scope() });
  for (const extra of [{ fingerprint: new Uint8Array(32) }, { claimToken: requestId }, { messageId: "message" }, { intent: {} }, { extra: true }])
    assert.equal(storefrontWriteStateRequestSchema.safeParse({ scope: scope(), ...extra }).success, false);
});
test("state input snapshot is detached/frozen and preserves valid identifiers without normalization", () => {
  const input = { scope: { ...scope(), merchantId: " merchant 😀 " } }, snapshot = snapshotStorefrontWriteStateRequest(input);
  input.scope.merchantId = "changed";
  assert.equal(snapshot.scope.merchantId, " merchant 😀 "); assert.equal(Object.isFrozen(snapshot), true); assert.equal(Object.isFrozen(snapshot.scope), true);
});
for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const)
  for (const value of ["", " ", "x\0y", "\ud800", "\udc00", "x".repeat(192)]) test(`invalid state scope ${field}/${JSON.stringify(value)}`, () => {
    assert.equal(storefrontWriteStateRequestSchema.safeParse({ scope: { ...scope(), [field]: value } }).success, false);
  });
test("state request rejects unknown or missing scope fields", () => {
  assert.equal(storefrontWriteStateRequestSchema.safeParse({ scope: { ...scope(), extra: true } }).success, false);
  assert.equal(storefrontWriteStateRequestSchema.safeParse({ scope: { merchantId: "merchant" } }).success, false);
});
for (const state of ["processing", "unknown"]) for (const hasEffect of [false, true]) test(`${state} state ${hasEffect ? "with" : "without"} effect is observation, not completion`, () => {
  const value = result(); value.request.state = state;
  const input = { ...value, revision: hasEffect ? 1 : 0, request: { ...value.request, effect: hasEffect ? value.request.effect : null } };
  assert.deepEqual(storefrontWriteStateResultSchema.parse(input), input);
});
test("unavailable and absent request variants expose no permission or synthetic completion", () => {
  assert.deepEqual(storefrontWriteStateResultSchema.parse({ kind: "scope_unavailable" }), { kind: "scope_unavailable" });
  assert.deepEqual(storefrontWriteStateResultSchema.parse({ kind: "state", revision: 0, request: null }), { kind: "state", revision: 0, request: null });
  assert.equal(storefrontWriteStateResultSchema.safeParse({ kind: "scope_unavailable", requestId }).success, false);
  for (const kind of ["completed", "rejected", "reconciled", "execute", "retry", "claimed"])
    assert.equal(storefrontWriteStateResultSchema.safeParse({ kind }).success, false);
});
for (const revision of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, 1n, "1", NaN, Infinity]) test(`invalid result anchor revision ${String(revision)}`, () => {
  assert.equal(storefrontWriteStateResultSchema.safeParse({ ...result(), revision }).success, false);
});
for (const revision of [0, -1, 0.1, Number.MAX_SAFE_INTEGER + 1, 1n]) test(`invalid effect reference revision ${String(revision)}`, () => {
  const value = result(); assert.equal(storefrontWriteStateResultSchema.safeParse({ ...value, request: { ...value.request, effect: { effectId, revision } } }).success, false);
});
for (const patch of [{ requestId: "bad" }, { messageId: "x\0y" }, { messageId: "\ud800" }, { protocolVersion: 0 }, { protocolVersion: 32768 },
  { expectedRevision: -1 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { state: "completed" }, { state: "rejected" },
  { claimToken: requestId }, { fingerprint: new Uint8Array(32) }, { commandKind: "add_item_to_cart" }, { claimGeneration: 1 }]) test(`strict request projection ${Object.keys(patch)[0]}:${String(Object.values(patch)[0])}`, () => {
  const value = result(); assert.equal(storefrontWriteStateResultSchema.safeParse({ ...value, request: { ...value.request, ...patch } }).success, false);
});
for (const patch of [{ effectId: "bad" }, { claimToken: requestId }, { cartRowId: "cart" }, { requestId }, { beforeRevision: 0 }]) test(`strict effect projection ${Object.keys(patch)[0]}`, () => {
  const value = result(); assert.equal(storefrontWriteStateResultSchema.safeParse({ ...value, request: { ...value.request, effect: { ...value.request.effect, ...patch } } }).success, false);
});
test("optional-looking state keys are required; raw payloads or error causes cannot escape", () => {
  assert.equal(storefrontWriteStateResultSchema.safeParse({ kind: "state", revision: 0 }).success, false);
  const value = result(), { effect: _effect, ...withoutEffect } = value.request;
  assert.equal(storefrontWriteStateResultSchema.safeParse({ ...value, request: withoutEffect }).success, false);
  for (const extra of [{ fingerprint: "secret" }, { claimToken: requestId }, { cart: {} }, { cause: "private-error" }])
    assert.equal(storefrontWriteStateResultSchema.safeParse({ ...value, ...extra }).success, false);
});

