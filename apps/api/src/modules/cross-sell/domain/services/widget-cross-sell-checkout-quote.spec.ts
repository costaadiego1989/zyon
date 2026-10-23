import assert from "node:assert/strict";
import test from "node:test";
import { prepareWidgetCrossSellCheckoutQuote, widgetCrossSellCheckoutQuoteMatchesCurrent } from "./widget-cross-sell-checkout-quote.js";
import { widgetCrossSellCheckoutQuoteSchema } from "../contracts/widget-cross-sell-checkout-quote.schemas.js";

function input() {
  return { merchantId: "merchant", now: "2026-10-20T12:00:00.000Z",
    suggestion: { id: "suggestion", merchantId: "merchant", sessionId: "checkout", promotionId: "promo",
      status: "pending", rankedSkus: ["TARGET"] },
    checkout: { merchantId: "merchant", sessionId: "checkout", persistenceVersion: 4, currency: "BRL",
      currentDiscountCents: 0, couponCode: null, freeShipping: false, hasActiveCouponReservation: false,
      items: [{ variantId: "a-trigger", productId: "trigger-product", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 10000 }] },
    promotion: { id: "promo", merchantId: "merchant", updatedAt: "2026-10-20T00:00:00.000Z", status: "active",
      startsAt: "2026-01-01T00:00:00.000Z", endsAt: null, recommendedSkus: ["TARGET"],
      discountPercent: "10", maxDiscountPercent: "100", trigger: { skuInCart: ["TRIGGER"] } },
    catalogVariants: [{ variantId: "z-target", productId: "target-product", sku: "TARGET", merchantId: "merchant",
      isActive: true, productActive: true, productDeletedAt: null, currency: "BRL", baseUnitPriceCents: 2000 }],
    target: { variantId: "z-target", productId: "target-product", sku: "TARGET", quantity: 1, baseUnitPriceCents: 2000 },
    policy: { merchantId: "merchant", maxDiscountPercent: 20 } };
}
const quote = (value: unknown = input()) => {
  const result = prepareWidgetCrossSellCheckoutQuote(value);
  assert.equal(result.kind, "quote_candidate", JSON.stringify(result));
  if (result.kind !== "quote_candidate") throw new Error("quote_expected");
  return result;
};
const review = (value: unknown, reason?: string) => {
  const result = prepareWidgetCrossSellCheckoutQuote(value);
  assert.equal(result.kind, "requires_review");
  if (reason) assert.deepEqual(result, { kind: "requires_review", reason });
};

test("positive widget benefit plans the post-add checkout, without accepting or mutating", () => {
  const value = input(), before = structuredClone(value), result = quote(value);
  assert.equal(result.sessionId, "checkout"); assert.equal(result.persistenceVersion, 4);
  assert.equal(result.suggestionId, "suggestion"); assert.equal(result.target.maximumUnitPriceCents, 1800);
  assert.equal(result.totalCents, 11800); assert.equal(result.promotionDiscountCents, 200);
  assert.equal(result.originalSubtotalCents, 12000); assert.equal(result.target.source, "cross_sell");
  assert.deepEqual(value, before); assert.equal(Object.hasOwn(result, "cartId"), false);
  assert.equal(Object.hasOwn(result, "approved"), false);
});

test("paid canonical options join the discount base, never a second discount", () => {
  const value = input();
  const result = quote({ ...value, target: { ...value.target, baseUnitPriceCents: 2500, selectedOptions: [
    { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 },
  ] } });
  assert.equal(result.target.originalUnitPriceCents, 2500); assert.equal(result.target.maximumUnitPriceCents, 2250);
  assert.equal(result.totalCents, 12250); assert.deepEqual(result.target.selectedOptionItemIds, ["large"]);
});

test("company ceiling includes existing product promotions in the same post-add allocation", () => {
  const value = input(); value.policy.maxDiscountPercent = 5; value.promotion.discountPercent = "50";
  const result = quote({ ...value, checkout: { ...value.checkout, items: [
    { ...value.checkout.items[0], productCandidate: { promotionId: "automatic", unitPriceCents: 9500, unitDiscountCents: 500 } },
  ] } });
  assert.equal(result.promotionDiscountCents, 600); assert.equal(result.target.maximumUnitPriceCents, 1900);
  assert.equal(result.notice, "discount_limit_reached"); assert.equal(result.totalCents, 11400);
});

test("automatic product and cross-sell candidates compete instead of stacking", () => {
  const value = input(), result = quote({ ...value, target: { ...value.target,
    productCandidate: { promotionId: "automatic", unitPriceCents: 1600, unitDiscountCents: 400 } } });
  assert.equal(result.target.source, "product"); assert.equal(result.target.maximumUnitPriceCents, 1600);
  assert.equal(result.promotionDiscountCents, 400);
});

test("unknown cost and absent margin policy do not prevent a valid commercial quote", () => {
  assert.equal(quote().target.maximumUnitPriceCents, 1800);
  // No fake cost or minimum-margin default is introduced in the input/output.
  assert.equal(JSON.stringify(quote()).includes("cost"), false);
});

for (const field of ["merchantId", "sessionId"] as const) test(`suggestion ${field} cannot cross checkout identity`, () => {
  const value = input(); value.suggestion[field] = "foreign"; review(value, "identity_mismatch");
});
for (const field of ["checkout", "policy", "promotion"] as const) test(`${field} cannot cross merchant scope`, () => {
  const value = input(); value[field].merchantId = "foreign"; review(value, "identity_mismatch");
});
for (const status of ["accepted", "declined"]) test(`${status} suggestion cannot be accepted again`, () => {
  review({ ...input(), suggestion: { ...input().suggestion, status } }, "suggestion_unavailable");
});
test("exact suggestion and promotion membership are both required", () => {
  const value = input(); value.suggestion.rankedSkus = ["OTHER"]; review(value, "suggestion_unavailable");
  value.suggestion.rankedSkus = ["TARGET"]; value.suggestion.promotionId = "other"; review(value, "suggestion_unavailable");
  value.suggestion.promotionId = "promo"; value.promotion.recommendedSkus = ["OTHER"]; review(value, "catalog_mismatch");
});
test("duplicate SKU resolution is refused rather than choosing the first catalog row", () => {
  const value = input(); value.catalogVariants.push({ ...value.catalogVariants[0]!, variantId: "duplicate" });
  review(value, "catalog_ambiguous");
});
test("current canonical base and paid option snapshots must agree", () => {
  const value = input(); value.target.baseUnitPriceCents = 2500; review(value, "base_changed");
  value.catalogVariants[0]!.baseUnitPriceCents = 2500; assert.equal(quote(value).target.maximumUnitPriceCents, 2250);
});
test("target already in cart cannot be silently merged or qualify its own trigger", () => {
  const value = input(); value.checkout.items.push({ ...value.target }); review(value, "target_already_present");
});
test("promotion trigger and time window remain canonical prerequisites", () => {
  const value = input(); value.promotion.trigger.skuInCart = ["OTHER"]; review(value, "trigger_not_met");
  value.promotion.trigger.skuInCart = ["TRIGGER"]; value.promotion.status = "archived"; review(value, "promotion_inactive");
});
test("discount-disabled or exhausted ceiling never silently falls back to full price", () => {
  const value = input(); value.policy.maxDiscountPercent = 0; review(value, "target_benefit_unavailable");
  value.policy.maxDiscountPercent = 5;
  review({ ...value, checkout: { ...value.checkout, items: [{ ...value.checkout.items[0],
    productCandidate: { promotionId: "automatic", unitPriceCents: 9000, unitDiscountCents: 1000 } }] } }, "target_benefit_unavailable");
});
for (const patch of [{ currentDiscountCents: 1 }, { couponCode: "coupon" }, { freeShipping: true }, { hasActiveCouponReservation: true }]) {
  test(`unsupported existing benefit is retained as review: ${Object.keys(patch)[0]}`, () => {
    const value = input(); review({ ...value, checkout: { ...value.checkout, ...patch } }, "invalid_input");
  });
}
test("existing automatic product candidate must reconcile with canonical base", () => {
  const value = input(); review({ ...value, checkout: { ...value.checkout, items: [{ ...value.checkout.items[0],
    productCandidate: { promotionId: "automatic", unitPriceCents: 100, unitDiscountCents: 100 } }] } }, "product_candidate_invalid");
});
test("malformed money, unknown authority fields, missing versions and duplicate lines fail closed", () => {
  for (const patch of [{ persistenceVersion: undefined }, { persistenceVersion: -1 }, { currency: "USD" },
    { cartId: "storefront" }, { items: [...input().checkout.items, ...input().checkout.items] }]) {
    const value = input(); review({ ...value, checkout: { ...value.checkout, ...patch } }, "invalid_input");
  }
  for (const price of [NaN, Infinity, -1, .01, Number.MAX_SAFE_INTEGER]) {
    const value = input(); review({ ...value, target: { ...value.target, baseUnitPriceCents: price } });
  }
  review({ ...input(), computed_discount: 99 }, "invalid_input");
});
test("stable selection order yields the same complete post-add quote", () => {
  const value = input(); value.checkout.items.push({ variantId: "b-second", productId: "second-product", sku: "SECOND", quantity: 1, baseUnitPriceCents: 2000 });
  const first = quote(value); value.checkout.items.reverse(); assert.deepEqual(quote(value), first);
});
test("quantity rounding never spends more than the whole-cart ceiling", () => {
  const value = input(); value.policy.maxDiscountPercent = .01; value.target.quantity = 3;
  review(value, "target_benefit_unavailable"); // One-cent budget cannot grant a whole cent per unit for three units.
  value.policy.maxDiscountPercent = .02;
  const result = quote(value); assert.equal(result.promotionDiscountCents, 3); assert.equal(result.target.maximumUnitPriceCents, 1999);
  assert.equal(result.notice, "discount_limit_reached");
});

test("option order is canonical and cannot change allocation or quote bytes", () => {
  const value = input(), selectedOptions = [
    { groupId: "size", groupName: "Tamanho", itemId: "z-large", itemName: "Grande", priceModifierInCents: 300 },
    { groupId: "color", groupName: "Cor", itemId: "a-blue", itemName: "Azul", priceModifierInCents: 200 },
  ];
  const first = quote({ ...value, target: { ...value.target, baseUnitPriceCents: 2500, selectedOptions } });
  assert.deepEqual(quote({ ...value, target: { ...value.target, baseUnitPriceCents: 2500, selectedOptions: [...selectedOptions].reverse() } }), first);
});

test("Zod output rejects changed base option snapshots, not only identity or totals", () => {
  const value = input();
  const result = quote({ ...value, checkout: { ...value.checkout, items: [{ ...value.checkout.items[0], selectedOptions: [
    { groupId: "size", groupName: "Tamanho", itemId: "small", itemName: "Pequeno", priceModifierInCents: 0 },
  ] }] } });
  const line = result.items.find(item => item.variantId === "a-trigger")!;
  line.selectedOptions![0]!.itemName = "Changed after quotation";
  assert.equal(widgetCrossSellCheckoutQuoteSchema.safeParse(result).success, false);
});

test("Zod output rejects changed basis product-promotion provenance and category", () => {
  const value = input();
  const result = quote({ ...value, checkout: { ...value.checkout, items: [{ ...value.checkout.items[0], categoryId: "category",
    productCandidate: { promotionId: "automatic", unitPriceCents: 9900, unitDiscountCents: 100 } }] } });
  for (const change of ["category", "promotion"] as const) {
    const copy = structuredClone(result), line = copy.items.find(item => item.variantId === "a-trigger")!;
    if (change === "category") line.categoryId = "foreign";
    else line.productCandidate!.promotionId = "foreign";
    assert.equal(widgetCrossSellCheckoutQuoteSchema.safeParse(copy).success, false);
  }
});

test("Zod output rejects changed tenant/version/money/selection while legacy guard remains separate", () => {
  const initial = quote();
  for (const change of ["merchantId", "persistenceVersion", "totalCents", "promotionDiscountCents", "target", "items"] as const) {
    const result = structuredClone(initial);
    if (change === "merchantId") result.merchantId = "foreign";
    else if (change === "target") result.target.maximumUnitPriceCents++;
    else if (change === "items") result.items.push({ ...result.items[0]! });
    else result[change]++;
    assert.equal(widgetCrossSellCheckoutQuoteSchema.safeParse(result).success, false, change);
  }
});

test("price/quantity/ceiling matrix preserves exact whole-cent conservation", () => {
  for (const price of [1, 29, 1999, 2000, 100001]) for (const quantity of [1, 3, 7, 99]) for (const ceiling of [.01, .29, 1, 20, 100]) {
    const value = input(); value.target.baseUnitPriceCents = price; value.target.quantity = quantity;
    value.catalogVariants[0]!.baseUnitPriceCents = price; value.policy.maxDiscountPercent = ceiling;
    const result = prepareWidgetCrossSellCheckoutQuote(value);
    if (result.kind !== "quote_candidate") continue;
    const original = result.items.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
    const total = result.items.reduce((sum, line) => sum + BigInt(line.unitPriceCents) * BigInt(line.quantity), 0n);
    assert.equal(original - total, BigInt(result.promotionDiscountCents));
    assert.ok(result.promotionDiscountCents <= Math.floor(Number((Number(original) * ceiling / 100).toFixed(6))));
    assert.ok(result.target.maximumUnitPriceCents < result.target.originalUnitPriceCents);
  }
});

test("fresh comparison tolerates observation time but not changed session/version/suggestion/promotion", () => {
  const value = input(), initial = quote(value);
  value.now = "2026-10-20T12:00:01.000Z";
  assert.equal(widgetCrossSellCheckoutQuoteMatchesCurrent(initial, quote(value)), true);
  for (const mutate of [
    (next: ReturnType<typeof input>) => { next.checkout.persistenceVersion++; },
    (next: ReturnType<typeof input>) => { next.checkout.sessionId = "other"; next.suggestion.sessionId = "other"; },
    (next: ReturnType<typeof input>) => { next.suggestion.id = "other"; },
    (next: ReturnType<typeof input>) => { next.promotion.updatedAt = "2026-10-20T00:00:00.001Z"; },
    (next: ReturnType<typeof input>) => { next.checkout.items[0]!.baseUnitPriceCents++; },
  ]) {
    const next = input(); mutate(next);
    assert.equal(widgetCrossSellCheckoutQuoteMatchesCurrent(initial, quote(next)), false);
  }
});

test("expired canonical promotion or malformed expected quote cannot pass fresh comparison", () => {
  const value = input(), initial = quote(value);
  const expired = { ...value, promotion: { ...value.promotion, endsAt: value.now } };
  assert.equal(widgetCrossSellCheckoutQuoteMatchesCurrent(initial, prepareWidgetCrossSellCheckoutQuote(expired)), false);
  assert.equal(widgetCrossSellCheckoutQuoteMatchesCurrent({ ...initial, approved: true }, initial), false);
  assert.equal(widgetCrossSellCheckoutQuoteMatchesCurrent(initial, { ...initial, approved: true }), false);
});
