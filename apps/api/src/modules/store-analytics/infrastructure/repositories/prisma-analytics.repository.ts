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
  getProductAnalytics(merchantId: string, from: Date, to: Date): Promise<any[]>;
  getOfferRoi(merchantId: string, from: Date, to: Date): Promise<any>;
  getPaymentMetrics(merchantId: string, from: Date, to: Date): Promise<any>;
  getCustomerMetrics(merchantId: string, from: Date, to: Date): Promise<any>;
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

  async getProductAnalytics(merchantId: string, from: Date, to: Date): Promise<any[]> {
    // Aggregate by product across date range
    const productMetrics = await this.prisma.storeProductMetric.findMany({
      where: {
        merchantId,
        month: { gte: from, lte: to },
      },
    });

    // Group by productId and sum metrics
    const grouped = new Map<
      string,
      { impressions: number; addToCart: number; purchases: number; revenue: number }
    >();
    productMetrics.forEach((m: any) => {
      if (!grouped.has(m.productId)) {
        grouped.set(m.productId, { impressions: 0, addToCart: 0, purchases: 0, revenue: 0 });
      }
      const existing = grouped.get(m.productId)!;
      existing.impressions += m.impressions;
      existing.addToCart += m.addToCart;
      existing.purchases += m.purchases;
      existing.revenue += m.revenue;
    });

    // Fetch product names
    const productIds = Array.from(grouped.keys());
    const products = await this.prisma.product.findMany({
      where: { merchantId, id: { in: productIds } },
      select: { id: true, name: true },
    });
    const productMap = new Map(products.map((p) => [p.id, p.name]));

    // Build results
    return Array.from(grouped.entries())
      .map(([productId, metrics]) => ({
        productId,
        productName: productMap.get(productId) || "Unknown Product",
        impressions: metrics.impressions,
        addToCartCount: metrics.addToCart,
        purchaseCount: metrics.purchases,
        conversionRate: metrics.impressions > 0 ? Math.round((metrics.purchases / metrics.impressions) * 10000) / 10000 : 0,
        revenue: metrics.revenue,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  async getOfferRoi(merchantId: string, from: Date, to: Date): Promise<any> {
    // Count authorized offers shown
    const authorizedOffers = await this.prisma.authorizedOffer.findMany({
      where: {
        merchantId,
        expiresAt: { gte: from, lte: to },
      },
    });

    const totalOffersShown = authorizedOffers.length;

    // Count accepted offers
    const acceptedOffers = await this.prisma.acceptedOffer.findMany({
      where: {
        merchantId,
        acceptedAt: { gte: from, lte: to },
      },
    });

    const totalOffersAccepted = acceptedOffers.length;
    const acceptanceRate =
      totalOffersShown > 0 ? Math.round((totalOffersAccepted / totalOffersShown) * 10000) / 10000 : 0;

    // Calculate average discount
    const avgDiscountGiven =
      acceptedOffers.length > 0
        ? Math.round(
            (acceptedOffers.reduce((sum, o) => sum + Number(o.value), 0) / acceptedOffers.length) * 100,
          ) / 100
        : 0;

    // Get revenue for orders with accepted offers
    const ordersWithOffers = await this.prisma.completedOrder.findMany({
      where: {
        merchantId,
        acceptedOfferId: { not: null },
        completedAt: { gte: from, lte: to },
      },
    });
    const revenueFromOffers = ordersWithOffers.reduce((sum, o) => sum + Number(o.orderTotal), 0);

    // Get revenue for orders without offers (for comparison)
    const ordersWithoutOffers = await this.prisma.completedOrder.findMany({
      where: {
        merchantId,
        acceptedOfferId: null,
        completedAt: { gte: from, lte: to },
      },
    });
    const revenueWithoutOffers = ordersWithoutOffers.reduce((sum, o) => sum + Number(o.orderTotal), 0);

    // Calculate lift percent
    const liftPercent =
      revenueWithoutOffers > 0 ? Math.round(((revenueFromOffers - revenueWithoutOffers) / revenueWithoutOffers) * 100 * 100) / 100 : 0;

    return {
      totalOffersShown,
      totalOffersAccepted,
      acceptanceRate,
      avgDiscountGiven,
      revenueFromOffers: Math.round(revenueFromOffers * 100) / 100,
      revenueWithoutOffers: Math.round(revenueWithoutOffers * 100) / 100,
      liftPercent,
      period: { from, to },
    };
  }

  async getPaymentMetrics(merchantId: string, from: Date, to: Date): Promise<any> {
    const paymentIntents = await this.prisma.paymentIntent.findMany({
      where: {
        merchantId,
        createdAt: { gte: from, lte: to },
      },
    });

    const totalAttempts = paymentIntents.length;
    const successful = paymentIntents.filter((p) => p.status === "approved").length;
    const failed = paymentIntents.filter((p) => p.status === "failed").length;
    const failureRate = totalAttempts > 0 ? Math.round((failed / totalAttempts) * 10000) / 10000 : 0;

    // Group by provider
    const byProvider = new Map<string, { attempts: number; successful: number; failed: number }>();
    paymentIntents.forEach((p) => {
      const provider = p.method || "unknown";
      if (!byProvider.has(provider)) {
        byProvider.set(provider, { attempts: 0, successful: 0, failed: 0 });
      }
      const stats = byProvider.get(provider)!;
      stats.attempts += 1;
      if (p.status === "approved") stats.successful += 1;
      if (p.status === "failed") stats.failed += 1;
    });

    const byProviderResult = Array.from(byProvider.entries()).map(([provider, stats]) => ({
      provider,
      attempts: stats.attempts,
      successful: stats.successful,
      failed: stats.failed,
      failureRate:
        stats.attempts > 0 ? Math.round((stats.failed / stats.attempts) * 10000) / 10000 : 0,
    }));

    return {
      totalAttempts,
      successful,
      failed,
      failureRate,
      byProvider: byProviderResult,
      period: { from, to },
    };
  }

  async getCustomerMetrics(merchantId: string, from: Date, to: Date): Promise<any> {
    // Get all purchase records in the period
    const purchases = await this.prisma.buyerPurchaseRecord.findMany({
      where: {
        merchantId,
        completedAt: { gte: from, lte: to },
      },
    });

    const totalCustomers = new Set(purchases.map((p) => p.globalUserId || p.merchantCustomerId || p.id)).size;

    // Count new customers (first purchase in this period)
    const globalUserIds = purchases.filter((p) => p.globalUserId).map((p) => p.globalUserId!);
    const merchantCustomerIds = purchases.filter((p) => p.merchantCustomerId).map((p) => p.merchantCustomerId!);

    let newCustomers = 0;
    let returningCustomers = 0;

    if (globalUserIds.length > 0) {
      const earlierGlobalPurchases = await this.prisma.buyerPurchaseRecord.count({
        where: {
          merchantId,
          globalUserId: { in: globalUserIds },
          completedAt: { lt: from },
        },
      });
      const globalCustomerCount = new Set(globalUserIds).size;
      returningCustomers = earlierGlobalPurchases > 0 ? globalCustomerCount : 0;
      newCustomers += globalCustomerCount - (returningCustomers > 0 ? globalCustomerCount : 0);
    }

    if (merchantCustomerIds.length > 0) {
      const earlierMerchantPurchases = await this.prisma.buyerPurchaseRecord.count({
        where: {
          merchantId,
          merchantCustomerId: { in: merchantCustomerIds },
          completedAt: { lt: from },
        },
      });
      const merchantCustomerCount = new Set(merchantCustomerIds).size;
      returningCustomers += earlierMerchantPurchases > 0 ? merchantCustomerCount : 0;
      newCustomers += merchantCustomerCount - (earlierMerchantPurchases > 0 ? merchantCustomerCount : 0);
    }

    // Ensure counts add up
    newCustomers = Math.max(0, totalCustomers - returningCustomers);

    const repeatRate = totalCustomers > 0 ? Math.round((returningCustomers / totalCustomers) * 10000) / 10000 : 0;

    return {
      totalCustomers,
      newCustomers,
      returningCustomers,
      repeatRate,
      period: { from, to },
    };
  }
}
