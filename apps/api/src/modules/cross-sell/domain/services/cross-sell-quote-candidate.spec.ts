import assert from "node:assert/strict";
import test from "node:test";
import { buildCrossSellQuoteCandidate } from "./cross-sell-quote-candidate.js";
import type { CrossSellQuoteCandidateInput } from "../contracts/cross-sell-quote.schemas.js";

function input(): CrossSellQuoteCandidateInput {
  return { merchantId: "merchant", now: "2026-10-18T12:00:00.000Z",
    intent: { version: 1, promotionId: "promotion", promotionUpdatedAt: "2026-10-18T00:00:00.000Z", acceptedQuantity: 2, originalUnitPriceCents: 10000 },
    promotion: { id: "promotion", merchantId: "merchant", updatedAt: "2026-10-18T00:00:00.000Z", status: "active", startsAt: "2026-01-01T00:00:00.000Z",
      endsAt: "2027-01-01T00:00:00.000Z", recommendedSkus: ["TARGET"], discountPercent: "12.3456", maxDiscountPercent: "20", trigger: { skuInCart: ["TRIGGER"] } },
    target: { variantId: "target-variant", productId: "target-product", sku: "TARGET", quantity: 2, baseUnitPriceCents: 10000 },
    catalogVariants: [{ variantId: "target-variant", productId: "target-product", sku: "TARGET", merchantId: "merchant", isActive: true,
      productActive: true, productDeletedAt: null, currency: "BRL", baseUnitPriceCents: 10000 }],
    persistedCart: { kind: "persisted_cart", merchantId: "merchant", subtotalCents: 10000,
      items: [{ variantId: "trigger-variant", productId: "trigger-product", sku: "TRIGGER", categoryId: "category", quantity: 1, unitPriceCents: 10000 }] } };
}
const unavailable = (value: unknown, reason: string) => assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "unavailable", reason });

test("exact decimal percentage floors candidate savings without Number truncation or authorization", () => {
  const source = input(), before = structuredClone(source), result = buildCrossSellQuoteCandidate(source);
  assert.deepEqual(result, { kind: "candidate", source: "cross_sell", promotionId: "promotion", unitPriceCents: 8766, unitDiscountCents: 1234 });
  assert.deepEqual(source, before); assert.equal(Object.hasOwn(result, "approved"), false);
});

test("tiny 0.0001% retains exact eligibility and floors sub-cent savings", () => {
  for (const [base, discount] of [[1000000, 1], [999999, 0]]) {
    const value = input(); value.promotion.discountPercent = "0.0001"; value.intent.originalUnitPriceCents = base;
    value.target.baseUnitPriceCents = base; value.catalogVariants[0].baseUnitPriceCents = base;
    const result = buildCrossSellQuoteCandidate(value);
    assert.equal(result.kind, "candidate"); if (result.kind !== "candidate") throw new Error("candidate_expected");
    assert.equal(result.unitDiscountCents, discount); assert.equal(result.source, discount ? "cross_sell" : "base");
  }
});

test("100% and safe-integer maximum are only proposals, not a free-product grant", () => {
  const value = input(); value.promotion.discountPercent = "100"; value.promotion.maxDiscountPercent = "100";
  value.intent.originalUnitPriceCents = Number.MAX_SAFE_INTEGER; value.target.baseUnitPriceCents = Number.MAX_SAFE_INTEGER;
  value.catalogVariants[0].baseUnitPriceCents = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "cross_sell", promotionId: "promotion", unitPriceCents: 0, unitDiscountCents: Number.MAX_SAFE_INTEGER });
});

test("promotion-level maximum constrains its candidate but is not the global merchant ceiling", () => {
  const value = input(); value.promotion.discountPercent = "80"; value.promotion.maxDiscountPercent = "12.3456";
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "cross_sell", promotionId: "promotion", unitPriceCents: 8766, unitDiscountCents: 1234 });
  unavailable({ ...value, merchantMaxDiscountPercent: 10 }, "invalid_input"); // Existing engine must authorize the global cap later.
});

test("product and accepted cross-sell savings compete by greatest benefit, never add", () => {
  const value = input(); value.productCandidate = { promotionId: "product-promotion", unitPriceCents: 8000, unitDiscountCents: 2000 };
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "product", promotionId: "product-promotion", unitPriceCents: 8000, unitDiscountCents: 2000 });
  value.productCandidate = { promotionId: "product-promotion", unitPriceCents: 9000, unitDiscountCents: 1000 };
  assert.equal(buildCrossSellQuoteCandidate(value).kind, "candidate");
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "cross_sell", promotionId: "promotion", unitPriceCents: 8766, unitDiscountCents: 1234 });
});

test("equal product/cross-sell savings prefer product regardless of promotion ID", () => {
  const value = input(); value.productCandidate = { promotionId: "zz-product", unitPriceCents: 8766, unitDiscountCents: 1234 };
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "product", promotionId: "zz-product", unitPriceCents: 8766, unitDiscountCents: 1234 });
});

test("zero promotion maximum proposes base, never a fabricated maximum-reached grant", () => {
  const value = input(); value.promotion.maxDiscountPercent = "0";
  assert.deepEqual(buildCrossSellQuoteCandidate(value), { kind: "candidate", source: "base", unitPriceCents: 10000, unitDiscountCents: 0 });
});

for (const owner of ["promotion", "persistedCart", "catalogVariants"] as const) test(`tenant mismatch refuses ${owner}`, () => {
  const value = input(); if (owner === "catalogVariants") value.catalogVariants[0].merchantId = "foreign"; else value[owner].merchantId = "foreign";
  unavailable(value, "tenant_mismatch");
});
test("promotion ID and stable update version must match the accepted intent", () => {
  const wrongId = input(); wrongId.promotion.id = "other"; unavailable(wrongId, "promotion_mismatch");
  const changed = input(); changed.promotion.updatedAt = "2026-10-18T00:00:00.001Z"; unavailable(changed, "promotion_changed");
});
test("active window uses explicit timestamp, inclusive start and exclusive end", () => {
  const starts = input(); starts.promotion.startsAt = starts.now; assert.equal(buildCrossSellQuoteCandidate(starts).kind, "candidate");
  const ended = input(); ended.promotion.endsAt = ended.now; unavailable(ended, "promotion_expired");
  const future = input(); future.promotion.startsAt = "2026-10-18T12:00:00.001Z"; unavailable(future, "promotion_not_started");
  const archived = input(); archived.promotion.status = "archived"; unavailable(archived, "promotion_inactive");
  const open = input(); open.promotion.endsAt = null; assert.equal(buildCrossSellQuoteCandidate(open).kind, "candidate");
});
test("recommendation membership is exact commercial SKU, never product/variant ID or case-folded guess", () => {
  for (const sku of ["target", "target-variant", "target-product", " TARGET"]) {
    const value = input(); value.promotion.recommendedSkus = [sku]; unavailable(value, "catalog_mismatch");
  }
});
test("duplicate active SKU resolution and mismatched catalog identities cannot choose the first match", () => {
  const duplicate = input(); duplicate.catalogVariants.push({ ...duplicate.catalogVariants[0], variantId: "duplicate" }); unavailable(duplicate, "catalog_ambiguous");
  const missing = input(); missing.catalogVariants = []; unavailable(missing, "catalog_unavailable");
  const wrong = input(); wrong.catalogVariants[0].productId = "other"; unavailable(wrong, "catalog_mismatch");
});
for (const patch of [{ isActive: false }, { productActive: false }, { productDeletedAt: "2026-10-18T00:00:00.000Z" }]) test(`inactive/deleted catalog cannot grant ${Object.keys(patch)}`, () => {
  const value = input(); Object.assign(value.catalogVariants[0], patch); unavailable(value, "catalog_unavailable");
});
test("accepted base price and current catalog price cannot be silently repriced", () => {
  const changed = input(); changed.catalogVariants[0].baseUnitPriceCents = 12000; unavailable(changed, "base_changed");
  const forged = input(); forged.target.baseUnitPriceCents = 9000; unavailable(forged, "base_changed");
});
test("quantity may decrease but cannot exceed the quantity the buyer accepted", () => {
  const value = input(); value.target.quantity = 1; assert.equal(buildCrossSellQuoteCandidate(value).kind, "candidate");
  value.target.quantity = 3; unavailable(value, "quantity_exceeds_acceptance");
});
test("all supplied SKU/category/threshold trigger predicates constrain persisted cart context", () => {
  const value = input(); value.promotion.trigger = { skuInCart: ["TRIGGER"], categoryInCart: ["category"], cartTotalAboveCents: 9999 };
  assert.equal(buildCrossSellQuoteCandidate(value).kind, "candidate");
  value.promotion.trigger.categoryInCart = ["other"]; unavailable(value, "trigger_not_met");
  value.promotion.trigger.categoryInCart = ["category"]; value.promotion.trigger.cartTotalAboveCents = 10000; unavailable(value, "trigger_not_met");
});
test("accepted target line cannot supply its own persisted trigger or threshold", () => {
  const value = input(); value.persistedCart.items = [{ variantId: "target-variant", productId: "target-product", sku: "TARGET", categoryId: "category", quantity: 1, unitPriceCents: 10000 }];
  value.promotion.trigger = { skuInCart: ["TARGET"], categoryInCart: ["category"], cartTotalAboveCents: 0 };
  unavailable(value, "trigger_not_met");
});
test("viewed product data and empty predicates do not establish a persisted trigger", () => {
  const value = input(); value.promotion.trigger = {}; unavailable(value, "trigger_not_met");
  unavailable({ ...input(), persistedCart: { ...input().persistedCart, kind: "viewed_product" } }, "invalid_input");
});
test("explicit undefined optional trigger fields cannot masquerade as an actual predicate", () => {
  const value = input(); value.promotion.trigger = { skuInCart: undefined, categoryInCart: undefined, cartTotalAboveCents: undefined };
  unavailable(value, "trigger_not_met");
});
test("incoherent cart subtotal and product candidate arithmetic fail closed", () => {
  const wrongTotal = input(); wrongTotal.persistedCart.subtotalCents = 9999; unavailable(wrongTotal, "invalid_input");
  const wrongCandidate = input(); wrongCandidate.productCandidate = { promotionId: "product", unitPriceCents: 8000, unitDiscountCents: 1000 };
  unavailable(wrongCandidate, "product_candidate_invalid");
});
test("invalid input shapes do not leak causes or fall back to another benefit", () => {
  for (const malformed of [null, false, {}, { ...input(), now: "invalid" }, { ...input(), promotion: { ...input().promotion, discountPercent: "1e2" } }]) unavailable(malformed, "invalid_input");
  const invalidIntent = input(); invalidIntent.promotion.updatedAt = "2026-10-18T00:00:00.001Z";
  invalidIntent.productCandidate = { promotionId: "product", unitPriceCents: 5000, unitDiscountCents: 5000 };
  unavailable(invalidIntent, "promotion_changed");
});

