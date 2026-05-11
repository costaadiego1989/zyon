import { Injectable } from "@nestjs/common";
import { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import type { CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";

@Injectable()
export class InMemoryCrossSellPromotionRepository implements CrossSellPromotionRepository {
  private readonly store = new Map<string, CrossSellPromotionEntity>();

  async save(promotion: CrossSellPromotionEntity): Promise<void> {
    this.store.set(promotion.id, promotion);
  }

  async findById(id: string, merchantId: string): Promise<CrossSellPromotionEntity | null> {
    const p = this.store.get(id);
    if (!p || p.merchant_id !== merchantId) return null;
    return p;
  }

  async findActiveByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]> {
    return [...this.store.values()].filter((p) => p.merchant_id === merchantId && p.isActive());
  }

  async findAllByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]> {
    return [...this.store.values()].filter((p) => p.merchant_id === merchantId);
  }
}
