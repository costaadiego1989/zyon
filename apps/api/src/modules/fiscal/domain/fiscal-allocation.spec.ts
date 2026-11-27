import assert from "node:assert/strict";
import test from "node:test";
import { allocateFiscalSale, type FiscalCommercialLine } from "./fiscal-allocation.js";

const line = (patch: Partial<FiscalCommercialLine> = {}): FiscalCommercialLine => ({
  lineId: "line_a", sellerMerchantId: "seller_a", sku: "sku_a", productType: "physical", fiscalClass: "goods", quantity: 2, unitPriceCents: 1234, ...patch,
});

test("one seller preserves agreed unit prices and quantities instead of net payout", () => {
  const input = { lines: [line()], discountCents: 100, shippingCents: 25 };
  const before = structuredClone(input);
  const value = allocateFiscalSale(input);
  assert.deepEqual(value.totals, { subtotalCents: 2468, discountCents: 100, shippingCents: 25, totalCents: 2393 });
  assert.deepEqual(value.sellers[0], { merchantId: "seller_a", subtotalCents: 2468, discountCents: 100, shippingCents: 25, totalCents: 2393,
    lines: [{ ...line(), grossCents: 2468, discountCents: 100, shippingCents: 25, totalCents: 2393 }] });
  assert.deepEqual(input, before);
});

test("an indivisible discount cent belongs to exactly one seller", () => {
  const value = allocateFiscalSale({ lines: [line({ quantity: 1, unitPriceCents: 100 }), line({ lineId: "line_b", sellerMerchantId: "seller_b", quantity: 1, unitPriceCents: 100 })], discountCents: 1, shippingCents: 0 });
  assert.deepEqual(value.sellers.map(seller => [seller.merchantId, seller.discountCents, seller.totalCents]), [["seller_a", 1, 99], ["seller_b", 0, 100]]);
  assert.equal(value.sellers.reduce((sum, seller) => sum + seller.totalCents, 0), 199);
});

test("shipping cents are conserved using deterministic largest remainders", () => {
  const value = allocateFiscalSale({ lines: [line({ quantity: 1, unitPriceCents: 100 }), line({ lineId: "line_b", sellerMerchantId: "seller_b", quantity: 1, unitPriceCents: 200 })], discountCents: 0, shippingCents: 5 });
  assert.deepEqual(value.sellers.map(seller => seller.shippingCents), [2, 3]);
  assert.equal(value.sellers.reduce((sum, seller) => sum + seller.totalCents, 0), 305);
});

test("mixed carts keep excluded commercial shares separate from goods invoices", () => {
  const value = allocateFiscalSale({ lines: [line({ quantity: 1, unitPriceCents: 100 }),
    line({ lineId: "digital", productType: "digital", fiscalClass: "excluded", quantity: 1, unitPriceCents: 100 }),
    line({ lineId: "service", productType: "service", fiscalClass: "excluded", quantity: 1, unitPriceCents: 100 })], discountCents: 3, shippingCents: 4 });
  assert.equal(value.sellers[0]?.totalCents, 103);
  assert.equal(value.sellers[0]?.lines.length, 1);
  assert.deepEqual(value.excludedLines.map(item => [item.productType, item.discountCents, item.shippingCents, item.totalCents]), [["digital", 1, 0, 99], ["service", 1, 0, 99]]);
  assert.equal(value.sellers[0]!.totalCents + value.excludedLines.reduce((sum, item) => sum + item.totalCents, 0), value.totals.totalCents);
  assert.deepEqual(value.totals, { subtotalCents: 300, discountCents: 3, shippingCents: 4, totalCents: 301 });
});

test("food is goods only under the explicit classification supplied by its validated fiscal profile", () => {
  const value = allocateFiscalSale({ lines: [line({ productType: "food" }), line({ lineId: "food_other", productType: "food", fiscalClass: "excluded" })], discountCents: 0, shippingCents: 0 });
  assert.equal(value.sellers[0]?.lines[0]?.productType, "food");
  assert.equal(value.sellers[0]?.lines.length, 1);
  assert.equal(value.excludedLines[0]?.lineId, "food_other");
});

test("service and digital lines cannot be reclassified as NF-e goods", () => {
  for (const productType of ["service", "digital"] as const) {
    assert.throws(() => allocateFiscalSale({ lines: [line({ productType })], discountCents: 0, shippingCents: 0 }), /fiscal_non_goods_line/);
  }
});

test("negative, fractional and unsafe monetary inputs are refused", () => {
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => allocateFiscalSale({ lines: [line()], discountCents: amount, shippingCents: 0 }), /fiscal_amount_invalid/);
    assert.throws(() => allocateFiscalSale({ lines: [line({ unitPriceCents: amount })], discountCents: 0, shippingCents: 0 }), /fiscal_amount_invalid/);
  }
});

test("invalid quantities cannot silently change the agreed commercial total", () => {
  for (const quantity of [0, -1, 0.5, NaN, Infinity]) {
    assert.throws(() => allocateFiscalSale({ lines: [line({ quantity })], discountCents: 0, shippingCents: 0 }), /fiscal_quantity_invalid/);
  }
});

test("duplicate line identities and absent seller identities are refused", () => {
  assert.throws(() => allocateFiscalSale({ lines: [line(), line()], discountCents: 0, shippingCents: 0 }), /fiscal_line_identity_invalid/);
  assert.throws(() => allocateFiscalSale({ lines: [line({ sellerMerchantId: "" })], discountCents: 0, shippingCents: 0 }), /fiscal_line_identity_invalid/);
});

test("a discount cannot exceed the persisted commercial subtotal", () => {
  assert.throws(() => allocateFiscalSale({ lines: [line()], discountCents: 2469, shippingCents: 0 }), /fiscal_discount_exceeds_subtotal/);
});

test("zero-value goods still receive each shipping cent once while absent goods cannot receive freight", () => {
  const value = allocateFiscalSale({ lines: [line({ unitPriceCents: 0 }), line({ lineId: "line_b", unitPriceCents: 0 })], discountCents: 0, shippingCents: 3 });
  assert.deepEqual(value.sellers[0]?.lines.map(item => item.shippingCents), [2, 1]);
  assert.equal(value.totals.totalCents, 3);
  assert.throws(() => allocateFiscalSale({ lines: [line({ productType: "digital", fiscalClass: "excluded" })], discountCents: 0, shippingCents: 1 }), /fiscal_shipping_without_goods/);
});

test("allocation is stable across input ordering and large integer products", () => {
  const lines = [line({ quantity: 1, unitPriceCents: 1_000_000_001 }), line({ lineId: "line_b", sellerMerchantId: "seller_b", quantity: 1, unitPriceCents: 1_000_000_000 })];
  const input = { lines, discountCents: 1_000_000_001, shippingCents: 3 };
  const value = allocateFiscalSale(input);
  assert.deepEqual(allocateFiscalSale({ ...input, lines: [...lines].reverse() }), value);
  assert.equal(value.sellers.reduce((sum, seller) => sum + seller.discountCents, 0), 1_000_000_001);
  assert.equal(value.sellers.reduce((sum, seller) => sum + seller.totalCents, 0), 1_000_000_003);
});
