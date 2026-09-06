import { Module } from "@nestjs/common";
import { RealtimeCapabilityService } from "../../shared/auth/realtime-capability.js";
import { PersistenceModule, PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { CrossSellModule } from "../cross-sell/cross-sell.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { CouponsModule } from "../coupons/coupons.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { BuyerAccountRepositoryModule } from "../buyer-account/buyer-account-repository.module.js";
import { SupportModule } from "../support/support.module.js";
import { MarketplaceModule } from "../marketplace/marketplace.module.js";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module.js";
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
import { StorefrontConversationAdapter, STOREFRONT_CONVERSATION_ADAPTER } from "./infrastructure/adapters/storefront-conversation.adapter.js";
import { StorefrontConversationGateway } from "./infrastructure/gateways/conversation.gateway.js";
import { STOREFRONT_CONVERSATION_PORT } from "./domain/ports/conversation.port.js";
import { STOREFRONT_CART_PORT } from "./domain/ports/storefront-cart.port.js";
import { PrismaStorefrontCartRepository } from "./infrastructure/repositories/prisma-storefront-cart.repository.js";
import { StorefrontController } from "./presentation/http/storefront.controller.js";
import { AIGatewayService } from "./infrastructure/ai/ai-gateway.service.js";
import { BudgetTrackerService } from "./infrastructure/ai/budget-tracker.service.js";
import { LocalLLMProvider } from "./infrastructure/ai/local-llm-provider.js";
import { OpenRouterProvider } from "./infrastructure/ai/openrouter-provider.js";

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
    KnowledgeBaseModule,
  ],
  controllers: [StorefrontController],
  providers: [
    { provide: RealtimeCapabilityService, useFactory: () => new RealtimeCapabilityService() },
    StorefrontConversationAdapter,
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
    StartStoreConversationUseCase,
    SendStoreMessageUseCase,
    GenerateNudgeUseCase,
    GetConversationHistoryUseCase,
    GetStoreConfigUseCase,
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
