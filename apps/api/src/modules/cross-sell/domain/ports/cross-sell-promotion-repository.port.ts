import type { CrossSellPromotionEntity } from "../entities/cross-sell-promotion.entity.js";

export const CROSS_SELL_PROMOTION_REPOSITORY = Symbol("CROSS_SELL_PROMOTION_REPOSITORY");

export interface CrossSellPromotionRepository {
  save(promotion: CrossSellPromotionEntity): Promise<void>;
  findById(id: string, merchantId: string): Promise<CrossSellPromotionEntity | null>;
  findActiveByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]>;
  findAllByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]>;
}
