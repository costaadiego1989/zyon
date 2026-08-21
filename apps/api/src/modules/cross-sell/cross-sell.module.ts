import { Global, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CROSS_SELL_PROMOTION_REPOSITORY } from "./domain/ports/cross-sell-promotion-repository.port.js";
import { CROSS_SELL_SUGGESTION_REPOSITORY } from "./domain/ports/cross-sell-suggestion-repository.port.js";
import { PrismaCrossSellPromotionRepository } from "./infrastructure/repositories/prisma-cross-sell-promotion.repository.js";
import { PrismaCrossSellSuggestionRepository } from "./infrastructure/repositories/prisma-cross-sell-suggestion.repository.js";
import { CreateCrossSellPromotionUseCase } from "./application/use-cases/create-cross-sell-promotion.use-case.js";
import { UpdateCrossSellPromotionUseCase } from "./application/use-cases/update-cross-sell-promotion.use-case.js";
import { ArchiveCrossSellPromotionUseCase } from "./application/use-cases/archive-cross-sell-promotion.use-case.js";
import { ListEligibleCrossSellsUseCase } from "./application/use-cases/list-eligible-cross-sells.use-case.js";
import { ListCrossSellPromotionsUseCase } from "./application/use-cases/list-cross-sell-promotions.use-case.js";
import { AcceptCrossSellSuggestionUseCase } from "./application/use-cases/accept-cross-sell-suggestion.use-case.js";
import { AcceptCrossSellFromWidgetUseCase } from "./application/use-cases/accept-cross-sell-from-widget.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "./application/use-cases/decline-cross-sell-suggestion.use-case.js";
import { CheckoutCrossSellRecommender } from "./application/services/checkout-cross-sell-recommender.js";
import { CHECKOUT_CROSS_SELL_RECOMMENDER } from "../checkout/domain/ports/cross-sell-recommender.port.js";
import { MerchantCrossSellController } from "./presentation/http/merchant-cross-sell.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";
import { CheckoutPersistenceModule } from "../checkout/checkout-persistence.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";

@Global()
@Module({
  imports: [CheckoutPersistenceModule, MerchantModule, BuyerPurchaseHistoryModule],
  controllers: [MerchantCrossSellController],
  providers: [
    // P0 fix: wire Prisma repositories for production persistence
    {
      provide: CROSS_SELL_PROMOTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCrossSellPromotionRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: CROSS_SELL_SUGGESTION_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaCrossSellSuggestionRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    CreateCrossSellPromotionUseCase,
    UpdateCrossSellPromotionUseCase,
    ArchiveCrossSellPromotionUseCase,
    ListEligibleCrossSellsUseCase,
    ListCrossSellPromotionsUseCase,
    AcceptCrossSellSuggestionUseCase,
    AcceptCrossSellFromWidgetUseCase,
    DeclineCrossSellSuggestionUseCase,
    CheckoutCrossSellRecommender,
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: CHECKOUT_CROSS_SELL_RECOMMENDER,
      useExisting: CheckoutCrossSellRecommender
    }
  ],
  exports: [
    CreateCrossSellPromotionUseCase,
    ListEligibleCrossSellsUseCase,
    ListCrossSellPromotionsUseCase,
    AcceptCrossSellSuggestionUseCase,
    AcceptCrossSellFromWidgetUseCase,
    DeclineCrossSellSuggestionUseCase,
    CHECKOUT_CROSS_SELL_RECOMMENDER
  ]
})
export class CrossSellModule {}
