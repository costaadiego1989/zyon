import { businessDateKey, resolveBusinessPeriod } from "../../../../shared/analytics/business-period.js";
import type { PrismaClient } from "@prisma/client";
import type {
  StoreOverview,
  StoreOverviewRecentOrder,
  StoreOverviewTopProduct,
  StorePeriod,
  TimeseriesDataPoint,
  TimeseriesResponse,
  Cart,
  CompletedOrderLineItem,
  CustomerHints,
} from "@zyon/shared-types";
import type { StoreOverviewReadModel } from "../../domain/ports/store-overview-read-model.port.js";
import { toNumber } from "../../../../shared/persistence/decimal.util.js";

export class PrismaStoreOverviewRepository implements StoreOverviewReadModel {
  constructor(private readonly prisma: PrismaClient) {}

  async storeOverview(merchantId: string, period: StorePeriod): Promise<StoreOverview> {
    const { from, to } = resolveBusinessPeriod(period);

    const [orders, allSessions] = await Promise.all([
      this.prisma.completedOrder.findMany({
        where: { merchantId, completedAt: { gte: from, lte: to } },
        orderBy: { completedAt: "desc" },
      }),
      this.prisma.checkoutSession.count({
        where: { merchantId, createdAt: { gte: from, lte: to } },
      }),
    ]);

    if (orders.length === 0 && allSessions === 0) {
      return {
        merchant_id: merchantId,
        period,
        revenue: 0,
        orders_count: 0,
        average_ticket: 0,
        products_sold: 0,
        new_customers: 0,
        abandonment_rate: 0,
        orders_by_status: {},
        top_products: [],
        recent_orders: [],
      };
    }

    const revenue = orders.reduce((sum, o) => sum + toNumber(o.orderTotal), 0);
    const ordersCount = orders.length;
    const averageTicket = ordersCount > 0 ? revenue / ordersCount : 0;

    const orderSessionIds = [...new Set(orders.map((order) => order.sessionId))];
    const orderSessions = orderSessionIds.length > 0
      ? await this.prisma.checkoutSession.findMany({
          where: { merchantId, sessionId: { in: orderSessionIds } },
          select: { sessionId: true, globalUserId: true, customer: true, cart: true },
        })
      : [];
    const sessionById = new Map(orderSessions.map((session) => [session.sessionId, session]));
    const buyerIds = [...new Set(orderSessions.map((session) => session.globalUserId).filter(Boolean))];
    const priorOrders = buyerIds.length > 0
      ? await this.prisma.completedOrder.findMany({
          where: {
            merchantId,
            completedAt: { lt: from },
            session: { globalUserId: { in: buyerIds } },
          },
          select: { session: { select: { globalUserId: true } } },
        })
      : [];
    const existingBuyerIds = new Set(priorOrders.map((order) => order.session.globalUserId));
    const newCustomers = buyerIds.filter((buyerId) => !existingBuyerIds.has(buyerId)).length;

    const productMap = new Map<string, { name: string; image_url?: string; quantity: number; revenue: number }>();

    for (const order of orders) {
      const snapshot = Array.isArray(order.lineItemsJson)
        ? order.lineItemsJson as unknown as CompletedOrderLineItem[]
        : undefined;
      const cart = sessionById.get(order.sessionId)?.cart as unknown as Cart | null;
      const items = snapshot?.map((item) => ({
        id: item.variantId ?? item.sku,
        name: item.name ?? item.sku,
        quantity: item.quantity,
        revenue: (item.unitPriceCents * item.quantity) / 100,
      })) ?? cart?.items?.map((item) => ({
        id: item.product_id ?? item.sku,
        name: item.name,
        quantity: item.quantity,
        revenue: item.price * item.quantity,
      })) ?? [];
      for (const item of items) {
        const existing = productMap.get(item.id);
        if (existing) {
          existing.quantity += item.quantity;
          existing.revenue += item.revenue;
        } else {
          productMap.set(item.id, {
            name: item.name,
            quantity: item.quantity,
            revenue: item.revenue,
          });
        }
      }
    }

    const productsSold = Array.from(productMap.values()).reduce((sum, p) => sum + p.quantity, 0);
    const abandonmentRate = allSessions > 0 ? Math.max(0, (allSessions - ordersCount) / allSessions) : 0;

    const ordersByStatus: Record<string, number> = {};
    for (const o of orders) {
      ordersByStatus[o.status] = (ordersByStatus[o.status] ?? 0) + 1;
    }

    const topProducts: StoreOverviewTopProduct[] = Array.from(productMap.entries())
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([product_id, data]) => ({ product_id, ...data }));

    const recentOrders: StoreOverviewRecentOrder[] = orders.slice(0, 10).map((o) => {
      const session = sessionById.get(o.sessionId);
      const customer = session?.customer as unknown as CustomerHints | null;
      return {
        id: o.externalOrderId,
        buyer_name: customer?.fullName ?? customer?.email ?? "Não identificado",
        total: toNumber(o.orderTotal),
        status: o.status,
        created_at: o.completedAt.toISOString(),
      };
    });

    return {
      merchant_id: merchantId,
      period,
      revenue: Math.round(revenue * 100) / 100,
      orders_count: ordersCount,
      average_ticket: Math.round(averageTicket * 100) / 100,
      products_sold: productsSold,
      new_customers: newCustomers,
      abandonment_rate: Math.round(abandonmentRate * 10000) / 10000,
      orders_by_status: ordersByStatus,
      top_products: topProducts,
      recent_orders: recentOrders,
    };
  }

  async timeseries(merchantId: string, period: StorePeriod): Promise<TimeseriesResponse> {
    const { from, to, dates } = resolveBusinessPeriod(period);

    const [orders, sessions] = await Promise.all([
      this.prisma.completedOrder.findMany({
        where: { merchantId, completedAt: { gte: from, lte: to } },
        select: { orderTotal: true, completedAt: true },
      }),
      this.prisma.checkoutSession.findMany({
        where: { merchantId, createdAt: { gte: from, lte: to } },
        select: { createdAt: true, sessionId: true },
      }),
    ]);

    const revenueDailyMap = new Map<string, number>();
    const ordersDailyMap = new Map<string, number>();
    const sessionsDailyMap = new Map<string, number>();

    for (const key of dates) {
      revenueDailyMap.set(key, 0);
      ordersDailyMap.set(key, 0);
      sessionsDailyMap.set(key, 0);
    }

    for (const o of orders) {
      const key = businessDateKey(o.completedAt);
      revenueDailyMap.set(key, (revenueDailyMap.get(key) ?? 0) + toNumber(o.orderTotal));
      ordersDailyMap.set(key, (ordersDailyMap.get(key) ?? 0) + 1);
    }

    for (const s of sessions) {
      const key = businessDateKey(s.createdAt);
      sessionsDailyMap.set(key, (sessionsDailyMap.get(key) ?? 0) + 1);
    }

    const revenueDailyArr: TimeseriesDataPoint[] = [];
    const ordersDailyArr: TimeseriesDataPoint[] = [];
    const sessionsDailyArr: TimeseriesDataPoint[] = [];
    const conversionDailyArr: TimeseriesDataPoint[] = [];

    for (const [date, revenue] of revenueDailyMap) {
      revenueDailyArr.push({ date, value: Math.round(revenue * 100) / 100 });
      const dayOrders = ordersDailyMap.get(date) ?? 0;
      const daySessions = sessionsDailyMap.get(date) ?? 0;
      ordersDailyArr.push({ date, value: dayOrders });
      sessionsDailyArr.push({ date, value: daySessions });
      conversionDailyArr.push({ date, value: daySessions > 0 ? Math.round((dayOrders / daySessions) * 10000) / 10000 : 0 });
    }

    return {
      merchant_id: merchantId,
      period,
      revenue_daily: revenueDailyArr,
      orders_daily: ordersDailyArr,
      sessions_daily: sessionsDailyArr,
      conversion_daily: conversionDailyArr,
    };
  }
}
