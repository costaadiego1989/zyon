import assert from "node:assert/strict";
import test from "node:test";
import { PrismaMerchantStoreRepository } from "./prisma-merchant-store.repository.js";

const storeProfile = { cnpj: "11444777000161", email: "contato@nova-loja.example", phone: "11999999999", storeCategory: "electronics" };

test("creating a managed store persists no payment, WhatsApp, catalog, or integration configuration", async () => {
  const createdMerchants: Array<Record<string, unknown>> = [];
  const memberships: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      $queryRaw: async () => undefined,
      merchant: {
        count: async () => 1,
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdMerchants.push(data);
          return { id: "store_2", name: data.name, storeSlug: data.storeSlug };
        },
      },
      merchantTeamMember: {
        upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
          memberships.push({ where, create, update });
        },
      },
    }),
  } as never;
  const repository = new PrismaMerchantStoreRepository(prisma);

  const result = await repository.createStore({ accountMerchantId: "account_store", actorUserId: "user_1", name: "Nova loja", slugBase: "nova-loja", profile: storeProfile });

  assert.equal(result.status, "created");
  assert.deepEqual(Object.keys(createdMerchants[0]!).sort(), ["billingAccountMerchantId", "id", "name", "plan", "storeCategory", "storeSettings", "storeSlug"]);
  assert.equal(createdMerchants[0]?.storeCategory, "electronics");
  assert.deepEqual(createdMerchants[0]?.storeSettings, {
    created_from_multi_store: true,
    company: { razaoSocial: "Nova loja", cnpj: "11444777000161", email: "contato@nova-loja.example", phone: "11999999999" },
  });
  for (const forbiddenRelation of ["paymentConnections", "stripeConnectAccountId", "whatsappChannelConfig", "commerceConnection", "billingSubscription", "theme", "catalog", "integrations"]) {
    assert.equal(forbiddenRelation in createdMerchants[0]!, false, `${forbiddenRelation} must not be copied`);
  }
  assert.deepEqual(memberships, [{
    where: { merchantId_userId: { merchantId: "store_2", userId: "user_1" } },
    create: { merchantId: "store_2", userId: "user_1", role: "OWNER" },
    update: { role: "OWNER" },
  }]);
});

test("creating a managed store reserves the next URL suffix when the name slug is in use", async () => {
  const createdMerchants: Array<Record<string, unknown>> = [];
  const prisma = {
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({
      $queryRaw: async () => undefined,
      merchant: {
        count: async () => 1,
        findUnique: async ({ where }: { where: { storeSlug: string } }) => where.storeSlug === "cenebelo" ? { id: "existing_store" } : null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          createdMerchants.push(data);
          return { id: "store_2", name: data.name, storeSlug: data.storeSlug };
        },
      },
      merchantTeamMember: { upsert: async () => undefined },
    }),
  } as never;
  const repository = new PrismaMerchantStoreRepository(prisma);

  const result = await repository.createStore({ accountMerchantId: "account_store", actorUserId: "user_1", name: "Cenebelo", slugBase: "cenebelo", profile: storeProfile });

  assert.equal(result.status, "created");
  assert.equal(createdMerchants[0]?.storeSlug, "cenebelo-2");
});
