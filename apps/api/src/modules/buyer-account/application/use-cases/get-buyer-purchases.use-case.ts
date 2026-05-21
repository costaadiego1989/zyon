import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { BUYER_ACCOUNT_PRISMA_CLIENT } from "../../buyer-account.tokens.js";

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
  constructor(
    @Inject(BUYER_ACCOUNT_PRISMA_CLIENT) private readonly prisma: PrismaClient
  ) {}

  async execute(input: GetBuyerPurchasesRequest): Promise<PurchasePage> {
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
          },
        })
      : [];
    const trackingByOrder = new Map(
      completedOrders.map((order) => [
        `${order.merchantId}:${order.externalOrderId}`,
        order.trackingCode,
      ])
    );
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
        totalAmount: r.totalAmount,
        discountAmount: r.discountAmount,
        currency: r.currency,
        completedAt: r.completedAt,
        items: r.items,
      };
    });

    const last = records[records.length - 1];
    const nextCursor = hasMore && last ? encodeCursor(last.completedAt, last.id) : null;

    return { records, nextCursor };
  }
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
