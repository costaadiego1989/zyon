import type { Prisma, PrismaClient } from "@prisma/client";
import { ConflictException } from "@nestjs/common";
import type { CouponEntity } from "../../domain/entities/coupon.entity.js";
import type { CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { toCouponCreateInput, toCouponEntity, toCouponUpdateInput } from "./prisma-coupon.converters.js";
import { presentStrategyCoupon } from "../../domain/policies/strategy-coupon-presentation.js";

/**
 * H1: Prisma implementation of CouponRepository — production persistence.
 */
export class PrismaCouponRepository implements CouponRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient) {}

  async save(coupon: CouponEntity): Promise<void> {
    if (coupon.snapshot().strategy_incentive_execution_id) {
      throw new ConflictException("COUPON_MANAGED_BY_STRATEGY");
    }
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
      where: { merchantId, status: { not: "archived" } },
      orderBy: { createdAt: "desc" },
      include: { strategyIncentiveExecution: { select: { budgetId: true, startedAt: true, endsAt: true } } },
    });
    const budgetIds = rows.flatMap(row => row.strategyIncentiveExecution ? [row.strategyIncentiveExecution.budgetId] : []);
    const budgets = budgetIds.length ? await this.prisma.strategyIncentiveBudget.findMany({
      where: { merchantId, id: { in: budgetIds } }, select: { id: true, closedAt: true, limitCents: true,
        maxDiscountCents: true, maxRedemptions: true, reservedCents: true, spentCents: true, reservedCount: true, spentCount: true },
    }) : [];
    const byId = new Map(budgets.map(budget => [budget.id, budget]));
    const now = new Date();
    return rows.map(row => presentStrategyCoupon(toCouponEntity(row), row.strategyIncentiveExecution
      ? { ...row.strategyIncentiveExecution, budget: byId.get(row.strategyIncentiveExecution.budgetId) ?? null } : null, now));
  }

  async updateActive(merchantId: string, id: string, isActive: boolean): Promise<void> {
    const coupon = await this.prisma.coupon.findFirst({ where: { id, merchantId } });
    if (!coupon) return;
    if (coupon.strategyIncentiveExecutionId) throw new ConflictException("COUPON_MANAGED_BY_STRATEGY");
    await this.prisma.coupon.update({
      where: { id },
      data: { status: isActive ? "active" : "paused" },
    });
  }
}
