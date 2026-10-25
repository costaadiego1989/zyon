import { Injectable, Inject, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

@Injectable()
export class AggregateDailyMetricsUseCase {
  private readonly logger = new Logger(AggregateDailyMetricsUseCase.name);

  constructor(
    @Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(targetDate?: Date): Promise<void> {
    const date = targetDate ?? this.yesterday();
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    this.logger.log(`Aggregating metrics for ${dayStart.toISOString().split("T")[0]}`);

    // Get all merchants with store plan
    const merchants = await this.prisma.merchant.findMany({
      where: { plan: { in: ["STORE_ONLY", "BOTH"] } },
      select: { id: true },
    });

    for (const merchant of merchants) {
      await this.aggregateForMerchant(merchant.id, dayStart, dayEnd);
    }

    this.logger.log(`Aggregation complete for ${merchants.length} merchants`);
  }

  private async aggregateForMerchant(merchantId: string, dayStart: Date, dayEnd: Date): Promise<void> {
    // Count checkout sessions (conversations)
    const conversations = await this.prisma.checkoutSession.count({
      where: { merchantId, createdAt: { gte: dayStart, lt: dayEnd } },
    });

    // Count completed orders
    const orders = await this.prisma.completedOrder.count({
      where: { merchantId, completedAt: { gte: dayStart, lt: dayEnd } },
    });

    // Sum revenue (orderTotal is a Decimal; convert to cents)
    const revenueAgg = await this.prisma.completedOrder.aggregate({
      where: { merchantId, completedAt: { gte: dayStart, lt: dayEnd } },
      _sum: { orderTotal: true },
    });
    const orderTotalSum = revenueAgg._sum.orderTotal ?? 0;
    const revenueInCents = typeof orderTotalSum === 'number' ? Math.round(orderTotalSum * 100) : Number(orderTotalSum) * 100;

    const avgOrderValue = orders > 0 ? Math.round(revenueInCents / orders) : 0;
    const conversionRate = conversations > 0 ? orders / conversations : 0;

    await this.analyticsRepo.upsertDailyMetric(merchantId, dayStart, {
      conversations,
      orders,
      revenueInCents,
      avgOrderValue,
      conversionRate: Math.round(conversionRate * 10000) / 10000,
    });
  }

  private yesterday(): Date {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d;
  }
}
