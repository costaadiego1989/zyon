import assert from "node:assert/strict";
import test from "node:test";
import { ProductEntity } from "../../../catalog/domain/entities/product.entity.js";
import { createWishlistHandlers } from "./wishlist.handlers.js";

const saved: Array<{ merchantId: string; ownerKey: string; productId: string; createdAt: Date }> = [];
const product = new ProductEntity({
  id: "product_1",
  merchantId: "merchant_1",
  name: "Mochila essencial",
  isActive: true,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  variants: [{
    id: "variant_1",
    sku: "mochila-1",
    attributes: {},
    isActive: true,
    basePriceInCents: 15900,
    taxPercent: 0,
    currency: "BRL",
    stockQuantity: 3,
    stockReserved: 0,
    media: [],
  }],
});

function handlersForSession(sessionId: string) {
  return createWishlistHandlers({
    prisma: {
      storefrontWishlistItem: {
        upsert: async ({ where, create }: any) => {
          const key = where.merchantId_ownerKey_productId;
          if (!saved.some((item) => item.merchantId === key.merchantId && item.ownerKey === key.ownerKey && item.productId === key.productId)) {
            saved.push({ ...create, createdAt: new Date() });
          }
        },
        findMany: async ({ where }: any) => saved
          .filter((item) => item.merchantId === where.merchantId && where.ownerKey.in.includes(item.ownerKey))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        deleteMany: async ({ where }: any) => {
          for (let index = saved.length - 1; index >= 0; index -= 1) {
            const item = saved[index]!;
            if (item.merchantId === where.merchantId && where.ownerKey.in.includes(item.ownerKey) && item.productId === where.productId) saved.splice(index, 1);
          }
        },
      },
    },
    productRepo: { findById: async () => product },
  } as never, { merchantId: "merchant_1", sessionId });
}

test("persists, lists and removes wishlist products within the conversation tenant scope", async () => {
  saved.length = 0;
  const handlers = handlersForSession("conversation_1");

  const added = await handlers.addToWishlist({ productId: product.id }) as { items: Array<{ id: string }> };
  assert.deepEqual(added.items.map((item) => item.id), [product.id]);

  const otherConversation = await handlersForSession("conversation_2").getWishlist() as { items: unknown[] };
  assert.equal(otherConversation.items.length, 0);

  const removed = await handlers.removeFromWishlist({ productId: product.id }) as { items: unknown[] };
  assert.equal(removed.items.length, 0);
});
