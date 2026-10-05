import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
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

const storeProfile = {
  cnpj: "11.444.777/0001-61",
  email: "contato@nova-loja.example",
  phone: "(11) 99999-9999",
  storeCategory: "electronics",
};

test("only Scale owners can create an isolated additional store with a name-derived slug", async () => {
  const created: unknown[] = [];
  const service = new MerchantStoreService(repository({
    createStore: async (input) => {
      created.push(input);
      return { status: "created", store: { id: "store_2", name: input.name, slug: input.slugBase, role: "owner" } };
    },
  }), billing("scale"));

  const store = await service.create({
    actor: { userId: "user_1", merchantId: "account_store", role: "owner" },
    name: "  Nova loja  ",
    ...storeProfile,
  });

  assert.deepEqual(store, { id: "store_2", name: "Nova loja", slug: "nova-loja", role: "owner" });
  assert.deepEqual(created, [{
    accountMerchantId: "account_store",
    actorUserId: "user_1",
    name: "Nova loja",
    slugBase: "nova-loja",
    profile: { cnpj: "11444777000161", email: "contato@nova-loja.example", phone: "11999999999", storeCategory: "electronics" },
  }]);
});

test("requires a valid commercial profile for the new store", async () => {
  const service = new MerchantStoreService(repository(), billing("scale"));
  await assert.rejects(
    () => service.create({ actor: { userId: "user_1", merchantId: "account_store", role: "owner" }, name: "Nova loja", ...storeProfile, cnpj: "11.111.111/1111-11" }),
    (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code: string }).code === "merchant_store_cnpj_invalid",
  );
  await assert.rejects(
    () => service.create({ actor: { userId: "user_1", merchantId: "account_store", role: "owner" }, name: "Nova loja", ...storeProfile, storeCategory: "invalid" }),
    (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code: string }).code === "merchant_store_category_invalid",
  );
});

test("Growth cannot create a second store", async () => {
  const service = new MerchantStoreService(repository(), billing("growth"));
  await assert.rejects(
    () => service.create({ actor: { userId: "user_1", merchantId: "account_store", role: "owner" }, name: "Nova", ...storeProfile }),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "multi_store_requires_scale",
  );
});

test("a member can activate only a store in the same billing account", async () => {
  const service = new MerchantStoreService(repository({
    findMembership: async (_userId, merchantId) => merchantId === "store_2"
      ? { merchantId, billingAccountMerchantId: "account_store", role: "staff" }
      : undefined,
  }), billing("scale"));

  assert.deepEqual(
    await service.activate({ userId: "user_1", merchantId: "account_store", role: "owner" }, "store_2"),
    { merchantId: "store_2", role: "staff" },
  );
  await assert.rejects(
    () => service.activate({ userId: "user_1", merchantId: "account_store", role: "owner" }, "other_account_store"),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "merchant_store_access_denied",
  );
});

test("activation rejects a repository result silently scoped to the previous store", async () => {
  const service = new MerchantStoreService(repository(), billing("scale"));
  await assert.rejects(
    () => service.activate({ userId: "user_1", merchantId: "account_store", role: "owner" }, "store_2"),
    (error: unknown) => error instanceof ForbiddenException && (error.getResponse() as { code: string }).code === "merchant_store_access_denied",
  );
});
