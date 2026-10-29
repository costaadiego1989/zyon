import assert from "node:assert/strict";
import test from "node:test";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { evaluateCombinedDiscount } from "./combined-discount.js";
import { evaluateDiscountOffer } from "./index.js";

const rules = (): MerchantRules => ({ maxDiscountPercent: 20, minimumMarginPercent: 10 } as MerchantRules);
const cart = (original = 10000, promotion = 1500, existing = 0): Cart => ({ currency: "BRL", total: (original - promotion) / 100,
  items: [{ sku: "fixture", name: "Fixture", price: (original - promotion) / 100, quantity: 1, cost: 30 }], currentDiscount: existing / 100,
  discountBudget: { version: 1, originalSubtotalCents: original, promotionDiscountCents: promotion } });

test("promotion plus extra TARGET shares the original global ceiling in integer cents", () => {
  assert.deepEqual(evaluateCombinedDiscount(cart(), rules(), 1000), { kind: "authorized", cartDiscountCents: 500, totalDiscountCents: 2000,
    promotionDiscountCents: 1500, originalSubtotalCents: 10000, remainingDiscountCents: 0,
    limitReached: false, limitApplied: true, reason: "capped_by_combined_discount_limit" });
});
test("already obtained ceiling has a distinct truthful warning without increasing discount", () => {
  assert.deepEqual(evaluateCombinedDiscount(cart(10000, 2000), rules(), 500), { kind: "authorized", cartDiscountCents: 0, totalDiscountCents: 2000,
    promotionDiscountCents: 2000, originalSubtotalCents: 10000, remainingDiscountCents: 0,
    limitReached: true, limitApplied: true, reason: "discount_limit_reached" });
});
test("existing and requested cart discounts are alternative targets, never accumulated", () => {
  const result = evaluateCombinedDiscount(cart(10000, 500, 500), rules(), 1000);
  assert.equal(result.kind, "authorized"); assert.equal(result.cartDiscountCents, 1000); assert.equal(result.totalDiscountCents, 1500);
  assert.equal(result.remainingDiscountCents, 500); assert.equal(result.limitApplied, false);
});
test("a smaller target preserves an existing larger authorized cart discount", () => {
  const result = evaluateCombinedDiscount(cart(10000, 500, 1000), rules(), 500);
  assert.equal(result.kind, "authorized"); assert.equal(result.cartDiscountCents, 1000); assert.equal(result.totalDiscountCents, 1500);
  assert.equal(result.limitReached, false);
});
test("already above ceiling requires review, never silent repricing/revocation or fresh grant", () => {
  const result = evaluateCombinedDiscount(cart(10000, 1500, 1000), rules(), 500);
  assert.equal(result.kind, "requires_review"); assert.equal(result.reason, "existing_discount_above_limit");
  assert.equal(result.cartDiscountCents, 0); assert.equal(result.totalDiscountCents, 0); assert.equal(result.remainingDiscountCents, 0);
  assert.equal(result.limitReached, false); assert.equal(result.limitApplied, false);
});
test("promotion itself over ceiling requires review rather than fabricating a different line price", () => {
  assert.equal(evaluateCombinedDiscount(cart(10000, 2500), rules(), 0).kind, "requires_review");
});
test("configured zero is not replaced by a permissive default and has its own reason", () => {
  const result = evaluateCombinedDiscount(cart(10000, 0), { ...rules(), maxDiscountPercent: 0 }, 500);
  assert.equal(result.kind, "blocked"); assert.equal(result.reason, "discount_disabled_by_merchant");
  assert.equal(result.limitReached, false); assert.equal(result.cartDiscountCents, 0);
});
test("one-cent and fractional-percentage limits floor savings instead of rounding up", () => {
  const value = cart(101, 0); value.items[0].cost = 0;
  const result = evaluateCombinedDiscount(value, { ...rules(), maxDiscountPercent: 50, minimumMarginPercent: 0 }, 100);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 50); assert.equal(result.cartDiscountCents, 50);
  const fractional = cart(10000, 0); fractional.items[0].cost = 0;
  assert.equal(evaluateCombinedDiscount(fractional, { ...rules(), maxDiscountPercent: 0.29, minimumMarginPercent: 0 }, 1000).cartDiscountCents, 29);
});
test("a promotion-only authorization counts its savings exactly once against the ceiling", () => {
  const value = cart(10000, 2000); value.items[0].cost = 50;
  const result = evaluateCombinedDiscount(value, { ...rules(), minimumMarginPercent: 30 }, 0);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 2000); assert.equal(result.cartDiscountCents, 0);
});
test("combined extra is assessed once on the already promotion-adjusted subtotal", () => {
  const value = cart(10000, 1000); value.items[0].cost = 52.2;
  const result = evaluateCombinedDiscount(value, { ...rules(), minimumMarginPercent: 30 }, 1000);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 2000);
});
for (const failure of ["missing", "high", "invalid", "options"] as const) test(`optional cost ${failure} cannot hide an already consumed ceiling`, () => {
  const value = cart(10000, 2000);
  if (failure === "missing") delete value.items[0].cost;
  if (failure === "high") value.items[0].cost = 79;
  if (failure === "invalid") value.items[0].cost = -1;
  if (failure === "options") value.items[0].selected_options = [{ group_name: "G", item_name: "I", price_modifier: 1 }];
  const result = evaluateCombinedDiscount(value, rules(), 500);
  assert.equal(result.kind, "authorized"); assert.equal(result.limitReached, true); assert.equal(result.limitApplied, true);
  assert.equal(result.cartDiscountCents, 0); assert.equal(result.totalDiscountCents, 2000);
  assert.equal(result.reason, "discount_limit_reached");
});
test("zero known cost does not change ceiling authorization", () => {
  const value = cart(); value.items[0].cost = 0; assert.equal(evaluateCombinedDiscount(value, rules(), 500).kind, "authorized");
});
test("without promotion context, replacement targets still do not compound", () => {
  const value = cart(10000, 0, 500); delete value.discountBudget;
  const result = evaluateCombinedDiscount(value, rules(), 1000);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 1000); assert.equal(result.promotionDiscountCents, 0);
});
test("repeated calls and frozen input preserve deterministic cents and never mutate prices", () => {
  const value = cart(), before = structuredClone(value); Object.freeze(value.items[0]); Object.freeze(value.items); Object.freeze(value.discountBudget); Object.freeze(value);
  assert.deepEqual(evaluateCombinedDiscount(value, rules(), 1000), evaluateCombinedDiscount(value, rules(), 1000));
  assert.deepEqual(value, before);
});
test("multiple quantities and lines reconcile effective subtotal and original promotion budget", () => {
  const value: Cart = { currency: "BRL", total: 85, items: [{ sku: "a", name: "A", price: 20, quantity: 2, cost: 5 }, { sku: "b", name: "B", price: 15, quantity: 3, cost: 3 }],
    discountBudget: { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1500 } };
  const result = evaluateCombinedDiscount(value, rules(), 1000);
  assert.equal(result.kind, "authorized"); assert.equal(result.totalDiscountCents, 2000);
});
for (const budget of [null, {}, { version: 2, originalSubtotalCents: 10000, promotionDiscountCents: 1500 },
  { version: 1, originalSubtotalCents: 10001, promotionDiscountCents: 1500 },
  { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: -1 },
  { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1.5 },
  { version: 1, originalSubtotalCents: Number.MAX_SAFE_INTEGER + 1, promotionDiscountCents: 1500 },
  { version: 1, originalSubtotalCents: 10000, promotionDiscountCents: 1500, extra: true }]) test(`invalid provenance is review, never implicit legacy fallback ${JSON.stringify(budget)}`, () => {
  const value = { ...cart(), discountBudget: budget } as never, result = evaluateCombinedDiscount(value, rules(), 500);
  assert.equal(result.kind, "requires_review"); assert.equal(result.cartDiscountCents, 0); assert.equal(result.totalDiscountCents, 0);
});
for (const requested of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) test(`invalid requested cents ${String(requested)} never authorize`, () => {
  const result = evaluateCombinedDiscount(cart(), rules(), requested);
  assert.equal(result.kind, "blocked"); assert.equal(result.cartDiscountCents, 0); assert.equal(result.totalDiscountCents, 0);
});
for (const cap of [undefined, -1, 101, NaN, Infinity]) test(`missing/invalid configured cap ${String(cap)} never authorizes`, () => {
  assert.equal(evaluateCombinedDiscount(cart(), { ...rules(), maxDiscountPercent: cap } as never, 500).kind, "blocked");
});
test("foreign currency and malformed cent-level cart are not silently converted", () => {
  assert.equal(evaluateCombinedDiscount({ ...cart(), currency: "USD" }, rules(), 500).reason, "incentive_currency_unsupported");
  const value = cart(); value.items[0].price += 0.001;
  assert.equal(evaluateCombinedDiscount(value, rules(), 500).kind, "blocked");
});
test("contextual evaluateDiscountOffer keeps its public shape while enforcing combined remaining budget", () => {
  const value = cart(), result = evaluateDiscountOffer(value, rules(), 20);
  assert.deepEqual(Object.keys(result).sort(), ["approved", "marginAfterOffer", "reason", "type", "value"]);
  assert.equal(result.approved, true); assert.equal(Math.round(value.total * result.value), 500);
});
test("contextual offer cannot exceed combined cap even when requested percent is below its ordinary standalone cap", () => {
  const value = cart(), result = evaluateDiscountOffer(value, rules(), 10);
  assert.equal(result.approved, true); assert.equal(Math.round(value.total * result.value), 500);
});
test("contextual offer refuses malformed provenance and above-ceiling previous savings", () => {
  assert.equal(evaluateDiscountOffer({ ...cart(), discountBudget: null } as never, rules(), 20).approved, false);
  assert.equal(evaluateDiscountOffer(cart(10000, 1500, 1000), rules(), 20).approved, false);
});
test("contextual percent conversion cannot round a large valid subtotal above the requested cent amount", () => {
  const base = 8_247_000_003, value = cart(base, 0); value.items[0].cost = 0;
  const result = evaluateDiscountOffer(value, { ...rules(), maxDiscountPercent: 50, minimumMarginPercent: 0 }, 33.3333);
  assert.equal(result.approved, true);
  assert.equal(Math.round(value.total * result.value), Number(BigInt(base) * 333333n / 1000000n));
});

