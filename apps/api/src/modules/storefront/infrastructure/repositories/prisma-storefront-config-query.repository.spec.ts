import assert from "node:assert/strict";
import test from "node:test";
import { PrismaStorefrontConfigQueryRepository } from "./prisma-storefront-config-query.repository.js";

test("resolves a verified custom domain before a store slug", async () => {
  const merchantCalls: unknown[] = [];
  const repository = new PrismaStorefrontConfigQueryRepository({
    merchantDomain: { findUnique: async () => ({ merchantId: "merchant_a", verified: true }) },
    merchant: {
      findUnique: async (input: unknown) => {
        merchantCalls.push(input);
        return { id: "merchant_a", name: "Loja", theme: {}, storeCategory: null, storeSettings: {} };
      },
    },
    merchantBillingSubscription: { findUnique: async () => ({ status: "active" }) },
    agentRule: { findFirst: async () => ({ identity: {}, checkoutSettings: {} }) },
    merchantRule: { findUnique: async () => ({ quickReplies: { welcome: ["Olá"] } }) },
    storyCategory: { findMany: async () => [{ id: "story_a" }] },
  } as never);

  const config = await repository.findPublicConfig("loja.exemplo.com");
  assert.equal(config?.merchant.id, "merchant_a");
  assert.deepEqual(merchantCalls, [{ where: { id: "merchant_a" } }]);
  assert.equal(config?.subscriptionStatus, "active");
  assert.deepEqual(config?.stories, [{ id: "story_a" }]);
});

test("does not resolve an unverified domain as a store", async () => {
  const repository = new PrismaStorefrontConfigQueryRepository({
    merchantDomain: { findUnique: async () => ({ merchantId: "merchant_a", verified: false }) },
    merchant: { findUnique: async () => null },
  } as never);
  assert.equal(await repository.findPublicConfig("loja.exemplo.com"), null);
});
