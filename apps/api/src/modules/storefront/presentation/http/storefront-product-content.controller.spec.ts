import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { StorefrontProductContentController } from "./storefront-product-content.controller.js";

function makeController(product: unknown) {
  const prisma = {
    merchant: { findFirst: async () => ({ id: "merchant-1", storeSlug: "demo" }) },
    product: { findFirst: async () => product },
  } as unknown as PrismaClient;
  const content = { execute: async () => ({ locale: "pt-BR", blocks: [], faqs: [], testimonials: [], videos: [] }) };
  const billing = { getEffectivePlan: async () => "starter" };
  return new StorefrontProductContentController(prisma, content as never, billing as never);
}

test("public rich content exposes display prices, variants and media without internal costs or stock counts", async () => {
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto", description: "Descrição pública",
    type: "physical", metadata: { demo: true },
    variants: [
      { id: "small", attributes: { size: "30 ml" }, price: { basePriceInCents: 12990, currency: "BRL" }, stock: [{ quantity: 3, reserved: 1 }], media: [{ url: "https://example.com/product.jpg", alt: "Produto" }] },
      { id: "large", attributes: { size: "50 ml" }, price: { basePriceInCents: 18990, currency: "BRL" }, stock: [{ quantity: 24, reserved: 0 }], media: [] },
    ],
  }).getContent("demo", "product-1", "pt-BR");

  assert.equal(result.purchase.productName, "Produto");
  assert.equal(result.purchase.description, "Descrição pública");
  assert.equal(result.purchase.defaultVariantId, "small");
  assert.equal(result.purchase.priceReais, 129.9);
  assert.equal(result.purchase.variants[0].lowStock, true);
  assert.equal(result.purchase.variants[1].lowStock, false);
  assert.equal(result.purchase.variants[1].priceReais, 189.9);
  assert.deepEqual(result.purchase.images, [{ src: "https://example.com/product.jpg", alt: "Produto", variantId: "small" }]);
  assert.equal(result.purchase.isDemo, true);
  assert.equal(JSON.stringify(result.purchase).includes("InCents"), false);
  assert.equal(JSON.stringify(result.purchase).includes("availableQuantity"), false);
});

test("public rich content exposes food choices and the catalog display price", async () => {
  const result = await makeController({
    id: "food", merchantId: "merchant-1", name: "Pizza", type: "food",
    metadata: { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 700 }] }] },
    variants: [{ id: "food-variant", attributes: {}, price: { basePriceInCents: 3990, currency: "BRL" }, stock: [] }],
  }).getContent("demo", "food", "pt-BR");
  assert.equal(result.purchase.defaultVariantId, "food-variant");
  assert.equal(result.purchase.priceReais, 39.9);
  assert.equal(result.purchase.variants[0].lowStock, false);
  assert.deepEqual(result.purchase.optionGroups, [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 700 }] }]);
});

test("sold-out products retain their details with a disabled purchase target", async () => {
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto indisponível", type: "physical",
    variants: [{ id: "variant-1", price: { basePriceInCents: 12990, currency: "BRL" }, stock: [{ quantity: 1, reserved: 1 }] }],
  }).getContent("demo", "product-1", "pt-BR");
  assert.equal(result.purchase.productName, "Produto indisponível");
  assert.equal(result.purchase.defaultVariantId, null);
  assert.equal(result.purchase.priceReais, 129.9);
  assert.equal(result.purchase.variants[0].available, false);
  assert.equal(result.purchase.variants[0].lowStock, false);
});

test("a variant without a catalog price cannot be selected for purchase", async () => {
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto", type: "physical",
    variants: [{ id: "variant-1", price: null, stock: [{ quantity: 10, reserved: 0 }] }],
  }).getContent("demo", "product-1", "pt-BR");
  assert.equal(result.purchase.defaultVariantId, null);
  assert.equal(result.purchase.variants[0].available, false);
  assert.equal(result.purchase.priceReais, null);
});
