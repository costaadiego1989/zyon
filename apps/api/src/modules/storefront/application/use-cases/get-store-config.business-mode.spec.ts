import assert from "node:assert/strict";
import test from "node:test";
import { GetStoreConfigUseCase } from "./get-store-config.use-case.js";
import { PrismaStorefrontConfigQueryRepository } from "../../infrastructure/repositories/prisma-storefront-config-query.repository.js";

const originalProductReplies = ["Ver Produtos", "Encontrar Produto", "Categorias", "Prazo de Entrega", "Trocas e Devolu\u00e7\u00f5es", "Rastrear Pedido", "Meus Dados", "Ofertas"];
const serviceReplies = ["Quais servi\u00e7os voc\u00eas oferecem?", "Quais profissionais e hor\u00e1rios est\u00e3o dispon\u00edveis?", "Meus Dados", "Falar com Humano"];
function fixture(businessMode: unknown) {
  const snapshot: any = { merchant: { id: "merchant", name: "Canonical company", businessMode, theme: {},
    storeCategory: "services", storeSettings: { businessMode: "services", company: { businessMode: "services" } } }, stories: [] };
  const useCase = new GetStoreConfigUseCase({ findPublicConfig: async () => snapshot, findMerchantConfig: async () => snapshot });
  return { snapshot, useCase };
}

test("C59 public config exposes canonical service mode with service-only default navigation", async () => {
  const f = fixture("services"); f.snapshot.merchant.storeCategory = "fashion";
  const config = await f.useCase.execute("store");
  assert.equal(config.businessMode, "services"); assert.deepEqual(config.quickReplies, serviceReplies);
  assert.equal(config.agentGreeting, undefined, "a default must not overwrite a merchant-authored greeting");
  assert.equal(config.quickReplies!.some(label => /produto|entrega|pedido|frete/i.test(label)), false);
  assert.equal(config.agentMode, "silent_until_trigger"); assert.equal(config.voiceCheckoutEnabled, false);
});

test("C59 product and legacy defaults remain exact without inferring service mode from category or settings", async () => {
  for (const mode of ["products", undefined, "unknown", "Services"]) {
    const f = fixture(mode), config = await f.useCase.execute("store");
    assert.deepEqual(config.quickReplies, originalProductReplies);
    assert.equal(config.businessMode, mode === "products" ? "products" : undefined);
    assert.equal(Object.hasOwn(config, "businessMode"), mode === "products");
    assert.equal(config.agentGreeting, undefined); assert.equal(config.budgetModeEnabled, false);
  }
});

test("C59 configured welcome replies and custom greetings retain priority in both canonical modes", async () => {
  for (const mode of ["services", "products"]) {
    const f = fixture(mode), custom = ["Meu atalho", "Entrega combinada pela equipe"];
    f.snapshot.agentRule = { identity: { agentName: "Lia", greeting: "Mensagem exata da empresa", tone: "premium" }, checkoutSettings: {} };
    f.snapshot.quickReplies = { welcome: custom };
    f.snapshot.merchant.storeSettings.quick_replies = { stages: [{ stage: "welcome", replies: ["Legacy loses precedence"] }] };
    const config = await f.useCase.execute("store");
    assert.equal(config.businessMode, mode); assert.deepEqual(config.quickReplies, custom);
    assert.equal(config.agentGreeting, "Mensagem exata da empresa"); assert.equal(config.agentName, "Lia"); assert.equal(config.agentTone, "premium");
  }
});

test("C59 legacy welcome customization remains intact when the new welcome list is empty", async () => {
  for (const mode of ["services", "products", undefined]) {
    const f = fixture(mode), legacy = ["Atalho legado", "Outro atalho"];
    f.snapshot.quickReplies = { welcome: [] };
    f.snapshot.merchant.storeSettings.quick_replies = { stages: [{ stage: "welcome", replies: legacy }] };
    assert.deepEqual((await f.useCase.executeForMerchant("merchant")).quickReplies, legacy);
  }
});

test("C59 the actual config query projection supplies canonical mode on slug and connected-merchant paths", async () => {
  const calls: unknown[] = [];
  const repository = new PrismaStorefrontConfigQueryRepository({
    merchant: { findUnique: async (query: unknown) => { calls.push(query); return { id: "merchant", name: "Canonical service company", businessMode: "services",
      theme: {}, storeCategory: "fashion", storeSettings: {} }; } },
    merchantBillingSubscription: { findUnique: async () => null }, merchantRule: { findUnique: async () => null },
    storyCategory: { findMany: async () => [] }, checkoutSetting: { findUnique: async () => null }, merchantPolicy: { findUnique: async () => null },
  } as never, { findForMerchant: async () => null });
  const useCase = new GetStoreConfigUseCase(repository);
  for (const config of [await useCase.execute("service-store"), await useCase.executeForMerchant("merchant")]) {
    assert.equal(config.businessMode, "services"); assert.deepEqual(config.quickReplies, serviceReplies);
  }
  assert.deepEqual(calls, [{ where: { storeSlug: "service-store" } }, { where: { id: "merchant" } }]);
});
