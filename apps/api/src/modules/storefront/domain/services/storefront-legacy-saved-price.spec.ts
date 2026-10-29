import test from "node:test";
import assert from "node:assert/strict";
import { evaluateLegacySavedPriceBasis } from "./storefront-legacy-saved-price.js";

const basis = (savedUnitPriceCents = 11250, cartDiscountCents = 500, quantity = 1, maxDiscountPercent = 20) => ({
  lines: [{ canonicalUnitPriceCents: 12500, savedUnitPriceCents, quantity }], cartDiscountCents, maxDiscountPercent,
});
test("historical product plus paid option savings count once, with cart D and no margin", () => {
  const input = basis(), before = structuredClone(input), result = evaluateLegacySavedPriceBasis(input);
  assert.equal(result.kind, "preserved");
  if (result.kind !== "preserved") return;
  assert.deepEqual(result.budget, { version: 1, originalSubtotalCents: 12500, promotionDiscountCents: 1250 });
  assert.equal(result.subtotalCents, 11250); assert.equal(result.cartDiscountCents, 500); assert.equal(result.remainingDiscountCents, 750);
  assert.deepEqual(input, before);
});
test("exact combined ceiling is preserved; one cent over requires review without changing saved values", () => {
  const exact = evaluateLegacySavedPriceBasis(basis(11250, 1250)); assert.equal(exact.kind, "preserved");
  if (exact.kind === "preserved") assert.equal(exact.remainingDiscountCents, 0);
  const input = basis(11250, 1251), before = structuredClone(input);
  assert.deepEqual(evaluateLegacySavedPriceBasis(input), { kind: "requires_review", reason: "above_company_limit" }); assert.deepEqual(input, before);
});
test("quantity participates in B/S and every cent of the saved concession", () => {
  const result = evaluateLegacySavedPriceBasis(basis(11250, 2500, 2)); assert.equal(result.kind, "preserved");
  if (result.kind === "preserved") { assert.equal(result.budget.originalSubtotalCents, 25000); assert.equal(result.budget.promotionDiscountCents, 2500); assert.equal(result.remainingDiscountCents, 0); }
});
test("zero company cap cannot grandfather any savings", () => {
  assert.deepEqual(evaluateLegacySavedPriceBasis(basis(11250, 0, 1, 0)), { kind: "requires_review", reason: "above_company_limit" });
});
test("saved price above today's canonical price is review, not a silently changed quote", () => {
  assert.deepEqual(evaluateLegacySavedPriceBasis(basis(12501, 0)), { kind: "requires_review", reason: "saved_price_above_catalog" });
});
for (const patch of [{ quantity: 0 }, { quantity: 100 }, { quantity: 1.5 }, { savedUnitPriceCents: -1 }, { canonicalUnitPriceCents: NaN }])
  test(`malformed source monetary input refuses ${JSON.stringify(patch)}`, () => {
    const input = basis(); Object.assign(input.lines[0]!, patch); assert.throws(() => evaluateLegacySavedPriceBasis(input));
  });
