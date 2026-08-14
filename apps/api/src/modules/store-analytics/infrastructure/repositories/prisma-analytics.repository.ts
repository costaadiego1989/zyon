import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

export interface DailyMetric {
  date: string;
  conversations: number;
  orders: number;
  revenueInCents: number;
  avgOrderValue: number;
  conversionRate: number;
  avgSessionDuration: number;
}

export interface DashboardResult {
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  conversionRate: number;
  conversations: number;
  trend: {
    revenueDelta: number;
    ordersDelta: number;
  };
  daily: DailyMetric[];
}

export interface ProductMetricRow {
  productId: string;
  impressions: number;
  addToCart: number;
  purchases: number;
  revenue: number;
  conversionRate: number;
}

export const ANALYTICS_REPOSITORY_PORT = "AnalyticsRepositoryPort";

export interface AnalyticsRepositoryPort {
  getDailyMetrics(merchantId: string, from: Date, to: Date): Promise<DailyMetric[]>;
  getProductMetrics(merchantId: string, month: Date): Promise<ProductMetricRow[]>;
  upsertDailyMetric(merchantId: string, date: Date, data: Partial<DailyMetric>): Promise<void>;
  upsertProductMetric(
    merchantId: string,
    productId: string,
    month: Date,
    data: { impressions?: number; addToCart?: number; purchases?: number; revenue?: number },
  ): Promise<void>;
}

@Injectable()
export class PrismaAnalyticsRepository implements AnalyticsRepositoryPort {
  private readonly logger = new Logger(PrismaAnalyticsRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async getDailyMetrics(merchantId: string, from: Date, to: Date): Promise<DailyMetric[]> {
    const rows = await this.prisma.storeMetricDaily.findMany({
      where: { merchantId, date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
    });
    return rows.map((r) => ({
      date: r.date.toISOString().split("T")[0],
      conversations: r.conversations,
      orders: r.orders,
      revenueInCents: r.revenueInCents,
      avgOrderValue: r.avgOrderValue,
      conversionRate: r.conversionRate,
      avgSessionDuration: r.avgSessionDuration,
    }));
  }

  async getProductMetrics(merchantId: string, month: Date): Promise<ProductMetricRow[]> {
    const rows = await this.prisma.storeProductMetric.findMany({
      where: { merchantId, month },
      orderBy: { revenue: "desc" },
    });
    return rows.map((r) => ({
      productId: r.productId,
      impressions: r.impressions,
      addToCart: r.addToCart,
      purchases: r.purchases,
      revenue: r.revenue,
      conversionRate: r.impressions > 0 ? r.purchases / r.impressions : 0,
    }));
  }

  async upsertDailyMetric(merchantId: string, date: Date, data: Partial<DailyMetric>): Promise<void> {
    await this.prisma.storeMetricDaily.upsert({
      where: { merchantId_date: { merchantId, date } },
      create: {
        merchantId,
        date,
        conversations: data.conversations ?? 0,
        orders: data.orders ?? 0,
        revenueInCents: data.revenueInCents ?? 0,
        avgOrderValue: data.avgOrderValue ?? 0,
        conversionRate: data.conversionRate ?? 0,
        avgSessionDuration: data.avgSessionDuration ?? 0,
      },
      update: {
        conversations: data.conversations,
        orders: data.orders,
        revenueInCents: data.revenueInCents,
        avgOrderValue: data.avgOrderValue,
        conversionRate: data.conversionRate,
        avgSessionDuration: data.avgSessionDuration,
      },
    });
  }

  async upsertProductMetric(
    merchantId: string,
    productId: string,
    month: Date,
    data: { impressions?: number; addToCart?: number; purchases?: number; revenue?: number },
  ): Promise<void> {
    await this.prisma.storeProductMetric.upsert({
      where: { merchantId_productId_month: { merchantId, productId, month } },
      create: {
        merchantId,
        productId,
        month,
        impressions: data.impressions ?? 0,
        addToCart: data.addToCart ?? 0,
        purchases: data.purchases ?? 0,
        revenue: data.revenue ?? 0,
      },
      update: {
        ...(data.impressions !== undefined ? { impressions: { increment: data.impressions } } : {}),
        ...(data.addToCart !== undefined ? { addToCart: { increment: data.addToCart } } : {}),
        ...(data.purchases !== undefined ? { purchases: { increment: data.purchases } } : {}),
        ...(data.revenue !== undefined ? { revenue: { increment: data.revenue } } : {}),
      },
    });
  }
}
