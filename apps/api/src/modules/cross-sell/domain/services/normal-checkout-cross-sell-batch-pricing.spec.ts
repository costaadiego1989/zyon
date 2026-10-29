import assert from "node:assert/strict";
import test from "node:test";
import { prepareNormalCheckoutCrossSellBatchPricing } from "./normal-checkout-cross-sell-pricing.js";
import type { NormalCheckoutCrossSellBatchPricingInput } from "../contracts/normal-checkout-cross-sell-pricing.schemas.js";
import { normalCheckoutCrossSellAcceptanceSchema, normalCheckoutCrossSellHttpAcceptanceSchema,
  normalCheckoutCrossSellHttpQuoteSchema } from "../contracts/normal-checkout-cross-sell-command.schemas.js";

function input(): NormalCheckoutCrossSellBatchPricingInput {
  const now = "2026-10-20T12:00:00.000Z";
  const promotion = { id: "promo", merchantId: "merchant", updatedAt: now, startsAt: "2026-10-01T00:00:00.000Z",
    endsAt: "2026-11-01T00:00:00.000Z", status: "active" as const, recommendedSkus: ["A", "B"],
    discountPercent: "10", maxDiscountPercent: "20", trigger: { skuInCart: ["TRIGGER"] } };
  return { merchantId: "merchant", now, policy: { merchantId: "merchant", maxDiscountPercent: 20 }, currentDiscountCents: 0,
    lines: [{ kind: "canonical", variantId: "trigger", productId: "p-trigger", sku: "TRIGGER", quantity: 1, baseUnitPriceCents: 2000 }],
    targets: [{ variantId: "a", productId: "p-a", sku: "A", quantity: 1, baseUnitPriceCents: 1000, promotion,
      selectedOptions: [{ groupId: "size", groupName: "Size", itemId: "large", itemName: "Large", priceModifierInCents: 100 }] },
      { variantId: "b", productId: "p-b", sku: "B", quantity: 1, baseUnitPriceCents: 2000, promotion,
        selectedOptions: [{ groupId: "color", groupName: "Color", itemId: "blue", itemName: "Blue", priceModifierInCents: 300 }] }],
    catalogVariants: [{ variantId: "trigger", productId: "p-trigger", sku: "TRIGGER", merchantId: "merchant", baseUnitPriceCents: 2000,
      isActive: true, productActive: true, productDeletedAt: null, currency: "BRL" },
      { variantId: "a", productId: "p-a", sku: "A", merchantId: "merchant", baseUnitPriceCents: 900,
        isActive: true, productActive: true, productDeletedAt: null, currency: "BRL" },
      { variantId: "b", productId: "p-b", sku: "B", merchantId: "merchant", baseUnitPriceCents: 1700,
        isActive: true, productActive: true, productDeletedAt: null, currency: "BRL" }] };
}
const quote = (value: unknown) => {
  const result = prepareNormalCheckoutCrossSellBatchPricing(value);
  assert.equal(result.kind, "quote_candidate", result.kind === "requires_review" ? result.reason : undefined);
  return result;
};
test("two paid-option targets share one actual-before cart and one300cent discount", () => {
  const value = input(), before = structuredClone(value), result = quote(value);
  assert.equal(result.targets.length, 2); assert.equal(result.originalSubtotalCents, 5000);
  assert.deepEqual(result.targets.map(target => target.maximumUnitPriceCents), [900, 1800]);
  assert.equal(result.allocatedSavingsCents, 300); assert.equal(result.payableMerchandiseCents, 4700);
  assert.deepEqual(value, before);
});
test("batch ordering cannot change allocation, intents or paid option identity", () => {
  const value = input(), other = structuredClone(value); other.targets.reverse(); other.catalogVariants.reverse();
  assert.deepEqual(quote(value), quote(other));
});
test("combined cap is allocated once across every target", () => {
  const value = input(); value.policy.maxDiscountPercent = 4;
  const result = quote(value); assert.equal(result.allocatedSavingsCents, 200);
  assert.deepEqual(result.targets.map(target => target.maximumUnitPriceCents), [900, 1900]);
  assert.equal(result.remainingDiscountCents, 0); assert.equal(result.notice, "discount_limit_reached");
});
test("a fully exhausted sibling refuses the entire batch instead of accepting it at full price", () => {
  const value = input(); value.policy.maxDiscountPercent = 2;
  assert.deepEqual(prepareNormalCheckoutCrossSellBatchPricing(value), { kind: "requires_review", reason: "target_benefit_unavailable" });
});
test("one newly selected target cannot qualify another target's trigger", () => {
  const value = input(); value.targets[1]!.promotion = { ...value.targets[1]!.promotion, trigger: { skuInCart: ["A"] } };
  assert.deepEqual(prepareNormalCheckoutCrossSellBatchPricing(value), { kind: "requires_review", reason: "trigger_not_met" });
});
test("duplicate target option identity is invalid before any allocation", () => {
  const value = input(); value.targets.push(structuredClone(value.targets[0]!));
  assert.deepEqual(prepareNormalCheckoutCrossSellBatchPricing(value), { kind: "requires_review", reason: "invalid_input" });
});
test("existing accepted_skus transport must match the entire shown quote SKU set", () => {
  const pricing = quote(input());
  const expected_quote = { version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion", sessionVersion: 0,
    basisHash: "a".repeat(64), contextHash: "b".repeat(64), pricing };
  const request = { suggestion_id: "suggestion", accepted_skus: ["A", "B"], expected_quote };
  assert.ok(normalCheckoutCrossSellAcceptanceSchema.safeParse(request).success);
  assert.equal(normalCheckoutCrossSellAcceptanceSchema.safeParse({ ...request, accepted_skus: ["A"] }).success, false);
  assert.equal(normalCheckoutCrossSellAcceptanceSchema.safeParse({ ...request, accepted_skus: ["A", "B", "FOREIGN"] }).success, false);
  assert.equal(normalCheckoutCrossSellHttpAcceptanceSchema.safeParse({ ...request, session_id: "other" }).success, false);
});
test("quote transport accepts explicit choices but no caller price, tenant or financial flag", () => {
  const request = { session_id: "session", suggestion_id: "suggestion", targets: [{ sku: "A", variant_id: "a", quantity: 1,
    selected_option_item_ids: ["large"] }] };
  assert.ok(normalCheckoutCrossSellHttpQuoteSchema.safeParse(request).success);
  for (const patch of [{ merchant_id: "other" }, { allow_discount: true }, { unit_price: 1 }])
    assert.equal(normalCheckoutCrossSellHttpQuoteSchema.safeParse({ ...request, ...patch }).success, false);
});
test("trusted read revalidates all existing intents without fabricating a new target", () => {
  const value = input();
  value.lines.push(...value.targets.map(target => ({ ...target, kind: "accepted_intent" as const,
    intent: { version: 1 as const, promotionId: target.promotion.id, promotionUpdatedAt: target.promotion.updatedAt,
      acceptedQuantity: target.quantity, originalUnitPriceCents: target.baseUnitPriceCents,
      maximumUnitPriceCents: target.baseUnitPriceCents * .9,
      selectedOptionItemIds: (target.selectedOptions ?? []).map(option => option.itemId) } })));
  value.targets = [];
  const result = quote(value); assert.deepEqual(result.targets, []); assert.equal(result.allocatedSavingsCents, 300);
  assert.equal(result.payableMerchandiseCents, 4700);
});
test("an empty target list without intent projects internally but grants no new intent", () => {
  const value = input(); value.targets = [];
  const result=quote(value);assert.deepEqual(result.targets,[]);assert.equal(result.allocatedSavingsCents,0);
  assert.equal(result.payableMerchandiseCents,2000);
});
test("removing the final item yields a zero-money internal projection, not a public quote",()=>{
  const value=input();value.lines=[];value.targets=[];const result=quote(value);
  assert.deepEqual(result.items,[]);assert.deepEqual(result.targets,[]);assert.equal(result.originalSubtotalCents,0);
  assert.equal(result.payableMerchandiseCents,0);assert.equal(result.promotionDiscountCents,0);
  const expected_quote={version:1,merchantId:"merchant",sessionId:"session",suggestionId:"suggestion",sessionVersion:0,
    basisHash:"a".repeat(64),contextHash:"b".repeat(64),pricing:result};
  assert.equal(normalCheckoutCrossSellAcceptanceSchema.safeParse({suggestion_id:"suggestion",accepted_skus:["A"],expected_quote}).success,false);
});
test("an empty internal projection cannot silently erase an existing cart benefit D",()=>{
  const value=input();value.lines=[];value.targets=[];value.currentDiscountCents=1;
  assert.deepEqual(prepareNormalCheckoutCrossSellBatchPricing(value),{kind:"requires_review",reason:"existing_benefit_requires_review"});
});
test("removing the external trigger cannot let a retained accepted target qualify itself", () => {
  const value = input(), target = value.targets[0]!;
  value.lines = [{ ...target, kind: "accepted_intent", intent: { version: 1, promotionId: target.promotion.id,
    promotionUpdatedAt: target.promotion.updatedAt, acceptedQuantity: 1, originalUnitPriceCents: 1000,
    maximumUnitPriceCents: 900, selectedOptionItemIds: ["large"] } }];
  value.targets = [];
  assert.deepEqual(prepareNormalCheckoutCrossSellBatchPricing(value), { kind: "requires_review", reason: "trigger_not_met" });
});
