import { Global, Module } from "@nestjs/common";
import { CROSS_SELL_PROMOTION_REPOSITORY } from "./domain/ports/cross-sell-promotion-repository.port.js";
import { CROSS_SELL_SUGGESTION_REPOSITORY } from "./domain/ports/cross-sell-suggestion-repository.port.js";
import { InMemoryCrossSellPromotionRepository } from "./infrastructure/repositories/in-memory-cross-sell-promotion.repository.js";
import { InMemoryCrossSellSuggestionRepository } from "./infrastructure/repositories/in-memory-cross-sell-suggestion.repository.js";
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
    InMemoryCrossSellPromotionRepository,
    InMemoryCrossSellSuggestionRepository,
    { provide: CROSS_SELL_PROMOTION_REPOSITORY, useExisting: InMemoryCrossSellPromotionRepository },
    { provide: CROSS_SELL_SUGGESTION_REPOSITORY, useExisting: InMemoryCrossSellSuggestionRepository },
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
