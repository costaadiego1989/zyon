import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { MerchantStoreService } from "./merchant-store.service.js";
import type { MerchantStoreRepository } from "../domain/ports/merchant-store.repository.port.js";

function repository(overrides: Partial<MerchantStoreRepository> = {}): MerchantStoreRepository {
  return {
    resolveBillingAccountMerchantId: async () => "account_store",
    findMembership: async () => ({ merchantId: "account_store", billingAccountMerchantId: "account_store", role: "owner" }),
    listStores: async () => [{ id: "account_store", name: "Loja principal", slug: "principal", role: "owner" }],
    createStore: async () => ({ status: "created", store: { id: "store_2", name: "Nova loja", slug: "nova-loja", role: "owner" } }),
    ...overrides,
  };
}

function billing(plan: "starter" | "growth" | "scale") {
  return { getEffectivePlan: async () => plan } as never;
}

test("only Scale owners can create an isolated additional store", async () => {
  const created: unknown[] = [];
  const service = new MerchantStoreService(repository({
    createStore: async (input) => {
      created.push(input);
      return { status: "created", store: { id: "store_2", name: input.name, slug: input.slug, role: "owner" } };
    },
  }), billing("scale"));

  const store = await service.create({
    actor: { userId: "user_1", merchantId: "account_store", role: "owner" },
    name: "  Nova loja  ",
    slug: " Nova Loja ",
  });

  assert.deepEqual(store, { id: "store_2", name: "Nova loja", slug: "nova-loja", role: "owner" });
  assert.deepEqual(created, [{ accountMerchantId: "account_store", actorUserId: "user_1", name: "Nova loja", slug: "nova-loja" }]);
});

test("Growth cannot create a second store", async () => {
  const service = new MerchantStoreService(repository(), billing("growth"));

  await assert.rejects(
    () => service.create({ actor: { userId: "user_1", merchantId: "account_store", role: "owner" }, name: "Nova", slug: "nova" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "multi_store_requires_scale",
  );
});

test("a member can activate only a store in the same billing account", async () => {
  const service = new MerchantStoreService(repository({
    findMembership: async (_userId, merchantId) => merchantId === "store_2"
      ? { merchantId, billingAccountMerchantId: "account_store", role: "staff" }
      : undefined,
  }), billing("scale"));

  const active = await service.activate({ userId: "user_1", merchantId: "account_store", role: "owner" }, "store_2");
  assert.deepEqual(active, { merchantId: "store_2", role: "staff" });

  await assert.rejects(
    () => service.activate({ userId: "user_1", merchantId: "account_store", role: "owner" }, "other_account_store"),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "merchant_store_access_denied",
  );
});

test("the repository capacity result is reported without creating a sixth store", async () => {
  const service = new MerchantStoreService(repository({ createStore: async () => ({ status: "capacity_reached" }) }), billing("scale"));

  await assert.rejects(
    () => service.create({ actor: { userId: "user_1", merchantId: "account_store", role: "owner" }, name: "Sexta", slug: "sexta" }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string; limit: number }).code === "multi_store_limit_reached" && (error.getResponse() as { limit: number }).limit === 5,
  );
});
