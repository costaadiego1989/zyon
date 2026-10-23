import { Module } from "@nestjs/common";
import { BILLING_PLAN_ACCESS } from "../payment/domain/ports/billing-plan-access.port.js";
import { RealtimeCapabilityService } from "../../shared/auth/realtime-capability.js";
import {
  BillingPlanMeteringService,
  PlanLimitGuard,
} from "../payment/infrastructure/billing/billing-plan-guard.js";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { CrossSellModule } from "../cross-sell/cross-sell.module.js";
import { STOREFRONT_CROSS_SELL_CART } from "./domain/ports/storefront-cross-sell-cart.port.js";
import { PrismaStorefrontCrossSellCartAdapter } from "./infrastructure/repositories/prisma-storefront-cross-sell-cart.adapter.js";
import { STOREFRONT_COUPON_CART } from "./domain/ports/storefront-coupon-cart.port.js";
import { PrismaStorefrontCouponCartAdapter } from "./infrastructure/repositories/prisma-storefront-coupon-cart.adapter.js";
import { PrismaCouponRepository } from "../coupons/infrastructure/repositories/prisma-coupon.repository.js";
import { PrismaCouponTransactionRepository } from "../coupons/infrastructure/repositories/prisma-coupon-transaction.repository.js";
import { PrismaProductPromotionRepository } from "../catalog/infrastructure/repositories/prisma-product-promotion.repository.js";
import { readExistingPrismaMerchantRules } from "../merchant/infrastructure/prisma-merchant.repository.js";
import { DISCOUNT_RULES_ENGINE, type DiscountRulesEnginePort } from "../coupons/domain/ports/discount-rules-engine.port.js";
import { CROSS_SELL_PREVIEW_STRATEGIES, type CrossSellPreviewStrategiesPort } from "../cross-sell/domain/ports/preview-strategies.port.js";
import { AgentRuleReaderModule } from "../agent-rules/agent-rule-reader.module.js";
import type { PrismaClient } from "@prisma/client";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { CouponsModule } from "../coupons/coupons.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { BuyerAccountRepositoryModule } from "../buyer-account/buyer-account-repository.module.js";
import { SupportModule } from "../support/support.module.js";
import { MarketplaceModule } from "../marketplace/marketplace.module.js";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module.js";
import { StoriesModule } from "../stories/stories.module.js";
import { SearchFederatedProductsUseCase } from "../marketplace/application/use-cases/search-federated-products.use-case.js";
import { PRODUCT_PROMOTION_REPOSITORY } from "../catalog/domain/ports/product-promotion-repository.port.js";
import { StartStoreConversationUseCase } from "./application/use-cases/start-store-conversation.use-case.js";
import { SendStoreMessageUseCase } from "./application/use-cases/send-store-message.use-case.js";
import { GenerateNudgeUseCase } from "./application/use-cases/generate-nudge.use-case.js";
import { GetConversationHistoryUseCase } from "./application/use-cases/get-conversation-history.use-case.js";
import { GetStoreConfigUseCase } from "./application/use-cases/get-store-config.use-case.js";
import { GetStorefrontFunnelUseCase } from "./application/use-cases/get-storefront-funnel.use-case.js";
import { CreateBudgetRequestUseCase } from "./application/use-cases/create-budget-request.use-case.js";
import { ListBudgetRequestsUseCase } from "./application/use-cases/list-budget-requests.use-case.js";
import { UpdateBudgetRequestStatusUseCase } from "./application/use-cases/update-budget-request-status.use-case.js";
import { SearchMarketplaceProductsStorefrontUseCase } from "./application/use-cases/search-marketplace-products-storefront.use-case.js";
import { AddMarketplaceItemToCartStorefrontUseCase } from "./application/use-cases/add-marketplace-item-to-cart.use-case.js";
import { GetPublicStoreResourcesUseCase } from "./application/use-cases/get-public-store-resources.use-case.js";
import { TrackStorefrontEventUseCase } from "./application/use-cases/track-storefront-event.use-case.js";
import { GetStorefrontLiveSessionsUseCase } from "./application/use-cases/get-storefront-live-sessions.use-case.js";
import { StorefrontAttachmentInterpreter } from "./application/services/storefront-attachment-interpreter.service.js";
import { StorefrontConversationAdapter, STOREFRONT_CONVERSATION_ADAPTER } from "./infrastructure/adapters/storefront-conversation.adapter.js";
import { StorefrontConversationGateway } from "./infrastructure/gateways/conversation.gateway.js";
import { STOREFRONT_CONVERSATION_PORT } from "./domain/ports/conversation.port.js";
import { STOREFRONT_CONVERSATION_SCOPE } from "./domain/ports/conversation-scope.port.js";
import { STOREFRONT_CART_PORT } from "./domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCartRepository } from "./infrastructure/repositories/prisma-storefront-cart.repository.js";
import { PrismaStorefrontTelemetryRepository } from "./infrastructure/repositories/prisma-storefront-telemetry.repository.js";
import { STOREFRONT_TELEMETRY_PORT } from "./domain/ports/storefront-telemetry.port.js";
import { STOREFRONT_CONFIG_QUERY_PORT } from "./domain/ports/storefront-config-query.port.js";
import { PrismaStorefrontConfigQueryRepository } from "./infrastructure/repositories/prisma-storefront-config-query.repository.js";
import { StorefrontController } from "./presentation/http/storefront.controller.js";
import { StorefrontCrossSellController } from "./presentation/http/storefront-cross-sell.controller.js";
import { StorefrontProductContentController } from "./presentation/http/storefront-product-content.controller.js";
import { StorefrontProductSubmissionController } from "./presentation/http/storefront-product-submission.controller.js";
import { BuyerAccountModule } from "../buyer-account/buyer-account.module.js";
import { AIGatewayService } from "./infrastructure/ai/ai-gateway.service.js";
import { BudgetTrackerService } from "./infrastructure/ai/budget-tracker.service.js";
import { LocalLLMProvider } from "./infrastructure/ai/local-llm-provider.js";
import { OpenRouterProvider } from "./infrastructure/ai/openrouter-provider.js";
import { RateLimitStore } from "../../shared/rate-limit/rate-limit.store.js";
import { RedisRateLimitStore } from "../../shared/rate-limit/redis-rate-limit.store.js";
import { StorefrontConversationRateLimitService } from "./application/services/storefront-conversation-rate-limit.service.js";
import { OneBuyClickSessionService } from "./application/services/one-buy-click-session.service.js";
import { PublicProductCrossSellPreview } from "./application/services/public-product-cross-sell-preview.js";
import { OpenAIRealtimeVoiceService } from "../../shared/openai/openai-realtime-voice.service.js";
import { StorefrontRealtimeVoiceController } from "./presentation/http/storefront-realtime-voice.controller.js";
import { CampaignConsentModule } from "../campaign-consent/campaign-consent.module.js";
import { StorefrontConsentController } from "./presentation/http/storefront-consent.controller.js";
import { storefrontUseCaseObservationProvider } from "./infrastructure/observability/storefront-use-case-observer.js";
import { STOREFRONT_SHIPPING_REFERENCE } from "./domain/ports/storefront-shipping-reference.port.js";
import { QuoteStorefrontShippingReferenceService } from "./application/services/quote-storefront-shipping-reference.service.js";
import { PrismaStorefrontShippingReferenceReader } from "./infrastructure/repositories/prisma-storefront-shipping-reference.reader.js";
import { QuoteShippingUseCase } from "../shipping/application/use-cases/quote-shipping.use-case.js";
@Module({
  imports: [
    PersistenceModule,
    CatalogModule,
    CheckoutModule,
    ShippingModule,
    CouponsModule,
    MerchantModule,
    BuyerAccountRepositoryModule,
    SupportModule,
    MarketplaceModule,
    CrossSellModule,
    AgentRuleReaderModule,
    KnowledgeBaseModule,
    StoriesModule,
    BuyerAccountModule,
    CampaignConsentModule,
  ],
  controllers: [StorefrontController, StorefrontCrossSellController, StorefrontRealtimeVoiceController, StorefrontProductContentController, StorefrontProductSubmissionController, StorefrontConsentController],
  providers: [
    { provide: STOREFRONT_SHIPPING_REFERENCE,
      useFactory: (prisma: PrismaClient, shipping: QuoteShippingUseCase) => new QuoteStorefrontShippingReferenceService(new PrismaStorefrontShippingReferenceReader(prisma), shipping),
      inject: [PRISMA_CLIENT, QuoteShippingUseCase] },
    { provide: STOREFRONT_COUPON_CART,
      useFactory: (prisma: PrismaClient, engine: DiscountRulesEnginePort) => new PrismaStorefrontCouponCartAdapter(prisma, engine, {
        couponsFor: tx => new PrismaCouponRepository(tx),
        transactionsFor: tx => new PrismaCouponTransactionRepository(tx, true),
        promotionsFor: tx => new PrismaProductPromotionRepository(tx),
        readExistingRules: readExistingPrismaMerchantRules,
      }), inject: [PRISMA_CLIENT, DISCOUNT_RULES_ENGINE] },
    { provide: STOREFRONT_CROSS_SELL_CART, useFactory: (prisma: PrismaClient) => new PrismaStorefrontCrossSellCartAdapter(prisma), inject: [PRISMA_CLIENT] },
    storefrontUseCaseObservationProvider,
    { provide: RateLimitStore, useClass: RedisRateLimitStore },
    StorefrontConversationRateLimitService,
    BillingPlanMeteringService,
    { provide: BILLING_PLAN_ACCESS, useExisting: BillingPlanMeteringService },
    {
      provide: PublicProductCrossSellPreview,
      useFactory: (prisma: PrismaClient, strategies: CrossSellPreviewStrategiesPort) => new PublicProductCrossSellPreview(prisma, strategies),
      inject: [PRISMA_CLIENT, CROSS_SELL_PREVIEW_STRATEGIES],
    },
    PlanLimitGuard,
    { provide: RealtimeCapabilityService, useFactory: () => new RealtimeCapabilityService() },
    OpenAIRealtimeVoiceService,
    StorefrontConversationAdapter,
    { provide: STOREFRONT_CONVERSATION_SCOPE, useExisting: StorefrontConversationAdapter },
    StorefrontConversationGateway,
    {
      provide: STOREFRONT_CONVERSATION_PORT,
      useExisting: StorefrontConversationAdapter
    },
    {
      provide: STOREFRONT_CART_PORT,
      useClass: PrismaStorefrontCartRepository
    },
    {
      provide: STOREFRONT_TELEMETRY_PORT,
      useClass: PrismaStorefrontTelemetryRepository,
    },
    {
      provide: STOREFRONT_CONFIG_QUERY_PORT,
      useClass: PrismaStorefrontConfigQueryRepository,
    },
    {
      provide: LocalLLMProvider,
      useFactory: () => {
        return new LocalLLMProvider({
          baseUrl: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
          model: process.env.LOCAL_LLM_MODEL || "mistral",
          timeout: Number(process.env.LOCAL_LLM_TIMEOUT_MS) || 5000
        });
      }
    },
    {
      provide: OpenRouterProvider,
      useFactory: () => {
        return new OpenRouterProvider({
          apiKey: process.env.OPENAI_API_KEY || "",
          model: process.env.OPENAI_MODEL || "gpt-4o-mini"
        });
      }
    },
    BudgetTrackerService,
    AIGatewayService,
    OneBuyClickSessionService,
    StorefrontAttachmentInterpreter,
    StartStoreConversationUseCase,
    SendStoreMessageUseCase,
    GenerateNudgeUseCase,
    GetConversationHistoryUseCase,
    GetStoreConfigUseCase,
    GetPublicStoreResourcesUseCase,
    TrackStorefrontEventUseCase,
    GetStorefrontLiveSessionsUseCase,
    GetStorefrontFunnelUseCase,
    CreateBudgetRequestUseCase,
    ListBudgetRequestsUseCase,
    UpdateBudgetRequestStatusUseCase,
    {
      provide: SearchMarketplaceProductsStorefrontUseCase,
      useFactory: (searchFederated: any, prisma: any) =>
        new SearchMarketplaceProductsStorefrontUseCase(searchFederated, prisma),
      inject: [SearchFederatedProductsUseCase, PRISMA_CLIENT],
    },
    AddMarketplaceItemToCartStorefrontUseCase
  ],
  exports: [
    StorefrontAttachmentInterpreter,
    StartStoreConversationUseCase,
    SendStoreMessageUseCase,
    GetConversationHistoryUseCase,
    GetStoreConfigUseCase,
    GetStorefrontFunnelUseCase,
    STOREFRONT_CONVERSATION_PORT,
    STOREFRONT_CART_PORT,
    AIGatewayService
  ]
})
export class StorefrontModule {}
