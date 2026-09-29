import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaStorefrontTelemetryRepository } from "./prisma-storefront-telemetry.repository.js";

test("storefront recovery telemetry binds the authenticated buyer, cart and abandonment score", async () => {
  let session: any;
  const persistedEvents: any[] = [];
  const updates: any[] = [];
  const prisma = {
    checkoutSession: {
      async upsert({ create, update }: any) {
        if (!session) {
          session = { ...create };
        } else {
          session = { ...session, ...update };
        }
        return session;
      },
      async update({ data }: any) {
        updates.push(data);
        session = { ...session, ...data };
        return session;
      },
      async findMany() { return []; },
    },
    checkoutEvent: {
      async findFirst({ where }: any) {
        return persistedEvents.find((event) => event.merchantId === where.merchantId
          && event.sessionId === where.sessionId && event.eventName === where.eventName) ?? null;
      },
      async create({ data }: any) { persistedEvents.push(data); return data; },
    },
    promptExperiment: { async findFirst() { return null; } },
  } as unknown as PrismaClient;
  const carts = {
    async getOrCreate(merchantId: string, sessionId: string) {
      return {
        id: "cart-1", merchantId, sessionId,
        items: [{ variantId: "sku-1", productId: "product-1", name: "Núcleo", sku: "N-1", quantity: 1, unitPriceCents: 9900 }],
        couponCode: null, discount: 0, freeShipping: false, total: 9900,
        createdAt: new Date(), updatedAt: new Date(),
      };
    },
  };
  const repository = new PrismaStorefrontTelemetryRepository(prisma, carts as any);

  await repository.recordEvent({
    merchantId: "merchant-a",
    conversationId: "conversation-a",
    globalUserId: "buyer-a",
    event: "checkout_abandoned",
  });

  assert.equal(session.globalUserId, "buyer-a");
  assert.equal(session.cart.items.length, 1);
  assert.equal(session.abandonmentScore, 0.55);
  assert.equal(session.triggerAgent, true);
  assert.equal(persistedEvents[0].eventName, "checkout_abandoned");
  assert.deepEqual(updates[0], { abandonmentScore: 0.55, triggerAgent: true });
});
