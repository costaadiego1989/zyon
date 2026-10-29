import { Prisma, type PrismaClient } from "@prisma/client";
import { BuyerPurchaseHistoryEntity } from "../domain/entities/buyer-purchase-history.entity.js";
import type {
  BuyerPurchaseHistoryContext,
  PurchaseHistoryIdentity,
  PurchaseHistoryItem,
  PurchaseRecord
} from "../domain/buyer-purchase-history.types.js";
import type { BuyerPurchaseHistoryRepository } from "../domain/ports/buyer-purchase-history-repository.port.js";
import { toNumber } from "../../../shared/persistence/decimal.util.js";

const CONTEXT_PURCHASE_LIMIT = 100;
const RECENT_WINDOW_MS = 12 * 30 * 24 * 60 * 60 * 1000;

export class PrismaBuyerPurchaseHistoryRepository implements BuyerPurchaseHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getByBuyer(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryEntity | undefined> {
    const rows = await this.recentRows(identity);
    if (!rows.length) return undefined;

    return BuyerPurchaseHistoryEntity.rehydrate({
      merchantId: identity.merchantId,
      globalUserId: identity.globalUserId,
      merchantCustomerId: identity.merchantCustomerId,
      purchases: rows.reverse().map(toPurchaseRecord)
    });
  }

  async getContext(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryContext | undefined> {
    const where = whereForIdentity(identity);
    const recentSince = new Date(Date.now() - RECENT_WINDOW_MS);
    const [summary, rows] = await this.prisma.$transaction([
      this.prisma.buyerPurchaseRecord.aggregate({
        where,
        _count: { _all: true },
        _sum: { totalAmount: true },
        _max: { completedAt: true }
      }),
      this.prisma.buyerPurchaseRecord.findMany({
        where: { ...where, completedAt: { gte: recentSince } },
        orderBy: { completedAt: "desc" },
        take: CONTEXT_PURCHASE_LIMIT
      })
    ]);

    const ordersCount = summary._count._all;
    if (!ordersCount) return undefined;

    // Totals come from the aggregate. Recommendation hints are deliberately
    // derived from a bounded 12-month window so this read cannot grow forever.
    const recentHistory = BuyerPurchaseHistoryEntity.rehydrate({
      merchantId: identity.merchantId,
      globalUserId: identity.globalUserId,
      merchantCustomerId: identity.merchantCustomerId,
      purchases: rows.reverse().map(toPurchaseRecord)
    });
    const context = recentHistory.toSafeContext();
    const lifetimeValue = toNumber(summary._sum.totalAmount ?? 0);
    return {
      ...context,
      purchase_history: {
        ...context.purchase_history,
        known_buyer: true,
        orders_count: ordersCount,
        lifetime_value: lifetimeValue,
        average_order_value: roundMoney(lifetimeValue / ordersCount),
        last_order_at: summary._max.completedAt?.toISOString()
      }
    };
  }

  async recordPurchase(purchase: PurchaseRecord): Promise<{ ordersCount: number; idempotent: boolean }> {
    let idempotent = false;
    try {
      await this.prisma.buyerPurchaseRecord.create({ data: toCreate(purchase) });
    } catch (error) {
      if (!isUniqueOrderConflict(error)) throw error;
      idempotent = true;
    }

    const ordersCount = await this.prisma.buyerPurchaseRecord.count({
      where: whereForIdentity({
        merchantId: purchase.merchantId,
        globalUserId: purchase.globalUserId,
        merchantCustomerId: purchase.merchantCustomerId
      })
    });
    return { ordersCount, idempotent };
  }

  private async recentRows(identity: PurchaseHistoryIdentity) {
    return this.prisma.buyerPurchaseRecord.findMany({
      where: whereForIdentity(identity),
      orderBy: { completedAt: "desc" },
      take: CONTEXT_PURCHASE_LIMIT
    });
  }
}

function toCreate(purchase: PurchaseRecord) {
  return {
    merchantId: purchase.merchantId,
    orderId: purchase.orderId,
    globalUserId: purchase.globalUserId,
    merchantCustomerId: purchase.merchantCustomerId,
    currency: purchase.currency,
    totalAmount: purchase.totalAmount,
    discountAmount: purchase.discountAmount,
    completedAt: new Date(purchase.completedAt),
    items: purchase.items as unknown as Prisma.InputJsonValue
  };
}

function whereForIdentity(identity: PurchaseHistoryIdentity) {
  return identity.globalUserId
    ? { merchantId: identity.merchantId, globalUserId: identity.globalUserId }
    : { merchantId: identity.merchantId, merchantCustomerId: identity.merchantCustomerId };
}

function isUniqueOrderConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function toPurchaseRecord(row: {
  merchantId: string;
  orderId: string;
  globalUserId: string | null;
  merchantCustomerId: string | null;
  currency: string;
  totalAmount: { toNumber(): number } | number;
  discountAmount: { toNumber(): number } | number;
  completedAt: Date;
  items: unknown;
}): PurchaseRecord {
  return {
    merchantId: row.merchantId,
    orderId: row.orderId,
    globalUserId: row.globalUserId ?? undefined,
    merchantCustomerId: row.merchantCustomerId ?? undefined,
    currency: row.currency as PurchaseRecord["currency"],
    totalAmount: toNumber(row.totalAmount),
    discountAmount: toNumber(row.discountAmount),
    completedAt: row.completedAt.toISOString(),
    items: row.items as PurchaseHistoryItem[]
  };
}
