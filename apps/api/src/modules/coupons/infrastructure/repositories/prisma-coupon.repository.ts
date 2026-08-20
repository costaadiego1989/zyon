import type { PrismaClient } from "@prisma/client";
import type { CouponEntity } from "../../domain/entities/coupon.entity.js";
import type { CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { toCouponCreateInput, toCouponEntity, toCouponUpdateInput } from "./prisma-coupon.converters.js";

/**
 * H1: Prisma implementation of CouponRepository — production persistence.
 */
export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(coupon: CouponEntity): Promise<void> {
    await this.prisma.coupon.upsert({
      where: { id: coupon.id },
      create: toCouponCreateInput(coupon),
      update: toCouponUpdateInput(coupon)
    });
  }

  async findById(id: string, merchantId: string): Promise<CouponEntity | null> {
    const row = await this.prisma.coupon.findFirst({
      where: { id, merchantId }
    });
    return row ? toCouponEntity(row) : null;
  }

  async findByCode(merchantId: string, code: string): Promise<CouponEntity | null> {
    const row = await this.prisma.coupon.findUnique({
      where: { merchantId_code: { merchantId, code: code.toUpperCase() } }
    });
    return row ? toCouponEntity(row) : null;
  }

  async findAllByMerchant(merchantId: string): Promise<CouponEntity[]> {
    const rows = await this.prisma.coupon.findMany({
      where: { merchantId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(toCouponEntity);
  }

  async updateActive(merchantId: string, id: string, isActive: boolean): Promise<void> {
    // Verify ownership then update
    const coupon = await this.prisma.coupon.findFirst({ where: { id, merchantId } });
    if (!coupon) return;
    await this.prisma.coupon.update({
      where: { id },
      data: { isActive },
    });
  }
}
