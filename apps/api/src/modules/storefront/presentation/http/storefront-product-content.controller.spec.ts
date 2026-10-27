import { test } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { StorefrontProductContentController } from "./storefront-product-content.controller.js";
import { PublicProductCrossSellPreview } from "../../application/services/public-product-cross-sell-preview.js";

function makeController(product: unknown, onProductQuery?: (query: unknown) => void, preCart?: {
  promotions: unknown[];
  variants: unknown[];
}, plan: "growth" | "starter" = "growth", suggest?: PublicProductCrossSellPreview["suggest"]) {
  const prisma = {
    merchant: { findFirst: async () => ({
      id: "merchant-1",
      storeSlug: "demo",
      storeSettings: preCart ? {
        crossSell: {
          enabled: true,
          touchpoints: { pre_cart: true },
          strategies: ["complementary"],
          limits: { maxSuggestionsPerSession: 2 },
          display: { mode: "modal" },
        },
      } : undefined,
    }) },
    product: { findFirst: async (query: unknown) => {
      onProductQuery?.(query);
      return product;
    } },
    crossSellPromotion: { findMany: async () => preCart?.promotions ?? [] },
    productVariant: { findMany: async () => preCart?.variants ?? [] },
    checkoutSetting: { findUnique: async () => ({ advancedRules: [] }) },
  } as unknown as PrismaClient;
  const content = { execute: async () => ({ locale: "pt-BR", blocks: [], faqs: [], testimonials: [], videos: [] }) };
  const billing = { getEffectivePlan: async () => plan };
  const preview = new PublicProductCrossSellPreview(prisma, {
    createCatalog: () => ({ sameCategory: async () => [], cartValueUpgrade: async () => [] }),
    createCoOccurrence: () => ({ recommend: async () => [] }),
  });
  if (suggest) preview.suggest = suggest;
  return new StorefrontProductContentController(prisma, content as never, billing as never, preview);
}

test("public rich content exposes display prices, variants and media without internal costs or stock counts", async () => {
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto", description: "Descrição pública",
    type: "physical", metadata: { demo: true },
    variants: [
      { id: "small", sku: "CANONICAL-SMALL", attributes: { size: "30 ml" }, price: { basePriceInCents: 12990, currency: "BRL" }, stock: [{ quantity: 3, reserved: 1 }], media: [{ url: "https://example.com/product.jpg", alt: "Produto" }] },
      { id: "large", sku: "CANONICAL-LARGE", attributes: { size: "50 ml" }, price: { basePriceInCents: 18990, currency: "BRL" }, stock: [{ quantity: 24, reserved: 0 }], media: [] },
    ],
  }).getContent("demo", "product-1", "pt-BR");

  assert.equal(result.purchase.productName, "Produto");
  assert.equal(Object.hasOwn(result.purchase, "ruleNotices"), false);
  assert.equal(result.purchase.description, "Descrição pública");
  assert.equal(result.purchase.defaultVariantId, "small");
  assert.equal(result.purchase.priceReais, 129.9);
  assert.equal(result.purchase.variants[0].lowStock, true);
  assert.equal(result.purchase.variants[1].lowStock, false);
  assert.equal(result.purchase.variants[1].priceReais, 189.9);
  assert.deepEqual(result.purchase.variants.map(variant => ({ id: variant.id, sku: variant.sku })), [
    { id: "small", sku: "CANONICAL-SMALL" }, { id: "large", sku: "CANONICAL-LARGE" },
  ]);
  assert.deepEqual(result.purchase.images, [{ src: "https://example.com/product.jpg", alt: "Produto", variantId: "small" }]);
  assert.equal(result.purchase.isDemo, true);
  assert.equal(JSON.stringify(result.purchase).includes("InCents"), false);
  assert.equal(JSON.stringify(result.purchase).includes("availableQuantity"), false);
});

test("public rich content delegates its scoped read-only preview to the injected service", async () => {
  const calls: Parameters<PublicProductCrossSellPreview["suggest"]>[] = [];
  const expected = { trigger: "Complementos para este produto", displayMode: "modal", products: [{
    id: "companion", name: "Complemento", price: 25, priceFormatted: "R$ 25,00", inStock: true,
  }] };
  const controller = makeController({ id: "product-scoped", merchantId: "merchant-1", name: "Produto", type: "digital",
    category: { name: "Category" }, variants: [{ id: "variant", sku: "PRIMARY", price: { basePriceInCents: 1000, currency: "BRL" }, stock: [] }],
  }, query => assert.deepEqual((query as { where: unknown }).where, {
    id: "product-scoped", merchantId: "merchant-1", isActive: true, deletedAt: null,
  }), { promotions: [], variants: [] }, "growth", async (...args) => {
    calls.push(args);
    return expected;
  });
  const result = await controller.getContent("demo", "product-scoped");
  assert.deepEqual(result.crossSell, expected);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["merchant-1", { crossSell: {
    enabled: true, touchpoints: { pre_cart: true }, strategies: ["complementary"],
    limits: { maxSuggestionsPerSession: 2 }, display: { mode: "modal" },
  } }, ["PRIMARY"], "Category"]);
});

test("public rich content never invokes the preview before entitlement and product scope guards", async () => {
  let calls = 0;
  const suggest: PublicProductCrossSellPreview["suggest"] = async () => { calls += 1; return undefined; };
  const denied = makeController(null, () => assert.fail("Denied plan must not query a product"), undefined, "starter", suggest);
  await assert.rejects(denied.getContent("demo", "product"), /Not Found/);
  const missing = makeController(null, undefined, undefined, "growth", suggest);
  await assert.rejects(missing.getContent("demo", "product"), /Not Found/);
  assert.equal(calls, 0);
});

test("public rich content exposes the selected product SEO for share metadata", async () => {
  let productQuery: any;
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto", type: "digital",
    seoTitle: "Titulo SEO", metaDescription: "Descricao SEO", ogTitle: "Titulo Open Graph",
    ogDescription: "Descricao Open Graph", twitterCard: "summary", keywords: ["produto", "seo"],
    variants: [{ id: "variant-1", attributes: {}, price: { basePriceInCents: 12990, currency: "BRL" }, stock: [] }],
  }, (query) => { productQuery = query; }).getContent("demo", "product-1", "pt-BR");

  assert.deepEqual(result.purchase.seo, {
    title: "Titulo SEO",
    description: "Descricao SEO",
    ogTitle: "Titulo Open Graph",
    ogDescription: "Descricao Open Graph",
    twitterCard: "summary",
    keywords: ["produto", "seo"],
  });
  assert.equal(productQuery.select.seoTitle, true);
  assert.equal(productQuery.select.metaDescription, true);
  assert.equal(productQuery.select.ogTitle, true);
  assert.equal(productQuery.select.ogDescription, true);
  assert.equal(productQuery.select.twitterCard, true);
  assert.equal(productQuery.select.keywords, true);
});

test("public rich content exposes food choices and the catalog display price", async () => {
  const result = await makeController({
    id: "food", merchantId: "merchant-1", name: "Pizza", type: "food",
    metadata: { optionGroups: [{ id: "size", name: "Tamanho", required: true, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 700 }] }] },
    variants: [{ id: "food-variant", attributes: {}, price: { basePriceInCents: 3990, currency: "BRL" }, stock: [{ quantity: 10, reserved: 0 }] }],
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

test("public rich content exposes the configured pre-cart offer without creating a cart", async () => {
  const result = await makeController({
    id: "product-1", merchantId: "merchant-1", name: "Produto", type: "digital",
    variants: [{ id: "primary-variant", sku: "PRIMARY", attributes: {}, price: { basePriceInCents: 12990, currency: "BRL" }, stock: [] }],
  }, undefined, {
    promotions: [{ id: "promo-1", trigger: { sku_in_cart: ["PRIMARY"] }, recommendedSkus: ["COMPANION"], discountPercent: 10 }],
    variants: [{
      id: "companion-variant", sku: "COMPANION", price: { basePriceInCents: 8990 }, media: [{ url: "https://example.com/companion.jpg" }], stock: [],
      product: { name: "Complemento", type: "digital" },
    }],
  }).getSharedProduct("demo", "product-1", "pt-BR");

  assert.equal(result.crossSell?.trigger, "Complementos para este produto");
  assert.equal(result.crossSell?.products[0]?.id, "companion-variant");
  assert.equal(result.crossSell?.products[0]?.discountPercent, 10);
  assert.equal(result.crossSell?.products[0]?.promoId, "promo-1");
});

test("share links expose only the public purchase when editorial content is unavailable in the plan", async () => {
  const controller = makeController({ id: "product-1", merchantId: "merchant-1", name: "Produto", type: "digital",
    variants: [{ id: "variant-1", attributes: {}, price: { basePriceInCents: 1000, currency: "BRL" }, stock: [] }] }, undefined, undefined, "starter");
  await assert.rejects(controller.getContent("demo", "product-1"), /Not Found/);
  const shared = await controller.getSharedProduct("demo", "product-1");
  assert.equal(shared.purchase.productName, "Produto");
  assert.deepEqual(shared.blocks, []);
  assert.deepEqual(shared.videos, []);
  assert.equal(shared.purchase.priceReais, 10);
});
