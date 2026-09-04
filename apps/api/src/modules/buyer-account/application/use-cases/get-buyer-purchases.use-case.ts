import { Inject, Injectable, Optional , Logger} from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";
import {
  BUYER_PURCHASE_HISTORY_REPOSITORY,
  type BuyerPurchaseHistoryRepository
} from "../../../buyer-purchase-history/domain/ports/buyer-purchase-history-repository.port.js";
import { PURCHASE_HISTORY_STORAGE_MODE, type PurchaseHistoryStorageMode } from "../../../buyer-purchase-history/domain/ports/purchase-history-storage-mode.port.js";
import { toNumber } from "../../../../shared/persistence/decimal.util.js";
import type { PurchaseRecord as PurchaseHistoryRecord } from "../../../buyer-purchase-history/domain/buyer-purchase-history.types.js";
import { ORDER_REPOSITORY, type OrderRepository } from "../../../checkout/domain/ports/order.repository.port.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../integrations/domain/ports/integrations.repository.port.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

export interface GetBuyerPurchasesRequest {
  globalUserId: string;
  merchantId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  limit?: number;
  cursor?: string;
}

export interface PurchaseRecordDto {
  id: string;
  orderId: string;
  merchantId: string;
  merchantName: string;
  trackingCode?: string | null;
  trackingStatus?: string | null;
  trackingUrl?: string | null;
  carrier?: string | null;
  trackingEvents: PurchaseTrackingEventDto[];
  totalAmount: number;
  discountAmount: number;
  currency: string;
  completedAt: Date;
  paymentMethod?: string | null;
  items: unknown;
}

export interface PurchaseTrackingEventDto {
  status: string;
  description: string;
  location?: string | null;
  occurredAt: Date;
}

export interface PurchasePage {
  records: PurchaseRecordDto[];
  nextCursor: string | null;
}

@Injectable()
export class GetBuyerPurchasesUseCase {
  private readonly logger = new Logger(GetBuyerPurchasesUseCase.name);

  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional()
    @Inject(BUYER_PURCHASE_HISTORY_REPOSITORY)
    private readonly purchaseHistory?: BuyerPurchaseHistoryRepository,
    @Optional() @Inject(ORDER_REPOSITORY) private readonly orders?: OrderRepository,
    @Optional() @Inject(INTEGRATIONS_REPOSITORY) private readonly integrations?: IntegrationsRepository,
    @Optional() @Inject(PURCHASE_HISTORY_STORAGE_MODE) private readonly storageMode?: PurchaseHistoryStorageMode
  ) {}

  async execute(input: GetBuyerPurchasesRequest): Promise<PurchasePage> {
    if (!this.storageMode || this.storageMode.usesPrisma()) {
      return this.executePrisma(input);
    }
    return this.executeRepository(input);
  }

  private async executePrisma(input: GetBuyerPurchasesRequest): Promise<PurchasePage> {
    const limit = Math.min(input.limit ?? 20, 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;

    const rows = await this.prisma.buyerPurchaseRecord.findMany({
      where: {
        globalUserId: input.globalUserId,
        ...(input.merchantId && { merchantId: input.merchantId }),
        ...(input.dateFrom || input.dateTo
          ? {
              completedAt: {
                ...(input.dateFrom && { gte: input.dateFrom }),
                ...(input.dateTo && { lte: input.dateTo }),
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { completedAt: { lt: cursor.completedAt } },
                { completedAt: cursor.completedAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const merchantIds = [...new Set(page.map((r) => r.merchantId))];
    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: merchantIds } },
      select: { id: true, name: true },
    });
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));
    const completedOrders = page.length
      ? await this.prisma.completedOrder.findMany({
          where: {
            OR: page.map((r) => ({
              merchantId: r.merchantId,
              externalOrderId: r.orderId,
            })),
          },
          select: {
            merchantId: true,
            externalOrderId: true,
            trackingCode: true,
            sessionId: true,
          },
        })
      : [];
    const trackingByOrder = new Map(
      completedOrders.map((order) => [
        `${order.merchantId}:${order.externalOrderId}`,
        order.trackingCode,
      ])
    );

    // Resolve payment method via the payment intent tied to each order's session.
    const sessionByOrder = new Map(
      completedOrders
        .filter((o) => o.sessionId)
        .map((o) => [`${o.merchantId}:${o.externalOrderId}`, o.sessionId as string])
    );
    const sessionIds = [...new Set([...sessionByOrder.values()])];
    const paymentIntents = sessionIds.length
      ? await this.prisma.paymentIntent.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { merchantId: true, sessionId: true, method: true, status: true },
        })
      : [];
    // Prefer a paid/confirmed intent when several exist for one session.
    const paymentBySession = new Map<string, string>();
    for (const pi of paymentIntents) {
      const key = `${pi.merchantId}:${pi.sessionId}`;
      if (!paymentBySession.has(key) || pi.status === "paid" || pi.status === "confirmed") {
        paymentBySession.set(key, pi.method);
      }
    }
    const shipments = await listShipmentsForPurchases(this.prisma, page.map((r) => ({
      merchantId: r.merchantId,
      orderId: r.orderId
    })));
    const shipmentByOrder = new Map(
      shipments.map((shipment) => [
        `${shipment.merchantId}:${shipment.externalOrderId}`,
        shipment
      ])
    );

    const records: PurchaseRecordDto[] = page.map((r) => {
      const key = `${r.merchantId}:${r.orderId}`;
      const shipment = shipmentByOrder.get(key);
      const trackingCode = shipment?.trackingCode ?? trackingByOrder.get(key) ?? null;
      const sessionId = sessionByOrder.get(key);
      const paymentMethod = sessionId ? paymentBySession.get(`${r.merchantId}:${sessionId}`) ?? null : null;
      return {
        id: r.id,
        orderId: r.orderId,
        merchantId: r.merchantId,
        merchantName: merchantMap.get(r.merchantId) ?? r.merchantId,
        trackingCode,
        trackingStatus: shipment?.status ?? (trackingCode ? "label_generated" : null),
        trackingUrl: shipment?.trackingUrl ?? null,
        carrier: shipment?.carrier ?? null,
        trackingEvents: (shipment?.trackingEvents ?? []).map((event) => ({
          status: event.status,
          description: event.description,
          location: event.location ?? null,
          occurredAt: event.occurredAt
        })),
        totalAmount: toNumber(r.totalAmount),
        discountAmount: toNumber(r.discountAmount),
        currency: r.currency,
        completedAt: r.completedAt,
        paymentMethod,
        items: r.items,
      };
    });

    const last = records[records.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.completedAt, last.id) : null;

    return { records, nextCursor };
  }

  private async executeRepository(input: GetBuyerPurchasesRequest): Promise<PurchasePage> {
    if (!this.purchaseHistory) return { records: [], nextCursor: null };

    const limit = Math.min(input.limit ?? 20, 100);
    const cursor = input.cursor ? decodeCursor(input.cursor) : null;
    const merchantId = input.merchantId?.trim();
    const rows = (
      merchantId
        ? ((await this.purchaseHistory.getByBuyer({
            merchantId,
            globalUserId: input.globalUserId
          }))?.snapshot().purchases ?? [])
        : await this.listPurchasesAcrossMerchants(input.globalUserId)
    )
      .filter((purchase) => isWithinRange(purchase, input))
      .filter((purchase) => isAfterCursor(purchase, cursor))
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.orderId.localeCompare(a.orderId));

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const records = await Promise.all(page.map((purchase) => this.toRepositoryRecord(purchase)));
    const last = records[records.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.completedAt, last.id) : null;

    return { records, nextCursor };
  }

  private async listPurchasesAcrossMerchants(globalUserId: string) {
    const repo = this.purchaseHistory as BuyerPurchaseHistoryRepository & {
      listPurchasesForGlobalUser?: (globalUserId: string) => Promise<PurchaseHistoryRecord[]>;
    };
    if (typeof repo.listPurchasesForGlobalUser === "function") {
      return repo.listPurchasesForGlobalUser(globalUserId);
    }
    return [];
  }

  private async toRepositoryRecord(purchase: PurchaseHistoryRecord): Promise<PurchaseRecordDto> {
    const shipment = await this.integrations?.getShipmentByExternalOrderId(purchase.merchantId, purchase.orderId);
    const order = await this.orders?.findCompletedOrderByExternalOrderId(purchase.merchantId, purchase.orderId);
    const trackingCode = shipment?.trackingCode ?? order?.trackingCode ?? null;
    const events = shipment?.trackingCode
      ? await this.integrations?.listTrackingEvents(purchase.merchantId, shipment.trackingCode)
      : [];

    return {
      id: `${purchase.merchantId}:${purchase.orderId}`,
      orderId: purchase.orderId,
      merchantId: purchase.merchantId,
      merchantName: purchase.merchantId,
      trackingCode,
      trackingStatus: shipment?.status ?? (trackingCode ? "label_generated" : null),
      trackingUrl: shipment?.trackingUrl ?? null,
      carrier: shipment?.carrier ?? null,
      trackingEvents: (events ?? []).map((event) => ({
        status: event.status,
        description: event.description,
        location: event.location ?? null,
        occurredAt: new Date(event.occurredAt)
      })),
      totalAmount: purchase.totalAmount,
      discountAmount: purchase.discountAmount,
      currency: purchase.currency,
      completedAt: new Date(purchase.completedAt),
      items: purchase.items
    };
  }
}

function isWithinRange(purchase: PurchaseHistoryRecord, input: GetBuyerPurchasesRequest): boolean {
  const completedAt = new Date(purchase.completedAt);
  if (input.dateFrom && completedAt < input.dateFrom) return false;
  if (input.dateTo && completedAt > input.dateTo) return false;
  return true;
}

function isAfterCursor(
  purchase: PurchaseHistoryRecord,
  cursor: { completedAt: Date; id: string } | null
): boolean {
  if (!cursor) return true;
  const completedAt = new Date(purchase.completedAt);
  const id = `${purchase.merchantId}:${purchase.orderId}`;
  return completedAt < cursor.completedAt || (completedAt.getTime() === cursor.completedAt.getTime() && id < cursor.id);
}

function encodeCursor(completedAt: Date, id: string): string {
  return Buffer.from(`${completedAt.toISOString()}:${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { completedAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  return {
    completedAt: new Date(decoded.slice(0, colonIdx)),
    id: decoded.slice(colonIdx + 1),
  };
}

type PurchaseShipmentRecord = {
  merchantId: string;
  externalOrderId: string;
  trackingCode: string;
  trackingUrl?: string | null;
  carrier?: string | null;
  status: string;
  trackingEvents?: PurchaseTrackingEventDto[];
};

async function listShipmentsForPurchases(
  prisma: PrismaClient,
  purchases: Array<{ merchantId: string; orderId: string }>
): Promise<PurchaseShipmentRecord[]> {
  if (!purchases.length) return [];
  const shipmentDelegate = (prisma as unknown as {
    shipment?: {
      findMany(args: unknown): Promise<PurchaseShipmentRecord[]>;
    };
  }).shipment;
  if (!shipmentDelegate) return [];
  return shipmentDelegate.findMany({
    where: {
      OR: purchases.map((purchase) => ({
        merchantId: purchase.merchantId,
        externalOrderId: purchase.orderId
      }))
    },
    select: {
      merchantId: true,
      externalOrderId: true,
      trackingCode: true,
      trackingUrl: true,
      carrier: true,
      status: true,
      trackingEvents: {
        select: {
          status: true,
          description: true,
          location: true,
          occurredAt: true
        },
        orderBy: { occurredAt: "asc" },
        take: 10
      }
    }
  });
}
