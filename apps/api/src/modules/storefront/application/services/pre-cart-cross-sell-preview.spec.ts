import assert from "node:assert/strict";
import test from "node:test";
import { buildPreCartCrossSellPreview } from "./pre-cart-cross-sell-preview.js";

const products = [
  { id: "primary", sku: "PRIMARY", name: "Produto principal", price: 89.9, inStock: true },
  { id: "companion", sku: "COMPANION", name: "Complemento", price: 49.9, inStock: true },
];

test("pre-cart preview returns only an active complementary promotion for the viewed SKU", () => {
  const preview = buildPreCartCrossSellPreview({
    config: { enabled: true, touchpoints: { pre_cart: true }, strategies: ["complementary"], limits: { maxSuggestionsPerSession: 2 }, display: { mode: "modal" } },
    viewedSkus: ["PRIMARY"],
    promotions: [{ id: "promo", trigger: { sku_in_cart: ["PRIMARY"] }, recommendedSkus: ["COMPANION"], discountPercent: 10 }],
    products,
  });
  assert.equal(preview?.displayMode, "modal");
  assert.equal(preview?.products[0]?.id, "companion");
  assert.equal(preview?.products[0]?.promoId, "promo");
  assert.equal(preview?.products[0]?.discountPercent, 10);
});

test("pre-cart preview respects strategy and touchpoint selection", () => {
  const base = {
    viewedSkus: ["PRIMARY"],
    promotions: [{ id: "promo", trigger: { sku_in_cart: ["PRIMARY"] }, recommendedSkus: ["COMPANION"], discountPercent: 10 }],
    products,
  };
  assert.equal(buildPreCartCrossSellPreview({ ...base, config: { enabled: true, touchpoints: { pre_cart: false }, strategies: ["complementary"] } }), undefined);
  assert.equal(buildPreCartCrossSellPreview({ ...base, config: { enabled: true, touchpoints: { pre_cart: true }, strategies: ["same_category"] } }), undefined);
});

test("pre-cart preview supports same-category offers without exposing sold-out products", () => {
  const preview = buildPreCartCrossSellPreview({
    config: { enabled: true, touchpoints: { pre_cart: true }, strategies: ["same_category"] },
    viewedSkus: ["PRIMARY"],
    viewedCategory: "Skincare",
    promotions: [{ id: "promo", trigger: { category_in_cart: ["skincare"] }, recommendedSkus: ["COMPANION"], discountPercent: 0 }],
    products,
  });
  assert.equal(preview?.products.length, 1);
  const soldOut = buildPreCartCrossSellPreview({
    config: { enabled: true, touchpoints: { pre_cart: true }, strategies: ["same_category"] },
    viewedSkus: ["PRIMARY"],
    viewedCategory: "Skincare",
    promotions: [{ id: "promo", trigger: { category_in_cart: ["skincare"] }, recommendedSkus: ["COMPANION"], discountPercent: 0 }],
    products: products.map((product) => product.id === "companion" ? { ...product, inStock: false } : product),
  });
  assert.equal(soldOut, undefined);
});
