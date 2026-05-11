import { Injectable, Inject, NotFoundException } from "@nestjs/common";
import type { CrossSellPromotionSnapshot, PromotionTrigger } from "../../domain/entities/cross-sell-promotion.entity.js";
import { CROSS_SELL_PROMOTION_REPOSITORY, type CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";

export type UpdateCrossSellPromotionInput = {
  id: string;
  merchant_id: string;
  patch: Partial<Pick<CrossSellPromotionSnapshot, "name" | "trigger" | "recommended_skus" | "discount_percent" | "max_discount_percent" | "starts_at" | "ends_at">>;
};

@Injectable()
export class UpdateCrossSellPromotionUseCase {
  constructor(
    @Inject(CROSS_SELL_PROMOTION_REPOSITORY) private readonly repo: CrossSellPromotionRepository
  ) {}

  async execute(input: UpdateCrossSellPromotionInput) {
    const promotion = await this.repo.findById(input.id, input.merchant_id);
    if (!promotion) throw new NotFoundException("cross_sell_promotion_not_found");
    const updated = promotion.update(input.patch);
    await this.repo.save(updated);
    return updated.snapshot();
  }
}
