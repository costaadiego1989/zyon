import { Injectable, Inject, Logger } from '@nestjs/common';
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from '../../domain/ports/cross-sell-promotion-repository.port.js';

@Injectable()
export class ListCrossSellPromotionsUseCase {
  private readonly logger = new Logger(ListCrossSellPromotionsUseCase.name);

  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY)
    private readonly repo: CrossSellPromotionRepository,
  ) {}

  async execute(merchantId: string) {
    const promotions = await this.repo.findAllByMerchant(merchantId);
    return promotions.map((p) => p.snapshot());
  }
}
