import { Injectable, Inject } from "@nestjs/common";
import {
  ANALYTICS_REPOSITORY_PORT,
  AnalyticsRepositoryPort,
  DashboardResult,
} from "../../infrastructure/repositories/prisma-analytics.repository.js";

export type DashboardPeriod = "today" | "week" | "month";

@Injectable()
export class GetDashboardMetricsUseCase {
  constructor(@Inject(ANALYTICS_REPOSITORY_PORT) private readonly analyticsRepo: AnalyticsRepositoryPort) {}

  async execute(merchantId: string, period: DashboardPeriod = "week"): Promise<DashboardResult> {
    const now = new Date();
    const { from, to, prevFrom, prevTo } = this.resolvePeriod(now, period);

    const [current, previous] = await Promise.all([
      this.analyticsRepo.getDailyMetrics(merchantId, from, to),
      this.analyticsRepo.getDailyMetrics(merchantId, prevFrom, prevTo),
    ]);

    const totalRevenue = current.reduce((s, d) => s + d.revenueInCents, 0);
    const totalOrders = current.reduce((s, d) => s + d.orders, 0);
    const conversations = current.reduce((s, d) => s + d.conversations, 0);
    const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
    const conversionRate = conversations > 0 ? totalOrders / conversations : 0;

    const prevRevenue = previous.reduce((s, d) => s + d.revenueInCents, 0);
    const prevOrders = previous.reduce((s, d) => s + d.orders, 0);

    return {
      totalRevenue,
      totalOrders,
      avgOrderValue,
      conversionRate: Math.round(conversionRate * 10000) / 10000,
      conversations,
      trend: {
        revenueDelta: prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 10000) / 100 : 0,
        ordersDelta: prevOrders > 0 ? Math.round(((totalOrders - prevOrders) / prevOrders) * 10000) / 100 : 0,
      },
      daily: current,
    };
  }

  private resolvePeriod(now: Date, period: DashboardPeriod) {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (period === "today") {
      const prevDay = new Date(today);
      prevDay.setDate(prevDay.getDate() - 1);
      return { from: today, to: now, prevFrom: prevDay, prevTo: today };
    }

    if (period === "week") {
      const from = new Date(today);
      from.setDate(from.getDate() - 7);
      const prevFrom = new Date(from);
      prevFrom.setDate(prevFrom.getDate() - 7);
      return { from, to: today, prevFrom, prevTo: from };
    }

    // month
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    const prevFrom = new Date(from);
    prevFrom.setDate(prevFrom.getDate() - 30);
    return { from, to: today, prevFrom, prevTo: from };
  }
}
