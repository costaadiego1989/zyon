import test from "node:test";
import assert from "node:assert/strict";
import { matchesCatalogVariant } from "./catalog-search-criteria.js";
import type { ProductVariantProps } from "../entities/product.entity.js";

const variant = (extra: Partial<ProductVariantProps> = {}): ProductVariantProps => ({ id: "v", sku: "sku", attributes: {},
  isActive: true, basePriceInCents: 8000, taxPercent: 0, currency: "BRL", stockQuantity: 3, stockReserved: 0, media: [], ...extra });

test("price, available stock and attribute conditions must all be satisfied by the same variant", () => {
  const input = { merchantId: "a", minPriceCents: 5000, maxPriceCents: 10000, inStockOnly: true,
    attributes: [{ name: "cor", value: "verde", operator: "equals" as const }] };
  const split = [variant({ attributes: { cor: "azul" } }), variant({ attributes: { cor: "verde" }, basePriceInCents: 15000 }),
    variant({ attributes: { cor: "verde" }, stockQuantity: 1, stockReserved: 1 })];
  assert.equal(split.some(item => matchesCatalogVariant(item, input, "physical")), false);
  assert.equal(matchesCatalogVariant(variant({ attributes: { COR: "Vérde" } }), input, "physical"), true);
});

test("missing attributes do not establish negative requirements; inactive or wrong-currency variants cannot match", () => {
  const input = { merchantId: "a", currency: "BRL" as const,
    attributes: [{ name: "material", value: "couro", operator: "not_equals" as const }] };
  assert.equal(matchesCatalogVariant(variant(), input, "physical"), false);
  assert.equal(matchesCatalogVariant(variant({ attributes: { material: "Couro" } }), input, "physical"), false);
  assert.equal(matchesCatalogVariant(variant({ attributes: { material: "algodão" } }), input, "physical"), true);
  assert.equal(matchesCatalogVariant(variant({ attributes: { material: "algodão" }, isActive: false }), input, "physical"), false);
  assert.equal(matchesCatalogVariant(variant({ attributes: { material: "algodão" }, currency: "USD" }), input, "physical"), false);
});
