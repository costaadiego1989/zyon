import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException, Module } from "@nestjs/common";
import { MODULE_METADATA, SELF_DECLARED_DEPS_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import { BILLING_PLAN_ACCESS, type BillingPlanAccessPort } from "../../../payment/domain/ports/billing-plan-access.port.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { StorefrontModule } from "../../storefront.module.js";
import { GetStoreConfigUseCase } from "../use-cases/get-store-config.use-case.js";
import { StorefrontProductContentController } from "../../presentation/http/storefront-product-content.controller.js";
import { StorefrontRealtimeVoiceController } from "../../presentation/http/storefront-realtime-voice.controller.js";
import { PublicProductCrossSellPreview } from "./public-product-cross-sell-preview.js";

test("real Nest DI resolves production billing alias to the existing metering instance", async () => {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StorefrontModule) as unknown[];
  const alias = providers.find((provider): provider is { provide: symbol; useExisting: typeof BillingPlanMeteringService } => Boolean(provider && typeof provider === "object" && "provide" in provider && provider.provide === BILLING_PLAN_ACCESS));
  assert.ok(alias);
  assert.equal(alias.useExisting, BillingPlanMeteringService);
  const calls: unknown[] = [];
  const rejection = new ForbiddenException("synthetic-plan-rejection");
  const metering: BillingPlanAccessPort = {
    getEffectivePlan: async (merchantId, now) => { calls.push(["plan", merchantId, now]); return "growth"; },
    assertAllowed: async (merchantId, requirement) => { calls.push(["feature", merchantId, requirement]); if (merchantId === "merchant-denied") throw rejection; },
  };
  class BillingAliasTestModule {}
  Module({ providers: [{ provide: BillingPlanMeteringService, useValue: metering }, alias] })(BillingAliasTestModule);
  const context = await NestFactory.createApplicationContext(BillingAliasTestModule, { logger: false });
  try {
    const port = context.get<BillingPlanAccessPort>(BILLING_PLAN_ACCESS);
    assert.equal(port, metering);
    assert.equal(port, context.get(BillingPlanMeteringService));
    const now = new Date(0);
    assert.equal(await port.getEffectivePlan("merchant-a", now), "growth");
    await port.assertAllowed("merchant-b", { kind: "feature", key: "voiceCheckout" });
    await assert.rejects(port.assertAllowed("merchant-denied", { kind: "feature", key: "voiceCheckout" }), error => error === rejection);
    assert.deepEqual(calls, [["plan", "merchant-a", now], ["feature", "merchant-b", { kind: "feature", key: "voiceCheckout" }], ["feature", "merchant-denied", { kind: "feature", key: "voiceCheckout" }]]);
  } finally { await context.close(); }
});

test("all storefront billing consumers explicitly inject the feature-access token", () => {
  for (const [consumer, index] of [[GetStoreConfigUseCase, 1], [StorefrontProductContentController, 2], [StorefrontRealtimeVoiceController, 3]] as const) {
    const params = Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, consumer) as Array<{ index: number; param: unknown }>;
    assert.equal(params.find(param => param.index === index)?.param, BILLING_PLAN_ACCESS);
  }
});

test("public config keeps denied billing a false UI hint without weakening admission", async () => {
  const calls: unknown[] = [];
  const billing: BillingPlanAccessPort = { getEffectivePlan: async () => assert.fail("config must use admission"), assertAllowed: async (...args) => { calls.push(args); throw new ForbiddenException("synthetic-plan-rejection"); } };
  const useCase = new GetStoreConfigUseCase({ findPublicConfig: async () => ({ merchant: { id: "merchant-denied", name: "Store", theme: {}, storeCategory: null, storeSettings: {} }, stories: [] }) }, billing);
  assert.equal((await useCase.execute("store")).voiceCheckoutEnabled, false);
  assert.deepEqual(calls, [["merchant-denied", { kind: "feature", key: "voiceCheckout" }]]);
});

test("product content forwards merchant to billing before any catalog read and preserves failure", async () => {
  const calls: unknown[] = [];
  const rejection = new ForbiddenException("synthetic-plan-rejection");
  const billing: BillingPlanAccessPort = { getEffectivePlan: async merchantId => { calls.push(merchantId); throw rejection; }, assertAllowed: async () => assert.fail("product content only reads plan") };
  const prisma = { merchant: { findFirst: async () => ({ id: "merchant-denied", storeSlug: "store", storeSettings: {} }) }, product: { findFirst: async () => assert.fail("must stop before product read") } };
  const preview = new PublicProductCrossSellPreview(prisma as never, {
    createCatalog: () => assert.fail("billing rejection must precede catalog strategy construction"),
    createCoOccurrence: () => assert.fail("billing rejection must precede co-occurrence construction"),
  });
  let previewCalls = 0;
  preview.suggest = async () => { previewCalls++; assert.fail("billing rejection must precede preview IO"); };
  const controller = new StorefrontProductContentController(prisma as never, {} as never, billing, preview);
  await assert.rejects(controller.getContent("store", "product"), error => error === rejection);
  assert.deepEqual(calls, ["merchant-denied"]);
  assert.equal(previewCalls, 0);
});

test("voice narration forwards verified tenant and rejects before calling realtime provider", async () => {
  const calls: unknown[] = [];
  const rejection = new ForbiddenException("synthetic-plan-rejection");
  const billing: BillingPlanAccessPort = { getEffectivePlan: async () => assert.fail("voice must use admission"), assertAllowed: async (...args) => { calls.push(args); throw rejection; } };
  const capabilities = { verify: () => ({ merchantId: "merchant-denied", resourceId: "conversation", aiUserId: "buyer" }) };
  const realtime = { createProductNarrationCall: async () => assert.fail("must reject before realtime IO") };
  let readerCalls = 0;
  const reader = { findForMerchant: async () => { readerCalls++; assert.fail("narration billing rejection must precede identity IO"); } };
  const controller = new StorefrontRealtimeVoiceController(capabilities as never, {} as never, reader, billing, realtime as never);
  await assert.rejects(controller.createProductNarration({ headers: { authorization: "Bearer synthetic" } }, "conversation", { productId: "product", summary: "Product summary", sdp: "v=0\r\n" }), error => error === rejection);
  assert.deepEqual(calls, [["merchant-denied", { kind: "feature", key: "voiceCheckout" }]]);
  assert.equal(readerCalls, 0);
});

