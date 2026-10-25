import assert from "node:assert/strict";
import test from "node:test";
import {
  storefrontClaimedCartEffectRequestSchema, snapshotStorefrontClaimedCartEffectRequest,
  storefrontResolvedLocalCartItemSchema, storefrontLocalCartRuleOutcomeSchema,
  storefrontClaimedCartEffectResultSchema,
  storefrontLocalCartCommercialOutcomeV1Schema,
} from "./storefront-claimed-cart-effect.schemas.js";

const requestId = "56f51c75-e1d5-4a84-9031-e616927707a0", claimToken = "28e16d88-f9f7-4605-8f9f-88ff96eebc95";
const effectId = "a5537938-7496-4ea4-94b4-ec872a418337";
const request = () => ({ scope: { merchantId: "merchant", conversationId: "conversation", cartId: "session", principalId: "principal" },
  intent: { version: 1, message_id: "message", expected_revision: 0, command: { tool: "add_item_to_cart", args: { variantId: "variant", quantity: 1 } } },
  fingerprint: { version: 1, bytes: Uint8Array.from({ length: 32 }, () => 17) }, claim: { requestId, claimToken, claimGeneration: 1 } });
const resolved = () => ({ productId: "product", name: "Fixture", sku: "SYNTHETIC", unitPriceCents: 200 });
const commercial = () => ({ version: 1, discountCents: 500, freeShipping: false, quote: { currency: "BRL",
  originalSubtotalCents: 10000, promotionDiscountCents: 1500, subtotalCents: 8500, merchandiseTotalCents: 8000,
  items: [{ variantId: "variant", productId: "product", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 8500 }] } });

test("commercial V1 separates base, inline savings and extra cart target without altering persistence DTO", () => {
  const value = commercial(), parsed = storefrontLocalCartCommercialOutcomeV1Schema.parse(value);
  assert.deepEqual(parsed, value); parsed.quote.items[0].unitPriceCents = 1; assert.equal(value.quote.items[0].unitPriceCents, 8500);
  assert.equal(storefrontLocalCartRuleOutcomeSchema.safeParse(value).success, false);
});
for (const [name, mutate] of [
  ["version", (value: ReturnType<typeof commercial>) => { value.version = 2; }],
  ["shipping", (value: ReturnType<typeof commercial>) => { value.freeShipping = true; }],
  ["currency", (value: ReturnType<typeof commercial>) => { value.quote.currency = "USD"; }],
  ["original sum", (value: ReturnType<typeof commercial>) => { value.quote.originalSubtotalCents++; }],
  ["effective sum", (value: ReturnType<typeof commercial>) => { value.quote.subtotalCents++; }],
  ["promotion reconciliation", (value: ReturnType<typeof commercial>) => { value.quote.promotionDiscountCents++; }],
  ["net reconciliation", (value: ReturnType<typeof commercial>) => { value.quote.merchandiseTotalCents++; }],
  ["target exceeds effective", (value: ReturnType<typeof commercial>) => { value.discountCents = 9000; value.quote.merchandiseTotalCents = 0; }],
  ["price increase", (value: ReturnType<typeof commercial>) => { value.quote.items[0].unitPriceCents = 11000; }],
  ["zero quantity", (value: ReturnType<typeof commercial>) => { value.quote.items[0].quantity = 0; }],
  ["quantity100", (value: ReturnType<typeof commercial>) => { value.quote.items[0].quantity = 100; }],
  ["fractional price", (value: ReturnType<typeof commercial>) => { value.quote.items[0].unitPriceCents = 8500.5; }],
  ["empty lines", (value: ReturnType<typeof commercial>) => { value.quote.items = []; }],
  ["duplicate variants", (value: ReturnType<typeof commercial>) => { value.quote.items.push({ ...value.quote.items[0] }); }],
  ["money overflow", (value: ReturnType<typeof commercial>) => { value.quote.originalSubtotalCents = 2147483648; }],
] as const) test(`commercial V1 rejects ${name}`, () => { const value = commercial(); mutate(value); assert.equal(storefrontLocalCartCommercialOutcomeV1Schema.safeParse(value).success, false); });
for (const extra of [{ claimToken }, { costs: [1] }, { merchantPolicy: { maxDiscountPercent: 100 } }]) test(`commercial V1 rejects unknown fields ${Object.keys(extra)}`, () => {
  assert.equal(storefrontLocalCartCommercialOutcomeV1Schema.safeParse({ ...commercial(), ...extra }).success, false);
  assert.equal(storefrontLocalCartCommercialOutcomeV1Schema.safeParse({ ...commercial(), quote: { ...commercial().quote, ...extra } }).success, false);
});
test("commercial V1 notices reuse strict typed display contracts", () => {
  const value = commercial(), notice = { version: 1, code: "discount_limit_reached", message: "Synthetic notice" };
  assert.equal(storefrontLocalCartCommercialOutcomeV1Schema.safeParse({ ...value, quote: { ...value.quote, commercialNotices: [notice] } }).success, true);
  for (const invalid of [{ ...notice, code: "invented" }, { ...notice, privateCost: 123 }, { ...notice, message: " " }])
    assert.equal(storefrontLocalCartCommercialOutcomeV1Schema.safeParse({ ...value, quote: { ...value.quote, commercialNotices: [invalid] } }).success, false);
});

test("flat claimed request preserves existing scope/intent/claim contracts and quantity default", () => {
  const input = request();
  const withoutQuantity = { ...input, intent: { ...input.intent, command: { ...input.intent.command, args: { variantId: "variant" } } } };
  assert.equal(storefrontClaimedCartEffectRequestSchema.parse(withoutQuantity).intent.command.args.quantity, 1);
  assert.deepEqual(storefrontClaimedCartEffectRequestSchema.parse(input), input);
});
test("snapshot detaches Buffer backing storage and freezes every reachable request object", () => {
  const input = request(), backing = Buffer.alloc(48, 17);
  input.fingerprint.bytes = backing.subarray(8, 40);
  const snapshot = snapshotStorefrontClaimedCartEffectRequest(input);
  input.scope.merchantId = "changed"; input.intent.command.args.quantity = 99; input.claim.claimToken = effectId; backing.fill(34);
  assert.equal(snapshot.scope.merchantId, "merchant"); assert.equal(snapshot.intent.command.args.quantity, 1);
  assert.equal(snapshot.claim.claimToken, claimToken); assert.deepEqual([...snapshot.fingerprint.bytes], Array(32).fill(17));
  assert.equal(snapshot.fingerprint.bytes.constructor, Uint8Array);
  assert.notEqual(snapshot.fingerprint.bytes.buffer, backing.buffer);
  for (const object of [snapshot, snapshot.scope, snapshot.intent, snapshot.intent.command, snapshot.intent.command.args, snapshot.fingerprint, snapshot.claim])
    assert.equal(Object.isFrozen(object), true);
});
for (const input of [{ ...request(), extra: true }, { ...request(), claim: { ...request().claim, claimGeneration: 2 } },
  { ...request(), claim: { ...request().claim, requestId: "not-uuid" } }, { ...request(), fingerprint: { version: 1, bytes: new Uint8Array(15) } },
  { ...request(), scope: { ...request().scope, merchantId: "x\0y" } }, { ...request(), scope: { ...request().scope, cartId: "\ud800" } },
  { ...request(), intent: { ...request().intent, expected_revision: Number.MAX_SAFE_INTEGER + 1 } }]) {
  test(`claimed request rejects malformed envelope ${JSON.stringify(input)}`, () => assert.equal(storefrontClaimedCartEffectRequestSchema.safeParse(input).success, false));
}
test("resolver accepts only bounded trusted item fields, preserving valid identifiers without normalization", () => {
  const input = { ...resolved(), productId: " produto 😀 ", categoryId: "category", imageUrl: "https://synthetic.invalid/image" };
  assert.deepEqual(storefrontResolvedLocalCartItemSchema.parse(input), input);
  assert.equal(storefrontResolvedLocalCartItemSchema.parse({ ...resolved(), unitPriceCents: 2_147_483_647 }).unitPriceCents, 2_147_483_647);
});
for (const [field, value] of [["variantId", "variant"], ["quantity", 2], ["metadata", {}], ["selectedOptions", []], ["selectedServiceSlot", {}],
  ["marketplace", {}], ["productId", "\0"], ["productId", "\ud800"], ["categoryId", " "], ["name", ""], ["name", "n".repeat(1001)],
  ["sku", ""], ["sku", "s".repeat(192)], ["unitPriceCents", -1], ["unitPriceCents", 1.5], ["unitPriceCents", 2_147_483_648],
  ["imageUrl", ""], ["imageUrl", "u".repeat(2049)] ] as const) {
  test(`resolver rejects unsupported/out-of-range ${field}:${String(value).slice(0, 20)}`, () =>
    assert.equal(storefrontResolvedLocalCartItemSchema.safeParse({ ...resolved(), [field]: value }).success, false));
}
test("rule outcome is strict and bounded but permits zero discount/free-shipping", () => {
  assert.deepEqual(storefrontLocalCartRuleOutcomeSchema.parse({ discountCents: 0, freeShipping: true }), { discountCents: 0, freeShipping: true });
});
for (const input of [{ discountCents: -1, freeShipping: false }, { discountCents: 0.1, freeShipping: false }, { discountCents: 2_147_483_648, freeShipping: false },
  { discountCents: 0, freeShipping: "true" }, { discountCents: 0, freeShipping: false, extra: true }])
  test(`rule outcome rejects ${JSON.stringify(input)}`, () => assert.equal(storefrontLocalCartRuleOutcomeSchema.safeParse(input).success, false));
for (const kind of ["effect_recorded", "receipt_required"]) test(`strict ${kind} exposes only a minimal evidence reference`, () => {
  const input = { kind, requestId, effectId, revision: 1 };
  assert.deepEqual(storefrontClaimedCartEffectResultSchema.parse(input), input);
  for (const extra of [{ claimToken }, { cart: {} }, { fingerprint: "not-public" }, { state: "completed" }])
    assert.equal(storefrontClaimedCartEffectResultSchema.safeParse({ ...input, ...extra }).success, false);
  for (const revision of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, 1n])
    assert.equal(storefrontClaimedCartEffectResultSchema.safeParse({ ...input, revision }).success, false);
  assert.equal(storefrontClaimedCartEffectResultSchema.safeParse({ ...input, effectId: "not-uuid" }).success, false);
});
for (const kind of ["scope_unavailable", "not_current", "identity_conflict", "revision_conflict"]) test(`${kind} is kind-only`, () => {
  assert.deepEqual(storefrontClaimedCartEffectResultSchema.parse({ kind }), { kind });
  assert.equal(storefrontClaimedCartEffectResultSchema.safeParse({ kind, requestId }).success, false);
});

