import assert from "node:assert/strict";
import test from "node:test";
import { selectedProductPresentation } from "./product-presentation.js";
import type { ProductCardBlock } from "./types";

const physical: ProductCardBlock["data"] = { id: "product", name: "Produto", price: 1895, priceFormatted: "R$ 18,95", inStock: true,
  productType: "physical", detailed: true, sku: "RED", stock: 5,
  variants: [{ id: "red", name: "Cor", value: "Vermelho", sku: "RED", stock: 4 }, { id: "blue", name: "Cor", value: "Azul", sku: "BLUE", stock: 1 }] };

test("selection changes the SKU and available stock together", () => {
  assert.equal(selectedProductPresentation(physical, "blue").sku, "BLUE");
  assert.equal(selectedProductPresentation(physical, "blue").stockLabel, "Em estoque · 1 un.");
  assert.equal(selectedProductPresentation(physical, "red").stockLabel, "Em estoque · 4 un.");
});
test("unknown variant quantities and SKUs do not inherit another variant's values", () => {
  const result = selectedProductPresentation({ ...physical, variants: physical.variants?.map(variant => ({ ...variant, sku: undefined, stock: undefined })) }, "blue");
  assert.equal(result.sku, undefined); assert.equal(result.stock, undefined); assert.equal(result.stockLabel, "Em estoque");
});
test("zero stock disables a physical selection and server refusal always wins", () => {
  assert.equal(selectedProductPresentation({ ...physical, variants: [{ ...physical.variants![0], stock: 0 }] }, "red").available, false);
  assert.equal(selectedProductPresentation({ ...physical, inStock: false }, "red").available, false);
});
test("digital/service quantity zero cannot override authoritative availability or promise shipping", () => {
  for (const productType of ["digital", "service"] as const) {
    const result = selectedProductPresentation({ ...physical, productType, stock: 0, variants: [{ ...physical.variants![0], stock: 0 }] }, "red");
    assert.equal(result.available, true); assert.equal(result.stock, undefined); assert.equal(result.stockLabel, "Disponível"); assert.equal(result.requiresShipping, false);
    assert.equal(selectedProductPresentation({ ...physical, productType, inStock: false }, "red").available, false);
  }
});
