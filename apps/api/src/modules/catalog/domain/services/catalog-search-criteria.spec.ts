import test from "node:test";
import assert from "node:assert/strict";
import { matchesCatalogVariant } from "./catalog-search-criteria.js";
import type { ProductVariantProps } from "../entities/product.entity.js";
import type { SearchProductsInput } from "../ports/product-repository.port.js";

test("GRAPH-01 OR groups and mandatory exclusions must hold on one variant; unknown negatives are not facts", () => {
  const input: SearchProductsInput = { merchantId: "a", attributes: [{ name: "material", value: "couro", operator: "not_equals" }],
    attributeAnyOf: [[{ name: "cor", value: "azul", operator: "equals" }, { name: "cor", value: "verde", operator: "equals" }],
      [{ name: "tamanho", value: "M", operator: "equals" }, { name: "tamanho", value: "G", operator: "equals" }]] };
  for (const [attributes, expected] of [
    [{ cor: "Azúl", material: "algodão", tamanho: "M" }, true],
    [{ cor: "verde", material: "algodão", tamanho: "G" }, true],
    [{ cor: "vermelho", material: "algodão", tamanho: "M" }, false],
    [{ cor: "azul", material: "couro", tamanho: "M" }, false],
    [{ cor: "azul", tamanho: "M" }, false],
    [{ cor: "azul", material: "algodão", tamanho: "P" }, false],
  ] as const) assert.equal(matchesCatalogVariant(variant({ attributes }), input, "physical"), expected);
  assert.equal(matchesCatalogVariant(variant(), { merchantId: "a", attributeAnyOf: [[]] }, "physical"), false);
});

test("GRAPH-02 price boundaries retain inclusive defaults and enforce strict comparisons on projection", () => {
  const exact = variant({ basePriceInCents: 10000 });
  assert.equal(matchesCatalogVariant(exact, { merchantId: "a", maxPriceCents: 10000 }, "physical"), true);
  assert.equal(matchesCatalogVariant(exact, { merchantId: "a", maxPriceCents: 10000, maxPriceExclusive: true }, "physical"), false);
  assert.equal(matchesCatalogVariant(exact, { merchantId: "a", minPriceCents: 10000 }, "physical"), true);
  assert.equal(matchesCatalogVariant(exact, { merchantId: "a", minPriceCents: 10000, minPriceExclusive: true }, "physical"), false);
});

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
