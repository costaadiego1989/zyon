import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProductEntity, type ProductVariantProps } from "../../catalog/domain/entities/product.entity.js";
import { buildConversationBlocks } from "./agents/conversation-block.builder.js";
import { productGallery } from "./product-gallery.js";
import { resolveDeterministicShortcut, type DeterministicShortcutDeps } from "./shortcuts/deterministic-shortcuts.service.js";
import type { StorefrontConversationInput } from "../domain/ports/conversation.port.js";

const media = (url: string, order: number, type: "IMAGE" | "VIDEO" = "IMAGE") => ({ id: `${url}-${order}`, url, order, type });
const variant = (id: string, images: ProductVariantProps["media"], isActive = true): ProductVariantProps => ({
  id, sku: id, attributes: {}, isActive, basePriceInCents: 12990, currency: "BRL", taxPercent: 0,
  stockQuantity: 10, stockReserved: 0, media: images,
});
const product = new ProductEntity({
  id: "product-1", merchantId: "merchant-1", name: "Produto com galeria", isActive: true,
  createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
  variants: [
    variant("variant-1", [media("https://cdn.example/second.jpg", 2), media("https://cdn.example/movie.mp4", 0, "VIDEO"), media("https://cdn.example/first.jpg", 1)]),
    variant("variant-2", [media("https://cdn.example/first.jpg", 0), media("https://cdn.example/third.jpg", 1)]),
    variant("inactive-variant", [media("https://cdn.example/hidden.jpg", 0)], false),
  ],
});
const expectedImages = ["https://cdn.example/first.jpg", "https://cdn.example/second.jpg", "https://cdn.example/third.jpg"];

describe("Storefront product galleries", () => {
  it("keeps ordered photos from active variants, deduplicates and excludes videos without mutating catalog media", () => {
    const originalMedia = structuredClone(product.variants[0].media);
    assert.deepEqual(productGallery(product), { image: expectedImages[0], images: expectedImages });
    assert.deepEqual(product.variants[0].media, originalMedia);
    assert.deepEqual(productGallery({ variants: [] }), { image: undefined, images: [] });
  });

  it("keeps all photos and the continuation cursor in Ver Produtos", async () => {
    const productRepo: DeterministicShortcutDeps["productRepo"] = {
      search: async () => ({ products: [product], nextCursor: "next-product", total: 2 }),
      create: async () => product,
      findById: async () => product,
      findExistingVariantSkus: async () => [],
      update: async () => product,
      softDelete: async () => {},
      addVariant: async () => product.variants[0],
      listCategories: async () => [],
      updateVariantBySku: async () => null,
    };
    const copyService = {
      generateVariantCopy: async (_prompt: string | undefined, _instruction: string, fallback: string) => fallback,
    } as DeterministicShortcutDeps["copyService"];
    const output = await resolveDeterministicShortcut({
      productRepo,
      copyService,
      emitFunnelEvent: async () => {},
    }, {
      merchantId: "merchant-1", sessionId: "session-1", userMessage: "Ver Produtos",
    } as StorefrontConversationInput);
    const block = output?.blocks?.find((item) => item.type === "product_carousel");
    assert.ok(block && block.type === "product_carousel");
    assert.deepEqual(block.data.products[0].images, expectedImages);
    assert.equal(block.data.products[0].image, expectedImages[0]);
    assert.equal(block.data.products[0].price, 12990);
    assert.equal(block.data.nextCursor, "next-product");
    assert.equal(block.data.merchantId, "merchant-1");
  });

  it("preserves tool gallery data in search details, full details and daily deals", () => {
    const projected = { id: product.id, name: product.name, price: 12990, ...productGallery(product), inStock: true };
    for (const [toolResults, userMessage] of [
      [{ search_products: { products: [projected] } }, "Detalhes desse produto"],
      [{ get_product_details: { product: { ...projected, variants: product.variants } } }, "Detalhes"],
      [{ get_daily_deals: { deals: [projected] } }, "Ofertas"],
    ] as const) {
      const output = buildConversationBlocks({ toolResults, userMessage, merchantId: "merchant-1", finalContent: "" });
      const block = output.blocks[0];
      assert.ok(block.type === "product_card" || block.type === "product_carousel");
      const card = block.type === "product_card" ? block.data : block.data.products[0];
      assert.deepEqual(card.images, expectedImages);
      assert.equal(card.image, expectedImages[0]);
      assert.equal(card.price, 12990);
    }
  });
});
