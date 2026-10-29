import assert from "node:assert/strict";
import test from "node:test";
import { prepareNormalCheckoutCrossSellPricing } from "./normal-checkout-cross-sell-pricing.js";
import { normalCheckoutCrossSellPricingQuoteSchema, type NormalCheckoutCrossSellPricingInput } from "../contracts/normal-checkout-cross-sell-pricing.schemas.js";

const now = "2026-10-20T12:00:00.000Z";
const promotion = () => ({ id: "promo", merchantId: "merchant", updatedAt: now, status: "active" as const,
  startsAt: "2026-10-01T00:00:00.000Z", endsAt: "2026-11-01T00:00:00.000Z", recommendedSkus: ["TARGET"],
  discountPercent: "10", maxDiscountPercent: "20", trigger: { skuInCart: ["OLD"] } });
function input(): NormalCheckoutCrossSellPricingInput {
  return { merchantId: "merchant", now, policy: { merchantId: "merchant", maxDiscountPercent: 20 }, currentDiscountCents: 500,
    lines: [{ kind: "preserved_saved", variantId: "old", productId: "old-product", sku: "OLD", quantity: 1,
      baseUnitPriceCents: 10000, savedUnitPriceCents: 9000, existingQuantity: 1 }],
    target: { variantId: "target", productId: "target-product", sku: "TARGET", quantity: 1, baseUnitPriceCents: 2500,
      selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 }], promotion: promotion() },
    catalogVariants: [
      { merchantId: "merchant", variantId: "old", productId: "old-product", sku: "OLD", isActive: true, productActive: true,
        productDeletedAt: null, currency: "BRL", baseUnitPriceCents: 10000 },
      { merchantId: "merchant", variantId: "target", productId: "target-product", sku: "TARGET", isActive: true, productActive: true,
        productDeletedAt: null, currency: "BRL", baseUnitPriceCents: 2000 },
    ] };
}
function quote(value: unknown) {
  const result = prepareNormalCheckoutCrossSellPricing(value);
  assert.equal(result.kind, "quote_candidate", result.kind === "requires_review" ? result.reason : undefined);
  return result;
}
function review(value: unknown, reason?: string) {
  const result = prepareNormalCheckoutCrossSellPricing(value);
  assert.equal(result.kind, "requires_review");
  if (result.kind === "requires_review" && reason) assert.equal(result.reason, reason);
}
test("mixed B12500 P01000 D500 adds250 over product+paid option without double savings", () => {
  const value = input(), before = structuredClone(value), result = quote(value);
  assert.equal(result.originalSubtotalCents, 12500); assert.equal(result.preservedSavingsCents, 1000);
  assert.equal(result.allocatedSavingsCents, 250); assert.equal(result.promotionDiscountCents, 1250);
  assert.equal(result.cartDiscountCents, 500); assert.equal(result.merchandiseSubtotalCents, 11250);
  assert.equal(result.payableMerchandiseCents, 10750); assert.equal(result.remainingDiscountCents, 750);
  assert.equal(result.target.maximumUnitPriceCents, 2250); assert.deepEqual(result.target.selectedOptionItemIds, ["large"]);
  assert.equal(result.items.find(line => line.variantId === "old")!.unitPriceCents, 9000);
  assert.deepEqual(value, before); assert.deepEqual(prepareNormalCheckoutCrossSellPricing(value), result);
  assert.ok(normalCheckoutCrossSellPricingQuoteSchema.safeParse(result).success);
});
test("pure canonical prior line does not become a preserved saving", () => {
  const value = input(); value.lines = [{ kind: "canonical", variantId: "old", productId: "old-product", sku: "OLD",
    quantity: 1, baseUnitPriceCents: 10000 }];
  const result = quote(value); assert.equal(result.preservedSavingsCents, 0); assert.equal(result.promotionDiscountCents, 250);
});
test("existing V1 intent is recomputed from original base, not counted again as P0", () => {
  const value = input(), priorPromotion = { ...promotion(), id: "prior-promo", recommendedSkus: ["OLD"], trigger: { skuInCart: ["TRIGGER"] } };
  value.lines = [{ kind: "canonical", variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 1000 },
    { kind: "accepted_intent", variantId: "old", productId: "old-product", sku: "OLD", quantity: 1, baseUnitPriceCents: 10000,
      intent: { version: 1, promotionId: "prior-promo", promotionUpdatedAt: now, acceptedQuantity: 1,
        originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 }, promotion: priorPromotion }];
  value.catalogVariants.push({ ...value.catalogVariants[0]!, variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", baseUnitPriceCents: 1000 });
  const result = quote(value); assert.equal(result.preservedSavingsCents, 0); assert.equal(result.allocatedSavingsCents, 1250);
  assert.equal(result.items.find(line => line.variantId === "old")!.unitPriceCents, 9000);
});
test("product promotion competes with cross-sell and never sums with its250 saving", () => {
  const value = input(); value.target.productCandidate = { promotionId: "product-promo", unitPriceCents: 2100, unitDiscountCents: 400 };
  const result = quote(value); assert.equal(result.target.source, "product"); assert.equal(result.allocatedSavingsCents, 400);
  assert.equal(result.target.maximumUnitPriceCents, 2100);
});
test("preserved line cannot receive a fresh candidate or grow beyond existing quantity", () => {
  const value = input(); Object.assign(value.lines[0]!, { productCandidate: { promotionId: "new", unitPriceCents: 8000, unitDiscountCents: 2000 } });
  review(value, "invalid_input"); const extended = input(); extended.lines[0]!.quantity = 2; review(extended, "invalid_input");
});
test("cap reaches exact ceiling and records the existing limit warning", () => {
  const value = input(); value.policy.maxDiscountPercent = 14;
  const result = quote(value); assert.equal(result.payableMerchandiseCents, 10750); assert.equal(result.remainingDiscountCents, 0);
  assert.equal(result.notice, "discount_limit_reached");
});
test("existing savings above the current company cap require review without mutating saved price", () => {
  const value = input(); value.policy.maxDiscountPercent = 10; const before = structuredClone(value);
  review(value, "existing_benefit_requires_review"); assert.deepEqual(value, before);
});
test("no target headroom refuses instead of accepting full price", () => {
  const value = input(); value.policy.maxDiscountPercent = 12; review(value, "target_benefit_unavailable");
});
test("target cannot satisfy its own persisted trigger", () => {
  const value = input(); value.target.promotion.trigger = { skuInCart: ["TARGET"] }; review(value, "trigger_not_met");
});
for (const mutation of ["tenant", "catalog-duplicate", "catalog-price", "promotion-expired", "same-selection", "product-invalid", "overflow", "option-id-duplicate"] as const) {
  test(`strict canonical pricing refuses ${mutation}`, () => {
    const value = input();
    if (mutation === "tenant") value.catalogVariants[0]!.merchantId = "foreign";
    if (mutation === "catalog-duplicate") value.catalogVariants.push(structuredClone(value.catalogVariants[1]!));
    if (mutation === "catalog-price") value.catalogVariants[1]!.baseUnitPriceCents = 2001;
    if (mutation === "promotion-expired") value.target.promotion.endsAt = "2026-10-20T11:00:00.000Z";
    if (mutation === "same-selection") {
      const { promotion: _promotion, ...line } = value.target;
      value.lines.push({ ...line, kind: "canonical" });
    }
    if (mutation === "product-invalid") value.target.productCandidate = { promotionId: "p", unitPriceCents: 2000, unitDiscountCents: 100 };
    if (mutation === "overflow") { value.target.quantity = 99; value.target.baseUnitPriceCents = 2_147_483_647; }
    if (mutation === "option-id-duplicate") value.target.selectedOptions!.push(structuredClone(value.target.selectedOptions![0]!));
    review(value, {
      tenant: "tenant_mismatch", "catalog-duplicate": "catalog_ambiguous", "catalog-price": "base_changed",
      "promotion-expired": "promotion_expired", "same-selection": "target_already_present",
      "product-invalid": "product_candidate_invalid", overflow: "monetary_overflow", "option-id-duplicate": "invalid_input",
    }[mutation]);
  });
}
test("effective prices cannot be supplied as another original base", () => {
  const value = input(); value.target.baseUnitPriceCents = 2250; review(value, "base_changed");
});
test("strict output cannot lose preserved P0 or invent payable/target money", () => {
  const result = quote(input());
  for (const patch of [{ preservedSavingsCents: 0 }, { payableMerchandiseCents: 1 }, { target: { ...result.target, maximumUnitPriceCents: 1 } }])
    assert.equal(normalCheckoutCrossSellPricingQuoteSchema.safeParse({ ...result, ...patch }).success, false);
});
test("whole-unit allocation leaves unspendable cents without falsely reporting an exact ceiling", () => {
  const value = input(); value.currentDiscountCents = 0; value.policy.maxDiscountPercent = 6; value.target.quantity = 3;
  const result = quote(value); assert.equal(result.originalSubtotalCents, 17500); assert.equal(result.allocatedSavingsCents, 48);
  assert.equal(result.target.maximumUnitPriceCents, 2484); assert.equal(result.remainingDiscountCents, 2);
  assert.equal(result.notice, "discount_limited");
});
test("same variant with a different explicit option identity is not merged with the new target", () => {
  const value = input(); value.lines.push({ kind: "canonical", variantId: "target", productId: "target-product", sku: "TARGET",
    quantity: 1, baseUnitPriceCents: 2000 });
  const result = quote(value); assert.equal(result.items.filter(line => line.variantId === "target").length, 2);
  assert.equal(result.items.find(line => line.variantId === "target" && !line.selectedOptions?.length)!.unitPriceCents, 2000);
  assert.equal(result.target.maximumUnitPriceCents, 2250);
});
test("paid target options and existing V1 paid options compare by the same canonical IDs without input mutation", () => {
  const value = input();
  value.lines = [{ kind: "canonical", variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 1000 },
    { kind: "accepted_intent", variantId: "old", productId: "old-product", sku: "OLD", quantity: 1, baseUnitPriceCents: 10500,
      selectedOptions: [{ groupId: "old-size", groupName: "Tamanho", itemId: "old-large", itemName: "Grande", priceModifierInCents: 500 }],
      intent: { version: 1, promotionId: "prior", promotionUpdatedAt: now, acceptedQuantity: 1,
        originalUnitPriceCents: 10500, maximumUnitPriceCents: 9450, selectedOptionItemIds: ["old-large"] },
      promotion: { ...promotion(), id: "prior", recommendedSkus: ["OLD"], trigger: { skuInCart: ["TRIGGER"] } } }];
  value.catalogVariants.push({ ...value.catalogVariants[0]!, variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", baseUnitPriceCents: 1000 });
  const before = structuredClone(value), result = quote(value);
  assert.deepEqual(result.target.selectedOptionItemIds, ["large"]); assert.equal(result.target.maximumUnitPriceCents, 2250);
  const existing = result.items.find(line => line.variantId === "old")!;
  assert.deepEqual(existing.selectedOptions?.map(option => option.itemId), ["old-large"]); assert.equal(existing.unitPriceCents, 9450);
  assert.equal(result.preservedSavingsCents, 0); assert.equal(result.allocatedSavingsCents, 1300);
  assert.equal(result.payableMerchandiseCents, 12200); assert.deepEqual(value, before);
});
test("equivalent source ordering gives identical quote and does not mutate the caller", () => {
  const value = input(); value.lines.push({ kind: "canonical", variantId: "extra", productId: "extra-product", sku: "EXTRA",
    quantity: 1, baseUnitPriceCents: 1000 });
  value.catalogVariants.push({ ...value.catalogVariants[0]!, variantId: "extra", productId: "extra-product", sku: "EXTRA", baseUnitPriceCents: 1000 });
  const reordered = structuredClone(value); reordered.lines.reverse(); reordered.catalogVariants.reverse();
  assert.deepEqual(quote(value), quote(reordered));
});
for (const mutation of ["maximum", "revision", "quantity", "option-identity"] as const) test(`existing authored intent ${mutation} remains a bounded precondition`, () => {
  const value = input();
  value.lines = [{ kind: "canonical", variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 1000 },
    { kind: "accepted_intent", variantId: "old", productId: "old-product", sku: "OLD", quantity: 1, baseUnitPriceCents: 10000,
      intent: { version: 1, promotionId: "prior", promotionUpdatedAt: now, acceptedQuantity: 1,
        originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000 },
      promotion: { ...promotion(), id: "prior", recommendedSkus: ["OLD"], trigger: { skuInCart: ["TRIGGER"] } } }];
  value.catalogVariants.push({ ...value.catalogVariants[0]!, variantId: "trigger", productId: "trigger-product", sku: "TRIGGER", baseUnitPriceCents: 1000 });
  const line = value.lines[1]!; assert.equal(line.kind, "accepted_intent"); if (line.kind !== "accepted_intent") assert.fail();
  if (mutation === "maximum") line.intent.maximumUnitPriceCents = 8000;
  if (mutation === "revision") line.intent.promotionUpdatedAt = "2026-10-19T12:00:00.000Z";
  if (mutation === "quantity") line.quantity = 2;
  if (mutation === "option-identity") line.intent.selectedOptionItemIds = ["foreign"];
  review(value, mutation === "maximum" ? "accepted_price_changed" : mutation === "revision" ? "promotion_changed"
    : mutation === "quantity" ? "quantity_exceeds_acceptance" : "base_changed");
});
