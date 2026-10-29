import type { PrismaClient } from "@prisma/client";
import type { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import type { CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import { toCouponRedemptionEntity, toRedemptionCreateInput, toRedemptionUpdateInput } from "./prisma-coupon.converters.js";

/**
 * H1: Prisma implementation of CouponRedemptionRepository — production persistence.
 */
export class PrismaCouponRedemptionRepository implements CouponRedemptionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(redemption: CouponRedemptionEntity): Promise<void> {
    await this.prisma.couponRedemption.upsert({
      where: { id: redemption.id },
      create: toRedemptionCreateInput(redemption),
      update: toRedemptionUpdateInput(redemption)
    });
  }

  async findById(id: string, merchantId: string): Promise<CouponRedemptionEntity | null> {
    const row = await this.prisma.couponRedemption.findFirst({
      where: { id, merchantId }
    });
    return row ? toCouponRedemptionEntity(row) : null;
  }

  async findBySession(sessionId: string, merchantId: string): Promise<CouponRedemptionEntity[]> {
    const rows = await this.prisma.couponRedemption.findMany({
      where: { sessionId, merchantId }
    });
    return rows.map(toCouponRedemptionEntity);
  }

  async countByBuyer(couponId: string, buyerGlobalUserId: string): Promise<number> {
    return this.prisma.couponRedemption.count({
      where: {
        couponId,
        buyerGlobalUserId,
        status: { not: "cancelled" }
      }
    });
  }

  async countByCoupon(couponId: string): Promise<number> {
    return this.prisma.couponRedemption.count({
      where: {
        couponId,
        status: { not: "cancelled" }
      }
    });
  }
}
