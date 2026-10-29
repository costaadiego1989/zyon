import test from "node:test";
import assert from "node:assert/strict";
import {
  normalCheckoutCrossSellQuoteSchema, normalCheckoutCrossSellHttpAcceptanceSchema,
  normalCheckoutCrossSellAcknowledgementSchema,
} from "@zyon/contracts";
import { normalCheckoutCrossSellQuoteSchema as backendQuote } from "./normal-checkout-cross-sell-command.schemas.js";

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

test("public/backend share the same strict quote schema including paid selections and cent arithmetic", () => {
  assert.equal(backendQuote, normalCheckoutCrossSellQuoteSchema);
  assert.deepEqual(normalCheckoutCrossSellQuoteSchema.parse(quote()), quote());
});
for (const [label, mutate] of [
  ["total", (q: ReturnType<typeof quote>) => { q.pricing.payableMerchandiseCents++; }],
  ["target price", (q: ReturnType<typeof quote>) => { q.pricing.targets[0]!.maximumUnitPriceCents++; }],
  ["target quantity", (q: ReturnType<typeof quote>) => { q.pricing.targets[0]!.acceptedQuantity++; }],
  ["target selection", (q: ReturnType<typeof quote>) => { q.pricing.targets[0]!.selectedOptionItemIds = ["small"]; }],
  ["merchant", (q: ReturnType<typeof quote>) => { q.pricing.merchantId = "other"; }],
  ["duplicate line", (q: ReturnType<typeof quote>) => { q.pricing.items.push(q.pricing.items[0]!); }],
  ["fractional cents", (q: ReturnType<typeof quote>) => { q.pricing.remainingDiscountCents = 0.5; }],
  ["unknown field", (q: ReturnType<typeof quote>) => { Object.assign(q, { trusted: true }); }],
] as const) test(`public quote refuses ${label}`, () => {
  const value = quote(); mutate(value); assert.equal(normalCheckoutCrossSellQuoteSchema.safeParse(value).success, false);
});
test("acceptance binds exact session/suggestion/SKU set and retains the displayed quote", () => {
  const value = { session_id: "session", suggestion_id: "suggestion", accepted_skus: ["sku"], expected_quote: quote() };
  assert.deepEqual(normalCheckoutCrossSellHttpAcceptanceSchema.parse(value), value);
  for (const change of [{ session_id: "other" }, { suggestion_id: "other" }, { accepted_skus: ["other"] }, { accepted_skus: ["sku", "sku"] }])
    assert.equal(normalCheckoutCrossSellHttpAcceptanceSchema.safeParse({ ...value, ...change }).success, false);
});
test("ACK is a bounded reference, not a client price or unvalidated payment capability", () => {
  const ack = { version: 1, status: "accepted", merchantId: "merchant", sessionId: "session", suggestionId: "suggestion",
    persistenceVersion: 3, quoteHash: "a".repeat(64) };
  assert.deepEqual(normalCheckoutCrossSellAcknowledgementSchema.parse(ack), ack);
  assert.equal(normalCheckoutCrossSellAcknowledgementSchema.safeParse({ ...ack, persistenceVersion: 0 }).success, false);
  assert.equal(normalCheckoutCrossSellAcknowledgementSchema.safeParse({ ...ack, price: 1 }).success, false);
});
