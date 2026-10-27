import type { PrismaClient } from "@prisma/client";
import type { CrossSellPromotionEntity } from "../../domain/entities/cross-sell-promotion.entity.js";
import type { CrossSellPromotionRepository } from "../../domain/ports/cross-sell-promotion-repository.port.js";
import { toPromoCreateInput, toPromoEntity, toPromoUpdateInput } from "./prisma-cross-sell.converters.js";

/**
 * P0 fix: Prisma implementation of CrossSellPromotionRepository.
 */
export class PrismaCrossSellPromotionRepository implements CrossSellPromotionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(promotion: CrossSellPromotionEntity): Promise<void> {
    await this.prisma.crossSellPromotion.upsert({
      where: { id: promotion.id },
      create: toPromoCreateInput(promotion),
      update: toPromoUpdateInput(promotion)
    });
  }

  async findById(id: string, merchantId: string): Promise<CrossSellPromotionEntity | null> {
    const row = await this.prisma.crossSellPromotion.findFirst({
      where: { id, merchantId }
    });
    return row ? toPromoEntity(row) : null;
  }

  async findActiveByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]> {
    const rows = await this.prisma.crossSellPromotion.findMany({
      where: { merchantId, status: "active" },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toPromoEntity);
  }

  async findAllByMerchant(merchantId: string): Promise<CrossSellPromotionEntity[]> {
    const rows = await this.prisma.crossSellPromotion.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toPromoEntity);
  }
}
