import assert from "node:assert/strict";
import test from "node:test";
import { selectBestProductPromotion, allocatePromotionDiscountBudget, type ProductPromotionCandidate } from "./best-product-promotion.service.js";

const now = new Date("2026-10-18T12:00:00.000Z");
const promotion = (patch: Partial<ProductPromotionCandidate> = {}): ProductPromotionCandidate => ({
  id: "promotion-a", merchantId: "merchant", variantId: "variant", isActive: true,
  startsAt: new Date("2026-10-17T00:00:00Z"), endsAt: new Date("2026-10-19T00:00:00Z"),
  discountType: "percent", discountValue: 20, ...patch,
});
const select = (promotions: ProductPromotionCandidate[], baseUnitPriceCents = 10000) => selectBestProductPromotion({
  merchantId: "merchant", variantId: "variant", productId: "product", categoryId: "category", baseUnitPriceCents, promotions, now,
});

test("greatest applicable product/variant/category saving wins independent of input order", () => {
  const rows = [promotion({ id: "product-promo", variantId: null, productId: "product", discountValue: 5 }),
    promotion({ id: "variant-promo", discountValue: 15 }),
    promotion({ id: "category-promo", variantId: null, categoryId: "category", discountType: "fixed", discountValue: 3000 })];
  const expected = { unitPriceCents: 7000, unitDiscountCents: 3000, promotionId: "category-promo", couponIds: [] };
  assert.deepEqual(select(rows), expected); assert.deepEqual(select([...rows].reverse()), expected);
});
test("equal savings use stable promotion ID, not database order or locale", () => {
  const rows = [promotion({ id: "z" }), promotion({ id: "a" })];
  assert.equal(select(rows).promotionId, "a"); assert.deepEqual(select(rows), select([...rows].reverse()));
});
for (const patch of [{ merchantId: "foreign" }, { isActive: false }, { startsAt: new Date("2026-10-19T00:00:00Z"), endsAt: new Date("2026-10-20T00:00:00Z") },
  { endsAt: now }, { variantId: "other" }, { variantId: null, productId: "other" }, { variantId: null, categoryId: "other" }]) {
  test(`non-applicable scope/window is not authorized ${Object.keys(patch).join()}`, () => {
    assert.deepEqual(select([promotion(patch)]), { unitPriceCents: 10000, unitDiscountCents: 0, couponIds: [] });
  });
}
test("a supplied variant binding cannot broaden to its whole product", () => {
  assert.equal(select([promotion({ productId: "product", variantId: "different-variant" })]).unitDiscountCents, 0);
});
test("all supplied product/category bindings must match the selected variant identity", () => {
  assert.equal(select([promotion({ productId: "other-product" })]).unitDiscountCents, 0);
  assert.equal(select([promotion({ categoryId: "other-category" })]).unitDiscountCents, 0);
});
test("coupon descriptors are only distinct badges and never compete as automatic savings", () => {
  const rows = [promotion({ id: "coupon-2", couponId: "CODE-B", discountType: null, discountValue: null }),
    promotion({ id: "coupon-1", couponId: "CODE-A", discountType: null, discountValue: null }), promotion()];
  assert.deepEqual(select(rows), { unitPriceCents: 8000, unitDiscountCents: 2000, promotionId: "promotion-a", couponIds: ["CODE-A", "CODE-B"] });
});
test("percent discount floors savings in cents, never rounds beyond the percent", () => {
  assert.equal(select([promotion({ discountValue: 50 })], 101).unitDiscountCents, 50);
  assert.equal(select([promotion({ discountValue: 50 })], 101).unitPriceCents, 51);
});
test("fixed and explicit prices share integer bounded savings semantics", () => {
  assert.equal(select([promotion({ discountType: "fixed", discountValue: 20000 })]).unitPriceCents, 0);
  assert.equal(select([promotion({ discountType: null, discountValue: null, promoPriceInCents: 4321 })]).unitDiscountCents, 5679);
  assert.equal(select([promotion({ discountType: null, discountValue: null, promoPriceInCents: 20000 })]).unitDiscountCents, 0);
});
test("valid SQL-independent identifiers and server timestamps are preserved without mutation", () => {
  const rows = [promotion({ id: " promoção ", createdAt: now, updatedAt: now })], before = structuredClone(rows);
  assert.equal(select(rows).promotionId, " promoção "); assert.deepEqual(rows, before);
});
for (const patch of [{ discountValue: -1 }, { discountValue: 101 }, { discountValue: 1.5 }, { discountType: "unknown" },
  { discountValue: NaN }, { discountValue: null }, { promoPriceInCents: 50 }, { couponId: "coupon" },
  { discountType: null, discountValue: null }, { startsAt: new Date("invalid") }, { startsAt: now, endsAt: now }]) {
  test(`malformed applicable promotion fails closed ${Object.keys(patch).join()}/${String(Object.values(patch)[0])}`, () => {
    assert.throws(() => select([promotion(patch)]));
  });
}
test("unsafe input identity and non-integer original money are rejected", () => {
  assert.throws(() => select([promotion()], 1.5));
  assert.throws(() => selectBestProductPromotion({ merchantId: "merchant", productId: "product", variantId: "\0", baseUnitPriceCents: 100,
    promotions: [], now }));
});
const line = (key: string, quantity = 1, requestedUnitDiscountCents = 2000) => ({ key, quantity, baseUnitPriceCents: 10000, requestedUnitDiscountCents });
test("allocator conserves the GLOBAL budget across quantities with stable line ordering", () => {
  const lines = [line("b", 2), line("a", 1)];
  const result = allocatePromotionDiscountBudget({ lines, budgetCents: 2501 });
  assert.deepEqual(result, { lines: [
    { key: "a", quantity: 1, unitPriceCents: 8000, unitDiscountCents: 2000 },
    { key: "b", quantity: 2, unitPriceCents: 9750, unitDiscountCents: 250 },
  ], promotionDiscountCents: 2500, requestedPromotionDiscountCents: 6000, limitApplied: true });
  assert.deepEqual(result, allocatePromotionDiscountBudget({ lines: [...lines].reverse(), budgetCents: 2501 }));
});
test("quantity granularity never manufactures fractional unit prices or claims full utilization", () => {
  const result = allocatePromotionDiscountBudget({ lines: [line("a", 3, 1)], budgetCents: 2 });
  assert.equal(result.promotionDiscountCents, 0); assert.equal(result.limitApplied, true);
  assert.equal(result.lines[0].unitPriceCents, 10000);
});
test("zero budget and no candidate keep original unit prices", () => {
  assert.equal(allocatePromotionDiscountBudget({ lines: [line("a")], budgetCents: 0 }).promotionDiscountCents, 0);
  assert.deepEqual(allocatePromotionDiscountBudget({ lines: [], budgetCents: 0 }), {
    lines: [], promotionDiscountCents: 0, requestedPromotionDiscountCents: 0, limitApplied: false,
  });
});
test("integer allocation uses BigInt intermediates without unsafe output", () => {
  const result = allocatePromotionDiscountBudget({ lines: [{ key: "a", quantity: 99, baseUnitPriceCents: 90000000000000, requestedUnitDiscountCents: 90000000000000 }],
    budgetCents: 8999999999999999 });
  assert.equal(result.promotionDiscountCents, 8910000000000000);
  assert.ok(Number.isSafeInteger(result.promotionDiscountCents));
});
for (const value of [{ lines: [line("a"), line("a")], budgetCents: 100 },
  { lines: [line("a", 0)], budgetCents: 100 }, { lines: [line("a", 1.5)], budgetCents: 100 },
  { lines: [line("a", 100)], budgetCents: 100 }, { lines: [line("a", 1, 10001)], budgetCents: 100 },
  { lines: [line("a")], budgetCents: -1 }, { lines: [line("a")], budgetCents: 1.5 },
  { lines: [{ ...line("a", 2), baseUnitPriceCents: Number.MAX_SAFE_INTEGER }], budgetCents: Number.MAX_SAFE_INTEGER }]) {
  test(`allocator rejects invalid identity/quantity/money rather than coercing ${JSON.stringify(value)}`, () => {
    assert.throws(() => allocatePromotionDiscountBudget(value));
  });
}

