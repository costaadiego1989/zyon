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
import { AcceptCrossSellSuggestionUseCase } from "./application/use-cases/accept-cross-sell-suggestion.use-case.js";
import { DeclineCrossSellSuggestionUseCase } from "./application/use-cases/decline-cross-sell-suggestion.use-case.js";
import { MerchantCrossSellController } from "./presentation/http/merchant-cross-sell.controller.js";

@Global()
@Module({
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
    AcceptCrossSellSuggestionUseCase,
    DeclineCrossSellSuggestionUseCase
  ],
  exports: [
    CreateCrossSellPromotionUseCase,
    ListEligibleCrossSellsUseCase,
    AcceptCrossSellSuggestionUseCase,
    DeclineCrossSellSuggestionUseCase
  ]
})
export class CrossSellModule {}
