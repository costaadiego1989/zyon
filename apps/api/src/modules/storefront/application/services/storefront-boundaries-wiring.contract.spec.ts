import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { Global, Module } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { AgentRuleReaderModule } from "../../../agent-rules/agent-rule-reader.module.js";
import { MERCHANT_AGENT_RULE_READER, type MerchantAgentRuleReaderPort } from "../../../agent-rules/domain/ports/merchant-agent-rule-reader.port.js";
import { CrossSellModule } from "../../../cross-sell/cross-sell.module.js";
import { CROSS_SELL_PREVIEW_STRATEGIES, type CrossSellPreviewStrategiesPort } from "../../../cross-sell/domain/ports/preview-strategies.port.js";
import { StorefrontModule } from "../../storefront.module.js";
import { PublicProductCrossSellPreview } from "./public-product-cross-sell-preview.js";

function productionPreviewProvider() {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StorefrontModule) as unknown[];
  const provider = providers.find((value): value is { provide: typeof PublicProductCrossSellPreview;
    useFactory: (prisma: PrismaClient, strategies: CrossSellPreviewStrategiesPort) => PublicProductCrossSellPreview; inject: symbol[] } =>
    Boolean(value && typeof value === "object" && "provide" in value && value.provide === PublicProductCrossSellPreview));
  assert.ok(provider, "Storefront must wire the required preview service");
  return provider;
}

function productionStrategiesProvider() {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, CrossSellModule) as unknown[];
  const provider = providers.find((value): value is { provide: typeof CROSS_SELL_PREVIEW_STRATEGIES;
    useFactory: (prisma: PrismaClient) => CrossSellPreviewStrategiesPort; inject: symbol[] } =>
    Boolean(value && typeof value === "object" && "provide" in value && value.provide === CROSS_SELL_PREVIEW_STRATEGIES));
  assert.ok(provider, "Cross-sell must bind the fresh-strategies factory");
  return provider;
}

test("storefront imports the provider-only reader and cross-sell module", () => {
  const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, StorefrontModule) as unknown[];
  assert.ok(imports.includes(AgentRuleReaderModule));
  assert.ok(imports.includes(CrossSellModule));
  const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, CrossSellModule) as unknown[];
  assert.ok(exports.includes(CROSS_SELL_PREVIEW_STRATEGIES));
});

test("production preview factories declare the exact existing Prisma and domain dependencies", () => {
  assert.deepEqual(productionPreviewProvider().inject, [PRISMA_CLIENT, CROSS_SELL_PREVIEW_STRATEGIES]);
  assert.deepEqual(productionStrategiesProvider().inject, [PRISMA_CLIENT]);
});

test("real Nest resolves production preview factories with a shared fake pool and fresh per-call strategies", async () => {
  const previewProvider = productionPreviewProvider();
  const strategiesProvider = productionStrategiesProvider();
  const prisma = Object.freeze({});
  class PreviewWiringTestModule {}
  Module({ providers: [{ provide: PRISMA_CLIENT, useValue: prisma }, strategiesProvider, previewProvider] })(PreviewWiringTestModule);
  const context = await NestFactory.createApplicationContext(PreviewWiringTestModule, { logger: false });
  try {
    assert.equal(context.get(PRISMA_CLIENT), prisma);
    const preview = context.get<PublicProductCrossSellPreview>(PublicProductCrossSellPreview);
    const strategies = context.get<CrossSellPreviewStrategiesPort>(CROSS_SELL_PREVIEW_STRATEGIES);
    assert.ok(preview instanceof PublicProductCrossSellPreview);
    assert.notEqual(strategies.createCatalog(), strategies.createCatalog());
    assert.notEqual(strategies.createCoOccurrence(), strategies.createCoOccurrence());
    // Disabled preview must not access any missing Prisma delegate.
    assert.equal(await preview.suggest("merchant-a", { crossSell: { enabled: false } }, ["sku-a"]), undefined);
  } finally { await context.close(); }
});

test("provider-only reader resolves the existing global pool without starting persistence lifecycle", async () => {
  const reads: unknown[] = [];
  const identity = { agentName: "Synthetic agent", tone: "friendly" };
  const checkoutSettings = { agentMode: "active", initialDelaySeconds: 2 };
  const prisma = { agentRule: { findFirst: async (input: unknown) => {
    reads.push(input); return { identity, checkoutSettings, privateInternalField: "not-public" };
  } } };
  class FakeExistingPoolModule {}
  Global()(FakeExistingPoolModule);
  Module({ providers: [{ provide: PRISMA_CLIENT, useValue: prisma }], exports: [PRISMA_CLIENT] })(FakeExistingPoolModule);
  class ReaderWiringTestModule {}
  Module({ imports: [FakeExistingPoolModule, AgentRuleReaderModule] })(ReaderWiringTestModule);
  const context = await NestFactory.createApplicationContext(ReaderWiringTestModule, { logger: false });
  try {
    assert.equal(context.get(PRISMA_CLIENT), prisma);
    const reader = context.get<MerchantAgentRuleReaderPort>(MERCHANT_AGENT_RULE_READER);
    assert.deepEqual(await reader.findForMerchant("merchant-a"), { identity, checkoutSettings });
    assert.deepEqual(reads, [{ where: { merchantId: "merchant-a", agentId: "default", userId: null, scope: "merchant_default" } }]);
  } finally { await context.close(); }
});

