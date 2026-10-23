import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { WidgetCrossSellController } from "./widget-cross-sell.controller.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "../../../embed/presentation/http/embed-scope.decorator.js";

// Narrow application doubles: validates routing only, not JWT/origin or SQL.
function fixture() {
  const calls: Array<{ op: string; args: unknown[] }> = [];
  const normal = { async quote(...args: unknown[]) { calls.push({ op: "quote", args }); return "quoted"; },
    async accept(...args: unknown[]) { calls.push({ op: "accept", args }); return "accepted"; } };
  const legacy = { async execute(...args: unknown[]) { calls.push({ op: "legacy", args }); return "legacy"; } };
  const guards = { async assertSessionBelongsToEmbedMerchant(...args: unknown[]) { calls.push({ op: "scope", args });
    if (args[1] !== "session") throw new Error("signed_session_mismatch"); } };
  const controller: WidgetCrossSellController = Reflect.construct(WidgetCrossSellController, [{}, legacy, {}, guards, normal]);
  const request = { embedClaims: { merchantId: "merchant", sessionId: "session" } };
  return { calls, normal, controller, request };
}
const body = () => ({ session_id: "session", suggestion_id: "suggestion", accepted_skus: ["SKU"] });
const displayedQuote = () => ({ version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion", sessionVersion: 0,
  contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "merchant",
    items: [{ variantId: "variant", productId: "product", sku: "SKU", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }],
    originalSubtotalCents: 10000, preservedSavingsCents: 0, allocatedSavingsCents: 1000, promotionDiscountCents: 1000,
    cartDiscountCents: 0, merchandiseSubtotalCents: 9000, payableMerchandiseCents: 9000, remainingDiscountCents: 0,
    targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T00:00:00Z", acceptedQuantity: 1,
      originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000, variantId: "variant", productId: "product", sku: "SKU", source: "cross_sell" }] } });

test("quote is protected by mandatory transactional scope and delegates only authenticated principal", async () => {
  const f = fixture();
  assert.equal(Reflect.getMetadata(EMBED_REQUIRED_SCOPE_KEY, f.controller.quote), "offers:apply");
  assert.equal(await f.controller.quote(f.request as never, { session_id: "session", suggestion_id: "suggestion",
    targets: [{ sku: "SKU", variant_id: "variant", quantity: 1 }] }), "quoted");
  assert.deepEqual(f.calls.map(call => call.op), ["scope", "quote"]);
  assert.deepEqual(f.calls[1]!.args, [{ merchantId: "merchant", sessionId: "session" },
    { suggestion_id: "suggestion", targets: [{ sku: "SKU", variant_id: "variant", quantity: 1 }] }]);
});
test("accept legacy retains the guarded use case but now requires transactional scope", async () => {
  const f = fixture();
  assert.equal(Reflect.getMetadata(EMBED_REQUIRED_SCOPE_KEY, f.controller.acceptSuggestion), "offers:apply");
  assert.equal(await f.controller.acceptSuggestion(f.request as never, body()), "legacy");
  assert.deepEqual(f.calls.map(call => call.op), ["scope", "legacy"]);
});
test("displayed quote acceptance dispatches once to normal writer and NEVER legacy add/save path", async () => {
  const f = fixture(), expected_quote = displayedQuote();
  assert.equal(await f.controller.acceptSuggestion(f.request as never, { ...body(), expected_quote }), "accepted");
  assert.deepEqual(f.calls.map(call => call.op), ["scope", "accept"]);
  assert.deepEqual(f.calls[1]!.args, [{ merchantId: "merchant", sessionId: "session" },
    { suggestion_id: "suggestion", accepted_skus: ["SKU"], expected_quote }]);
});
for (const extra of [{ merchantId: "attacker" }, { buyer_id: "forged" }, { authorized: true }]) {
  test(`quote rejects unknown principal ${Object.keys(extra)[0]} before scope/writer dispatch`, async () => {
    const f = fixture();
    await assert.rejects(f.controller.quote(f.request as never, { session_id: "session", suggestion_id: "suggestion",
      targets: [{ sku: "SKU", variant_id: "variant", quantity: 1 }], ...extra }));
    assert.deepEqual(f.calls, []);
  });
}
for (const extra of [{ merchant_id: "attacker" }, { buyer_id: "forged" }, { authorized: true }, { expected_quote: null }]) {
  test(`strict accept rejects unknown authority/malformed quote ${Object.keys(extra)[0]} before dispatch`, async () => {
    const f = fixture();
    await assert.rejects(f.controller.acceptSuggestion(f.request as never, { ...body(), ...extra }), error =>
      typeof error === "object" && error !== null && "getStatus" in error && (error as {getStatus():number}).getStatus() === 400);
    assert.equal(f.calls.length, 0);
  });
}
test("signed session mismatch is preserved and prevents legacy dispatch", async () => {
  const f = fixture();
  await assert.rejects(f.controller.acceptSuggestion(f.request as never, { ...body(), session_id: "other" }), /signed_session_mismatch/);
  assert.deepEqual(f.calls.map(call => call.op), ["scope"]);
});
