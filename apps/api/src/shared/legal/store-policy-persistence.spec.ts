import assert from "node:assert/strict";
import test from "node:test";
import { PrismaMerchantRepository } from "../../modules/merchant/infrastructure/prisma-merchant.repository.js";
import { PrismaPolicyRepository } from "../../modules/knowledge-base/infrastructure/repositories/prisma-policy.repository.js";

function database() {
  let state = {
    storeSettings: { company: { razaoSocial: "Fornecedor" }, policies: { privacy: "Privacidade própria", returns: "Devolução vigente", shipping: "Envio vigente" } },
    legacy: { returns: "Devolução anterior", shipping: "Envio anterior", warranty: "Garantia cadastrada", payment: null, general: null },
    deletedChunks: [] as string[],
  };
  let failDelete = false;
  const assertMerchant = (id: string) => assert.equal(id, "store-own");
  const prisma = {
    merchant: {
      findUnique: async ({ where }: any) => { assertMerchant(where.id); return { storeSettings: structuredClone(state.storeSettings), name: "Loja", users: [] }; },
      update: async ({ where, data }: any) => { assertMerchant(where.id); state.storeSettings = structuredClone(data.storeSettings); return {}; },
    },
    merchantPolicy: {
      findUnique: async ({ where }: any) => { assertMerchant(where.merchantId); return structuredClone(state.legacy); },
      upsert: async ({ where, update }: any) => { assertMerchant(where.merchantId); state.legacy = { ...state.legacy, ...update }; return structuredClone(state.legacy); },
    },
    knowledgeChunk: { deleteMany: async ({ where }: any) => {
      assertMerchant(where.merchantId);
      assert.equal(where.sourceType, "policy");
      if (failDelete) throw new Error("chunk deletion failed");
      state.deletedChunks.push(...where.sourceId.in);
      return { count: 1 };
    } },
    $transaction: async (run: (tx: any) => Promise<any>) => {
      const original = structuredClone(state);
      try { return await run(prisma); } catch (error) { state = original; throw error; }
    },
  };
  return { prisma, read: () => structuredClone(state), fail: () => { failDelete = true; } };
}

test("clearing a dashboard policy removes the previous AI answer and preserves unrelated texts", async () => {
  const db = database();
  const settings = new PrismaMerchantRepository(db.prisma as never);
  const knowledge = new PrismaPolicyRepository(db.prisma as never);
  await settings.updateStoreSettings("store-own", { policies: { returns: "" } });
  assert.equal((await settings.getStoreSettings("store-own")).policies?.returns, "");
  const current = await knowledge.get("store-own");
  assert.equal(current?.returns, null);
  assert.equal(current?.shipping, "Envio vigente");
  assert.equal(current?.warranty, "Garantia cadastrada");
  assert.equal(db.read().storeSettings.policies.privacy, "Privacidade própria");
  assert.deepEqual(db.read().deletedChunks, ["returns"]);
});

test("a partial knowledge edit updates the shared policy without erasing other fields", async () => {
  const db = database();
  const knowledge = new PrismaPolicyRepository(db.prisma as never);
  const saved = await knowledge.upsert("store-own", { shipping: "Envio atualizado" });
  assert.equal(saved.shipping, "Envio atualizado");
  assert.equal(saved.returns, "Devolução vigente");
  assert.equal(saved.warranty, "Garantia cadastrada");
  assert.equal(db.read().storeSettings.policies.shipping, "Envio atualizado");
  assert.equal(db.read().storeSettings.policies.privacy, "Privacidade própria");
  assert.deepEqual(db.read().deletedChunks, ["shipping"]);
});

test("editing a different policy preserves the published external returns link in the response", async () => {
  const db = database();
  const { returns: _returns, ...policies } = db.read().storeSettings.policies;
  await db.prisma.merchant.update({ where: { id: "store-own" }, data: { storeSettings: {
    ...db.read().storeSettings, policies, checkoutPolicyLinks: { refundUrl: "https://loja.example/devolucoes" },
  } } });
  const knowledge = new PrismaPolicyRepository(db.prisma as never);
  const before = await knowledge.get("store-own");
  const saved = await knowledge.upsert("store-own", { warranty: "Garantia atualizada" });
  assert.equal(before?.returns, "https://loja.example/devolucoes");
  assert.equal(saved.returns, before?.returns);
  assert.equal(saved.warranty, "Garantia atualizada");
});

test("a failed policy publish rolls back the store and knowledge source together", async () => {
  const db = database();
  const before = db.read();
  db.fail();
  await assert.rejects(new PrismaMerchantRepository(db.prisma as never).updateStoreSettings("store-own", { policies: { shipping: "Nova" } }), /chunk deletion failed/);
  assert.deepEqual(db.read(), before);
});

test("a failed knowledge publish never leaves a partially updated public store policy", async () => {
  const db = database();
  const before = db.read();
  db.fail();
  await assert.rejects(new PrismaPolicyRepository(db.prisma as never).upsert("store-own", { shipping: "Nova" }), /chunk deletion failed/);
  assert.deepEqual(db.read(), before);
});
