import { Injectable, Inject , Logger} from "@nestjs/common";
import { CrossSellPromotionEntity, type PromotionTrigger } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export type CreateCrossSellPromotionInput = {
  merchant_id: string;
  name: string;
  trigger: PromotionTrigger;
  recommended_skus: string[];
  discount_percent: number;
  max_discount_percent: number;
  starts_at: Date;
  ends_at?: Date;
};

@Injectable()
export class CreateCrossSellPromotionUseCase {
  private readonly logger = new Logger(CreateCrossSellPromotionUseCase.name);

  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly repo: CrossSellPromotionRepository
  ) {}

  async execute(input: CreateCrossSellPromotionInput) {
    const promotion = CrossSellPromotionEntity.create(input);
    await this.repo.save(promotion);
    return promotion.snapshot();
  }
}
