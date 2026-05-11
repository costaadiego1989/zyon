import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";

@Injectable()
export class ArchiveCrossSellPromotionUseCase {
  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly repo: CrossSellPromotionRepository
  ) {}

  async execute(input: { id: string; merchant_id: string }) {
    const promotion = await this.repo.findById(input.id, input.merchant_id);
    if (!promotion) throw new NotFoundException("cross_sell_promotion_not_found");
    const archived = promotion.archive();
    await this.repo.save(archived);
    return archived.snapshot();
  }
}
