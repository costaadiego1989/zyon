import assert from "node:assert/strict";
import test from "node:test";
import { PrismaStorefrontConfigQueryRepository } from "./prisma-storefront-config-query.repository.js";

test("resolves a verified custom domain before a store slug", async () => {
  const merchantCalls: unknown[] = [];
  const repository = new PrismaStorefrontConfigQueryRepository({
    merchantDomain: { findUnique: async () => ({ merchantId: "merchant_a", verified: true, ownershipVerifiedAt: new Date() }) },
    merchant: {
      findUnique: async (input: unknown) => {
        merchantCalls.push(input);
        return { id: "merchant_a", name: "Loja", theme: {}, storeCategory: null, storeSettings: {} };
      },
    },
    merchantBillingSubscription: {
      findUnique: async () => ({ status: "active", trialEndsAt: null, stripePriceId: null, planKey: "growth" }),
    },
    checkoutSetting: { findUnique: async () => ({ mode: "manual_only" }) },
    agentRule: { findFirst: async () => ({ identity: {}, checkoutSettings: {} }) },
    merchantRule: { findUnique: async () => ({ quickReplies: { welcome: ["Olá"] } }) },
    merchantPolicy: { findUnique: async () => null },
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

test("does not resolve a verified custom domain after its Growth entitlement ends", async () => {
  const repository = new PrismaStorefrontConfigQueryRepository({
    merchantDomain: { findUnique: async () => ({ merchantId: "merchant_a", verified: true, ownershipVerifiedAt: new Date() }) },
    merchantBillingSubscription: {
      findUnique: async () => ({ status: "active", trialEndsAt: null, stripePriceId: null, planKey: "starter" }),
    },
    merchant: { findUnique: async () => null },
  } as never);

  assert.equal(await repository.findPublicConfig("loja.exemplo.com"), null);
});

for (const unavailable of [false, true]) {
  test(`public policy lookup ${unavailable ? "reports a database failure without hiding the store" : "uses current settings and suppresses removed legacy text"}`, async () => {
    const repository = new PrismaStorefrontConfigQueryRepository({
      merchant: { findUnique: async () => ({ id: "merchant_a", name: "Loja", storeSettings: { policies: { shipping: "", returns: "Texto vigente" }, checkoutPolicyLinks: { privacyUrl: "https://supplier.example/privacy" } } }) },
      merchantBillingSubscription: { findUnique: async () => null },
      agentRule: { findFirst: async () => null },
      merchantRule: { findUnique: async () => null },
      checkoutSetting: { findUnique: async () => null },
      storyCategory: { findMany: async () => [] },
      merchantPolicy: { findUnique: async () => { if (unavailable) throw new Error("database unavailable"); return { returns: "Texto antigo", shipping: "Prazo antigo", warranty: "Garantia publicada" }; } },
    } as never);
    const config = await repository.findPublicConfig("loja");
    assert.equal(config?.merchant.id, "merchant_a");
    assert.equal(config?.policiesAvailable, !unavailable);
    assert.equal(config?.publishedPolicies?.returns, "Texto vigente");
    assert.equal(config?.publishedPolicies?.shipping, undefined);
    assert.equal(config?.publishedPolicies?.privacy, "https://supplier.example/privacy");
    assert.equal(config?.publishedPolicies?.warranty, unavailable ? undefined : "Garantia publicada");
  });
}
