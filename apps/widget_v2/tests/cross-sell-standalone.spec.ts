import assert from "node:assert/strict";
import test from "node:test";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";
import { standaloneCrossSellCardKey, standaloneCrossSellPrice, standaloneCrossSellSelection } from "../src/lib/cross-sell-standalone.js";

const product = { sku: "sku", variantId: "variant", suggestionId: "suggestion" };
test("standalone requests only the exact canonical SKU/variant and no guessed choices", () => {
  assert.deepEqual(standaloneCrossSellSelection(product), { sku: "sku", variant_id: "variant", quantity: 1, selected_option_item_ids: [] });
});
for (const patch of [{ sku: undefined }, { variantId: undefined }, { suggestionId: undefined }, { inStock: false },
  { optionGroups: [{ required: true }] }, { option_groups: [{ required: true }] }]) test(`standalone refuses incomplete/required selection ${Object.keys(patch)[0]}`, () => {
  assert.equal(standaloneCrossSellSelection({ ...product, ...patch }), null);
});
test("different SKUs and variants under one suggestion have distinct card identities", () => {
  assert.notEqual(standaloneCrossSellCardKey(product), standaloneCrossSellCardKey({ ...product, sku: "other" }));
  assert.notEqual(standaloneCrossSellCardKey(product), standaloneCrossSellCardKey({ ...product, variantId: "other" }));
});
for (const malformed of [null, "required", {}, [null], [{ required: "false" }]]) test(`malformed option metadata ${JSON.stringify(malformed)} never guesses a selection`, () => {
  assert.equal(standaloneCrossSellSelection(Object.assign({ ...product }, { optionGroups: malformed })), null);
});
test("displayed price comes from the exact quoted target, not the card's suggested catalog price", () => {
  const quote = normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion",
    sessionVersion: 1, contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "merchant",
      items: [{ variantId: "variant", productId: "product", sku: "sku", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }],
      originalSubtotalCents: 10000, preservedSavingsCents: 0, allocatedSavingsCents: 1000, promotionDiscountCents: 1000,
      cartDiscountCents: 0, merchandiseSubtotalCents: 9000, payableMerchandiseCents: 9000, remainingDiscountCents: 0,
      targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T00:00:00Z", acceptedQuantity: 1,
        originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000, variantId: "variant", productId: "product", sku: "sku", source: "cross_sell" }] } });
  assert.equal(standaloneCrossSellPrice(quote, standaloneCrossSellSelection(product)!), 90);
  assert.equal(standaloneCrossSellPrice(quote, { sku: "other", variant_id: "variant", quantity: 1 }), null);
  assert.equal(standaloneCrossSellPrice(quote, { sku: "sku", variant_id: "variant", quantity: 1, selected_option_item_ids: ["guessed"] }), null);
});
