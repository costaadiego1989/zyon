import assert from "node:assert/strict";
import test from "node:test";
import { normalCheckoutCrossSellLegacyEventFields } from "./normal-checkout-cross-sell-event.js";

const quote = { sessionId: "session", suggestionId: "suggestion", pricing: { targets: [
  { promotionId: "promo", sku: "B", originalUnitPriceCents: 5500, maximumUnitPriceCents: 4950, acceptedQuantity: 1 },
  { promotionId: "promo", sku: "A", originalUnitPriceCents: 1500, maximumUnitPriceCents: 1350, acceptedQuantity: 2 },
] } };

test("normal accepted event preserves legacy v1 fields with the effective paid-option discount", () => {
  assert.deepEqual(normalCheckoutCrossSellLegacyEventFields(quote), { session_id: "session", suggestion_id: "suggestion",
    promo_id: "promo", accepted_skus: ["A", "B"], computed_discount: 10 });
});
test("same SKU in different option lines is reported once and priced by actual quantities", () => {
  const sameSku = structuredClone(quote); sameSku.pricing.targets[1]!.sku = "B";
  sameSku.pricing.targets[1]!.maximumUnitPriceCents = 1500;
  assert.deepEqual(normalCheckoutCrossSellLegacyEventFields(sameSku).accepted_skus, ["B"]);
  assert.equal(normalCheckoutCrossSellLegacyEventFields(sameSku).computed_discount, 6.4705);
});
test("event metadata does not mutate the authoritative quote or expose private evidence", () => {
  const before = structuredClone(quote), event = normalCheckoutCrossSellLegacyEventFields(quote);
  assert.deepEqual(quote, before);
  assert.deepEqual(Object.keys(event).sort(), ["session_id", "suggestion_id", "promo_id", "accepted_skus", "computed_discount"].sort());
});
for (const malformed of [
  { ...quote, pricing: { targets: [] } },
  { ...quote, pricing: { targets: [{ ...quote.pricing.targets[0]!, promotionId: "other" }, quote.pricing.targets[1]!] } },
  { ...quote, pricing: { targets: [{ ...quote.pricing.targets[0]!, originalUnitPriceCents: 0 }] } },
  { ...quote, pricing: { targets: [{ ...quote.pricing.targets[0]!, maximumUnitPriceCents: -1 }] } },
  { ...quote, pricing: { targets: [{ ...quote.pricing.targets[0]!, acceptedQuantity: 0 }] } },
  { ...quote, pricing: { targets: [{ ...quote.pricing.targets[0]!, maximumUnitPriceCents: 5501 }] } },
]) test("malformed or mixed-promotion event input cannot produce compatibility metadata", () => {
  assert.throws(() => normalCheckoutCrossSellLegacyEventFields(malformed), /normal_cross_sell_event_invalid/);
});
