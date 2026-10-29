import assert from "node:assert/strict";
import test from "node:test";
import { crossSellStorefrontQuoteRequestSchema, crossSellStorefrontQuoteSchema, crossSellStorefrontAcceptanceSchema,
  crossSellAcceptedLineIntentSchema, crossSellStorefrontAcknowledgementSchema } from "./cross-sell-storefront-quote.schemas.js";

const basis = () => ({ items: [{ variantId: "host", productId: "host-product", name: "Host", sku: "HOST", quantity: 1, unitPriceCents: 10000 }],
  total: 10000, discount: 0, couponCode: null, freeShipping: false });
const quote = () => ({ version: 1, merchantId: "merchant", cartId: "cart", variantId: "target", productId: "target-product", sku: "TARGET",
  promotionId: "promo", promotionUpdatedAt: "2026-10-18T00:00:00.000Z", quantity: 1, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000,
  cartBasis: basis(), quote: { currency: "BRL", originalSubtotalCents: 20000, promotionDiscountCents: 1000, subtotalCents: 19000,
    merchandiseTotalCents: 19000, items: [{ variantId: "host", productId: "host-product", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 10000 },
      { variantId: "target", productId: "target-product", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } });

test("storefront cross-sell request is strict IDs plus bounded quantity, never client price authority", () => {
  assert.deepEqual(crossSellStorefrontQuoteRequestSchema.parse({ variantId: "target", promotionId: "promo", quantity: 1 }),
    { variantId: "target", promotionId: "promo", quantity: 1 });
  for (const quantity of [0, 100, 1.5, "1"]) assert.equal(crossSellStorefrontQuoteRequestSchema.safeParse({ variantId: "target", promotionId: "promo", quantity }).success, false);
  assert.equal(crossSellStorefrontQuoteRequestSchema.safeParse({ variantId: "target", promotionId: "promo", quantity: 1, unitPriceCents: 1 }).success, false);
});
test("strict visible quote is detached and acceptance requires the exact echoed version", () => {
  const original = quote(), parsed = crossSellStorefrontQuoteSchema.parse(original);
  assert.deepEqual(parsed, original); original.cartBasis.items[0].unitPriceCents = 1; assert.equal(parsed.cartBasis.total, 10000);
  assert.deepEqual(crossSellStorefrontAcceptanceSchema.parse({ expectedQuote: parsed }), { expectedQuote: parsed });
  assert.equal(crossSellStorefrontAcceptanceSchema.safeParse({ promotionId: "promo" }).success, false);
});
for (const mutate of [
  (q: ReturnType<typeof quote>) => { q.maximumUnitPriceCents = 10001; },
  (q: ReturnType<typeof quote>) => { q.quote.items[1].unitPriceCents = 9100; },
  (q: ReturnType<typeof quote>) => { q.quote.items[1].quantity = 2; },
  (q: ReturnType<typeof quote>) => { q.quote.promotionDiscountCents = 1001; },
  (q: ReturnType<typeof quote>) => { q.cartBasis.total = 10001; },
  (q: ReturnType<typeof quote>) => { q.quote.items[0].variantId = "target"; },
]) test(`storefront quote rejects inconsistent target/basis/money ${mutate.toString()}`, () => {
  const value = quote(); mutate(value); assert.equal(crossSellStorefrontQuoteSchema.safeParse(value).success, false);
});
for (const field of ["cost", "merchantRules", "claimToken", "discountBudget", "signature"]) test(`quote rejects private/invented field ${field}`, () => {
  assert.equal(crossSellStorefrontQuoteSchema.safeParse({ ...quote(), [field]: 1 }).success, false);
  assert.equal(crossSellStorefrontQuoteSchema.safeParse({ ...quote(), cartBasis: { ...basis(), [field]: 1 } }).success, false);
});
test("accepted line JSON records only bounded version/base/quantity/maximum, never a grant", () => {
  const value = { version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-18T00:00:00.000Z",
    acceptedQuantity: 2, originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 };
  assert.deepEqual(crossSellAcceptedLineIntentSchema.parse(value), value);
  for (const bad of [{ ...value, maximumUnitPriceCents: 10001 }, { ...value, cost: 1 }, { ...value, version: 2 }])
    assert.equal(crossSellAcceptedLineIntentSchema.safeParse(bad).success, false);
});
test("post-commit acknowledgement is strict version/status/scoped IDs only", () => {
  const ack = { version: 1, status: "accepted", merchantId: "merchant", cartId: "cart" };
  assert.deepEqual(crossSellStorefrontAcknowledgementSchema.parse(ack), ack);
  for (const bad of [{ ...ack, status: "pending" }, { ...ack, claimToken: "private" }, { ...ack, merchantId: "" }, { ...ack, version: 2 }])
    assert.equal(crossSellStorefrontAcknowledgementSchema.safeParse(bad).success, false);
});

test("quote selection supports only bounded explicit unique option IDs, never modifier prices", () => {
  const selection = { variantId: "target", promotionId: "promo", quantity: 1, selectedOptionItemIds: ["size", "color"] };
  assert.deepEqual(crossSellStorefrontQuoteRequestSchema.parse(selection), selection);
  for (const ids of [["size", "size"], [""], Array.from({ length: 251 }, (_, index) => `item-${index}`), "size"])
    assert.equal(crossSellStorefrontQuoteRequestSchema.safeParse({ ...selection, selectedOptionItemIds: ids }).success, false);
  assert.equal(crossSellStorefrontQuoteRequestSchema.safeParse({ ...selection, priceModifierInCents: 1 }).success, false);
});
test("quote option identities distinguish repeated host variants and reconcile selected target options exactly", () => {
  const value: any = quote(), selected = (itemId: string) => ({ groupId: "extras", groupName: "Extras", itemId, itemName: itemId, priceModifierInCents: 0 });
  value.cartBasis.items[0].selectedOptions = [selected("color")];
  value.quote.items[0].selectedOptionItemIds = ["color"];
  value.cartBasis.items.push({ ...value.cartBasis.items[0], selectedOptions: [selected("size")] }); value.cartBasis.total += 10000;
  value.quote.items.unshift({ ...value.quote.items[0], selectedOptionItemIds: ["size"] });
  value.quote.originalSubtotalCents += 10000; value.quote.subtotalCents += 10000; value.quote.merchandiseTotalCents += 10000;
  value.selectedOptions = [selected("target-option")]; value.selectedOptionItemIds = ["target-option"];
  value.quote.items[2].selectedOptionItemIds = ["target-option"];
  assert.equal(crossSellStorefrontQuoteSchema.safeParse(value).success, true);
  value.quote.items[1].selectedOptionItemIds = ["size"];
  assert.equal(crossSellStorefrontQuoteSchema.safeParse(value).success, false);
});

