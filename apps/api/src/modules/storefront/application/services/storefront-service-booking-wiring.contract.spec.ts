import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module, type FactoryProvider } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { BuyerJwtService } from "../../../buyer-account/domain/services/buyer-jwt.service.js";
import { BUYER_ACCOUNT_REPOSITORY } from "../../../buyer-account/domain/ports/buyer-account-repository.port.js";
import { ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import { PublicServiceBookingReader } from "../../../checkout/application/public-service-booking-reader.js";
import { StorefrontModule } from "../../storefront.module.js";
import { StorefrontServiceBookingBridge } from "./storefront-service-booking.bridge.js";

function productionProvider() {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, StorefrontModule) as unknown[];
  const provider = providers.find((value): value is FactoryProvider<StorefrontServiceBookingBridge> =>
    Boolean(value && typeof value === "object" && "provide" in value && value.provide === StorefrontServiceBookingBridge));
  assert.ok(provider, "the real Storefront module must register the bridge factory"); return provider;
}
test("T43 existing-provider construction", async t => {
  await t.test("the real module keeps its exact existing imports and adds no Embed or reverse module edge", () => {
    const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, StorefrontModule) as { name: string }[];
    assert.deepEqual(imports.map(value => value.name), ["PersistenceModule", "CatalogModule", "CheckoutModule", "ShippingModule", "CouponsModule",
      "MerchantModule", "BuyerAccountRepositoryModule", "SupportModule", "MarketplaceModule", "CrossSellModule", "AgentRuleReaderModule",
      "KnowledgeBaseModule", "StoriesModule", "BuyerAccountModule", "CampaignConsentModule"]);
    assert.deepEqual(productionProvider().inject, [PRISMA_CLIENT, RealtimeCapabilityService, BuyerJwtService, BUYER_ACCOUNT_REPOSITORY, ServiceBookingService, PublicServiceBookingReader]);
  });
  await t.test("real Nest constructs the actual production factory with existing canonical verifiers and no repository IO", async () => {
    let reads = 0;
    const forbiddenRead = async () => { reads++; assert.fail("constructor queried a repository or booking reader"); };
    // Plain inert values let Nest inspect its normal lifecycle hooks; the actual
    // repository/reader methods still fail if the production constructor calls them.
    const buyers = Object.freeze({ findByGlobalUserId: forbiddenRead });
    const booking = Object.freeze({ professionals: forbiddenRead, dates: forbiddenRead, slots: forbiddenRead, select: forbiddenRead });
    const conversations = new RealtimeCapabilityService("synthetic-t43-construction-conversation-secret");
    const jwt = new BuyerJwtService("synthetic-t43-construction-buyer-secret");
    class ExistingBindingsTestModule {}
    Module({ providers: [{ provide: PRISMA_CLIENT, useValue: Object.freeze({}) }, { provide: RealtimeCapabilityService, useValue: conversations },
      { provide: BuyerJwtService, useValue: jwt }, { provide: BUYER_ACCOUNT_REPOSITORY, useValue: buyers },
      { provide: ServiceBookingService, useValue: booking }, { provide: PublicServiceBookingReader, useValue: booking }, productionProvider()] })(ExistingBindingsTestModule);
    const context = await NestFactory.createApplicationContext(ExistingBindingsTestModule, { logger: false });
    try {
      const bridge = context.get<StorefrontServiceBookingBridge>(StorefrontServiceBookingBridge);
      assert.ok(bridge instanceof StorefrontServiceBookingBridge); assert.equal(context.get(BuyerJwtService), jwt);
      assert.equal(typeof bridge.capture({ headers: {}, conversationId: "cart" }), "function"); assert.equal(reads, 0);
    } finally { await context.close(); }
  });
});
