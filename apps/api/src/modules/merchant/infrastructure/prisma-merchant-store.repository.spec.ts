import assert from "node:assert/strict";
import test from "node:test";
import { PrismaMerchantStoreRepository } from "./prisma-merchant-store.repository.js";

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
      merchantTeamMember: { create: async ({ data }: { data: Record<string, unknown> }) => { memberships.push(data); } },
    }),
  } as never;
  const repository = new PrismaMerchantStoreRepository(prisma);

  const result = await repository.createStore({ accountMerchantId: "account_store", actorUserId: "user_1", name: "Nova loja", slug: "nova-loja" });

  assert.equal(result.status, "created");
  assert.deepEqual(Object.keys(createdMerchants[0]!).sort(), ["billingAccountMerchantId", "id", "name", "plan", "storeSettings", "storeSlug"]);
  for (const forbiddenRelation of ["paymentConnections", "stripeConnectAccountId", "whatsappChannelConfig", "commerceConnection", "billingSubscription", "theme", "catalog", "integrations"]) {
    assert.equal(forbiddenRelation in createdMerchants[0]!, false, `${forbiddenRelation} must not be copied`);
  }
  assert.deepEqual(memberships, [{ merchantId: "store_2", userId: "user_1", role: "OWNER" }]);
});
