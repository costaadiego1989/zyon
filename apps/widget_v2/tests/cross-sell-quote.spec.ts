import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const quote = () => ({ version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion",
  sessionVersion: 2, contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: {
    kind: "quote_candidate", version: 1, merchantId: "merchant",
    targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 2,
      originalUnitPriceCents: 2500, maximumUnitPriceCents: 2250, selectedOptionItemIds: ["large"],
      variantId: "variant", productId: "product", sku: "sku", source: "cross_sell" }],
    items: [{ variantId: "variant", productId: "product", sku: "sku", quantity: 2, baseUnitPriceCents: 2500,
      unitPriceCents: 2250, selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 }] }],
    originalSubtotalCents: 5000, preservedSavingsCents: 0, allocatedSavingsCents: 500, promotionDiscountCents: 500,
    cartDiscountCents: 0, merchandiseSubtotalCents: 4500, payableMerchandiseCents: 4500, remainingDiscountCents: 500,
  } });
const target = { sku: "sku", variant_id: "variant", quantity: 2, selected_option_item_ids: ["large"] };
async function fixture(response: unknown, status = 200) {
  const calls: { path: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    assert.equal(new URL(String(input)).origin, "https://fixture.invalid");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer signed");
    calls.push({ path, body: JSON.parse(String(init?.body)) });
    if (path === "/embed/start") return Response.json({ session_id: "session", experience: { items: [], totals: { subtotal: 0, discount: 0, total: 0 } } });
    return Response.json(response, { status });
  };
  const api = new CheckoutSession({ merchantId: "merchant", embedToken: "signed", apiBaseUrl: "https://fixture.invalid" });
  await api.start(); return { api, calls };
}
test("read-only quote sends only signed scope and exact explicit selections, without changing cart", async () => {
  const { api, calls } = await fixture(quote()), before = await api.fetchCart();
  assert.deepEqual(await api.quoteCrossSell("suggestion", [target]), quote());
  assert.deepEqual(calls[1], { path: "/embed/cross-sell/quote", body: { session_id: "session", suggestion_id: "suggestion", targets: [target] } });
  assert.deepEqual(await api.fetchCart(), before); assert.equal(calls.length, 2);
});
for (const field of ["merchantId", "sessionId", "suggestionId"] as const) test(`quote refuses mismatched ${field}`, async () => {
  const { api } = await fixture({ ...quote(), [field]: "other" });
  await assert.rejects(api.quoteCrossSell("suggestion", [target]), /cross_sell_quote_invalid/);
});
test("quote refuses a different selection or quantity even if monetary output is coherent", async () => {
  const { api } = await fixture(quote());
  await assert.rejects(api.quoteCrossSell("suggestion", [{ ...target, quantity: 1 }]), /cross_sell_quote_invalid/);
  await assert.rejects(api.quoteCrossSell("suggestion", [{ ...target, selected_option_item_ids: ["small"] }]), /cross_sell_quote_invalid/);
});
test("invalid quote input dispatches no request; failure does not trigger alternate operations", async () => {
  const { api, calls } = await fixture(quote());
  await assert.rejects(api.quoteCrossSell("suggestion", [{ ...target, quantity: 0 }]));
  assert.equal(calls.length, 1);
});
test("quote is not retried or converted into an accept on server refusal", async () => {
  const { api, calls } = await fixture({ code: "cross_sell_quote_review_required" }, 422);
  await assert.rejects(api.quoteCrossSell("suggestion", [target]));
  assert.equal(calls.length, 2); assert.equal(calls[1]!.path, "/embed/cross-sell/quote");
});
