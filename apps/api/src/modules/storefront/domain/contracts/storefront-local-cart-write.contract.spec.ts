import assert from "node:assert/strict";
import test from "node:test";
import { storefrontLocalCartWriteIntentSchema } from "./storefront-local-cart-write.schemas.js";
import { snapshotStorefrontWriteIdentity } from "../services/storefront-write-identity.js";
import { decideStorefrontWriteAdmission } from "../services/storefront-write-admission.js";
import { storefrontPublicReadUiActionSchema } from "./storefront-public-read-ui-action.schemas.js";

const scope = { merchantId: "merchant", conversationId: "conversation", cartId: "cart", principalId: "principal" };
const intent = { version: 1, message_id: "message", expected_revision: 2,
  command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } } };
const clone = <T>(value: T): T => structuredClone(value);
const record = (state = "processing", overrides: Record<string, unknown> = {}) => ({ scope, intent, state, ...overrides });
const admission = (overrides: Record<string, unknown> = {}) => decideStorefrontWriteAdmission({ scope, intent, currentRevision: 2, ...overrides });

test("internal add command defaults quantity without changing caller input", () => {
  const input = { ...intent, command: { tool: "add_item_to_cart", args: { variantId: "variant" } } };
  assert.deepEqual(storefrontLocalCartWriteIntentSchema.parse(input), intent);
  assert.equal(Object.hasOwn(input.command.args, "quantity"), false);
  assert.equal(storefrontPublicReadUiActionSchema.safeParse(intent.command).success, false);
});

for (const quantity of [1, 99]) test(`command accepts quantity boundary ${quantity}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, command: { ...intent.command, args: { variantId: "variant", quantity } } }).success, true);
});
for (const quantity of [0, -1, 100, 1.5, "1", null, true, NaN, Infinity]) test(`command rejects quantity ${String(quantity)}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, command: { ...intent.command, args: { variantId: "variant", quantity } } }).success, false);
});
for (const value of ["", "   ", "x".repeat(192), null, 1]) {
  for (const field of ["message_id", "variantId"]) test(`command rejects invalid ${field}: ${String(value).slice(0, 20)}`, () => {
    const input = field === "message_id" ? { ...intent, message_id: value }
      : { ...intent, command: { ...intent.command, args: { ...intent.command.args, variantId: value } } };
    assert.equal(storefrontLocalCartWriteIntentSchema.safeParse(input).success, false);
  });
}
for (const revision of [-1, 1.5, "2", null, Number.MAX_SAFE_INTEGER + 1, Infinity]) test(`command rejects revision ${revision}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, expected_revision: revision }).success, false);
});
for (const version of [0, 2, "1", null, undefined]) test(`command rejects version ${version}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, version }).success, false);
});
for (const extra of [{ price: 0 }, { merchantId: "other" }, { cartId: "other" }, { selectedOptionItemIds: [] },
  { selectedServiceSlotId: "slot" }, { crossSellPromoId: "promo" }, { couponCode: "coupon" }]) test(`command rejects extra args ${Object.keys(extra)[0]}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, command: { ...intent.command, args: { ...intent.command.args, ...extra } } }).success, false);
});
for (const extra of [{ label: "Pagar" }, { merchant_id: "other" }, { token: "synthetic" }, { channel: "other" }]) test(`command rejects envelope extra ${Object.keys(extra)[0]}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, ...extra }).success, false);
});
for (const tool of ["apply_coupon", "create_checkout_session", "add_catalog_items", "clear_cart", "get_product_details"]) test(`internal first scope rejects ${tool}`, () => {
  assert.equal(storefrontLocalCartWriteIntentSchema.safeParse({ ...intent, command: { ...intent.command, tool } }).success, false);
});

test("IDs retain exact bytes at valid boundaries; revisions accept zero and safe upper bound", () => {
  for (const expected_revision of [0, Number.MAX_SAFE_INTEGER]) {
    const input = { ...intent, message_id: "x".repeat(191), expected_revision,
      command: { ...intent.command, args: { variantId: " variante ç ", quantity: 1 } } };
    assert.deepEqual(storefrontLocalCartWriteIntentSchema.parse(JSON.parse(JSON.stringify(input))), input);
  }
});
test("identity is canonical across object order and omitted default", () => {
  const a = snapshotStorefrontWriteIdentity(scope, intent);
  const b = snapshotStorefrontWriteIdentity({ principalId: "principal", cartId: "cart", conversationId: "conversation", merchantId: "merchant" },
    { command: { args: { variantId: "variant" }, tool: "add_item_to_cart" }, expected_revision: 2, message_id: "message", version: 1 });
  assert.deepEqual(a, b);
});
test("identity is a detached frozen snapshot before an async boundary", async () => {
  const sourceScope = clone(scope); const sourceIntent = clone(intent);
  const snapshot = snapshotStorefrontWriteIdentity(sourceScope, sourceIntent);
  const before = JSON.stringify(snapshot);
  await Promise.resolve();
  sourceScope.principalId = "changed"; sourceIntent.message_id = "changed";
  sourceIntent.command.args.variantId = "changed"; sourceIntent.command.args.quantity = 9;
  assert.equal(JSON.stringify(snapshot), before);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.scope));
  assert.ok(Object.isFrozen(snapshot.intent)); assert.ok(Object.isFrozen(snapshot.intent.command));
  assert.ok(Object.isFrozen(snapshot.intent.command.args));
});
for (const field of ["merchantId", "conversationId", "cartId", "principalId"] as const) test(`identity binds scope ${field}`, () => {
  const a = snapshotStorefrontWriteIdentity(scope, intent);
  const b = snapshotStorefrontWriteIdentity({ ...scope, [field]: "changed" }, intent);
  assert.notEqual(a.canonicalMaterial, b.canonicalMaterial);
  assert.equal(a.namespaceKey === b.namespaceKey, field === "cartId" || field === "principalId");
});
test("message ID is in the namespace, not a new semantic command; JSON tuples avoid delimiter collision", () => {
  const a = snapshotStorefrontWriteIdentity(scope, intent);
  const b = snapshotStorefrontWriteIdentity(scope, { ...intent, message_id: "other" });
  assert.notEqual(a.namespaceKey, b.namespaceKey);
  assert.equal(a.canonicalMaterial, b.canonicalMaterial);
  const left = snapshotStorefrontWriteIdentity({ ...scope, merchantId: "a|b", conversationId: "c" }, intent);
  const right = snapshotStorefrontWriteIdentity({ ...scope, merchantId: "a", conversationId: "b|c" }, intent);
  assert.notEqual(left.namespaceKey, right.namespaceKey);
});
for (const state of ["processing", "unknown", "completed", "rejected", "reconciled"]) test(`same key/identity in ${state} only requires receipt, even after cart revision changes`, () => {
  assert.equal(admission({ existing: record(state), currentRevision: 8 }), "receipt_required");
});
for (const changed of [
  { ...intent, expected_revision: 3 },
  { ...intent, command: { ...intent.command, args: { ...intent.command.args, quantity: 2 } } },
  { ...intent, command: { ...intent.command, args: { ...intent.command.args, variantId: "other" } } },
]) test(`same key with changed command identity conflicts: ${JSON.stringify(changed)}`, () => {
  assert.equal(admission({ existing: record("completed", { intent: changed }) }), "identity_conflict");
});
for (const field of ["cartId", "principalId"]) test(`same key with changed ${field} conflicts, never silently rebinds`, () => {
  assert.equal(admission({ existing: record("processing", { scope: { ...scope, [field]: "other" } }) }), "identity_conflict");
});
for (const state of ["processing", "unknown"]) test(`${state} blocks a new ID, also across a principal change`, () => {
  assert.equal(admission({ active: record(state, { intent: { ...intent, message_id: "other" } }) }), "lane_blocked");
  assert.equal(admission({ active: record(state, { scope: { ...scope, principalId: "other" }, intent: { ...intent, message_id: "other" } }) }), "lane_blocked");
  assert.equal(admission({ active: record(state) }), "receipt_required");
});
for (const field of ["merchantId", "conversationId"]) test(`foreign ${field} lookup results fail closed without returning foreign state`, () => {
  assert.equal(admission({ existing: record("completed", { scope: { ...scope, [field]: "other" } }) }), "inconsistent_state");
  assert.equal(admission({ active: record("unknown", { scope: { ...scope, [field]: "other" } }) }), "inconsistent_state");
});
test("missing same-key lookup plus same active key still prevents another claim", () => {
  assert.equal(admission({ active: record("unknown", { intent: { ...intent, command: { ...intent.command, args: { variantId: "other", quantity: 1 } } } }) }), "identity_conflict");
});
test("inconsistent active and same-key state, unrelated lookup key or active cart fail closed", () => {
  assert.equal(admission({ existing: record("completed"), active: record("unknown") }), "inconsistent_state");
  assert.equal(admission({ existing: record("completed", { intent: { ...intent, message_id: "other" } }) }), "inconsistent_state");
  assert.equal(admission({ active: record("unknown", { scope: { ...scope, cartId: "other" } }) }), "inconsistent_state");
});
test("only an empty lane at matching revision requires an atomic claim; never grants execution", () => {
  assert.equal(admission(), "claim_required");
  assert.equal(admission({ currentRevision: 3 }), "revision_conflict");
  assert.equal(admission({ existing: record("completed"), active: record("unknown", { intent: { ...intent, message_id: "other" } }) }), "receipt_required");
});
for (const invalid of [{ currentRevision: "2" }, { currentRevision: -1 }, { active: record("completed") },
  { existing: record("unknown", { elapsedMs: 1e9 }) }, { execute: true }, { scope: { ...scope, token: "synthetic" } },
  { scope: { ...scope, principalId: " " } }, { intent: { ...intent, version: 2 } }]) test(`admission rejects malformed/unsupported input without time takeover: ${JSON.stringify(invalid)}`, () => {
  assert.throws(() => admission(invalid));
});

