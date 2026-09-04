import type { Prisma, PrismaClient } from "@prisma/client";
import { BuyerPurchaseHistoryEntity } from "../domain/entities/buyer-purchase-history.entity.js";
import type {
  BuyerPurchaseHistorySnapshot,
  PurchaseHistoryIdentity,
  PurchaseHistoryItem,
  PurchaseRecord
} from "../domain/buyer-purchase-history.types.js";
import type { BuyerPurchaseHistoryRepository } from "../domain/ports/buyer-purchase-history-repository.port.js";
import { toNumber } from "../../../shared/persistence/decimal.util.js";

export class PrismaBuyerPurchaseHistoryRepository implements BuyerPurchaseHistoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getByBuyer(identity: PurchaseHistoryIdentity): Promise<BuyerPurchaseHistoryEntity | undefined> {
    const where = identity.globalUserId
      ? { merchantId: identity.merchantId, globalUserId: identity.globalUserId }
      : { merchantId: identity.merchantId, merchantCustomerId: identity.merchantCustomerId };
    const rows = await this.prisma.buyerPurchaseRecord.findMany({
      where,
      orderBy: { completedAt: "asc" }
    });
    if (!rows.length) return undefined;

    return BuyerPurchaseHistoryEntity.rehydrate({
      merchantId: identity.merchantId,
      globalUserId: identity.globalUserId,
      merchantCustomerId: identity.merchantCustomerId,
      purchases: rows.map(toPurchaseRecord)
    });
  }

  async save(history: BuyerPurchaseHistoryEntity): Promise<BuyerPurchaseHistoryEntity> {
    const snapshot = history.snapshot();
    for (const purchase of snapshot.purchases) {
      await this.upsertPurchase(purchase);
    }
    return history;
  }

  async recordPurchase(purchase: PurchaseRecord): Promise<{ history: BuyerPurchaseHistoryEntity; idempotent: boolean }> {
    const existing = await this.prisma.buyerPurchaseRecord.findUnique({
      where: { merchantId_orderId: { merchantId: purchase.merchantId, orderId: purchase.orderId } }
    });
    if (!existing) {
      await this.upsertPurchase(purchase);
    }

    const history = await this.getByBuyer({
      merchantId: purchase.merchantId,
      globalUserId: purchase.globalUserId,
      merchantCustomerId: purchase.merchantCustomerId
    });

    return {
      history:
        history ??
        BuyerPurchaseHistoryEntity.rehydrate({
          merchantId: purchase.merchantId,
          globalUserId: purchase.globalUserId,
          merchantCustomerId: purchase.merchantCustomerId,
          purchases: [purchase]
        }),
      idempotent: Boolean(existing)
    };
  }

  private async upsertPurchase(purchase: PurchaseRecord): Promise<void> {
    await this.prisma.buyerPurchaseRecord.upsert({
      where: { merchantId_orderId: { merchantId: purchase.merchantId, orderId: purchase.orderId } },
      create: toCreate(purchase),
      update: toUpdate(purchase)
    });
  }
}

function toCreate(purchase: PurchaseRecord) {
  return {
    merchantId: purchase.merchantId,
    orderId: purchase.orderId,
    ...toUpdate(purchase)
  };
}

function toUpdate(purchase: PurchaseRecord) {
  return {
    globalUserId: purchase.globalUserId,
    merchantCustomerId: purchase.merchantCustomerId,
    currency: purchase.currency,
    totalAmount: purchase.totalAmount,
    discountAmount: purchase.discountAmount,
    completedAt: new Date(purchase.completedAt),
    items: purchase.items as unknown as Prisma.InputJsonValue
  };
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
