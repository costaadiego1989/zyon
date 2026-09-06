import { Injectable, Logger } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { StockRepositoryPort, ReserveStockInput, ReserveStockResult } from "../../domain/ports/product-repository.port.js";

@Injectable()
export class PrismaStockRepository implements StockRepositoryPort {
  private readonly logger = new Logger(PrismaStockRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async reserve(input: ReserveStockInput): Promise<ReserveStockResult> {
    if (typeof input.merchantId !== "string" || !input.merchantId.trim()) throw new Error("stock_not_found");
    if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new Error("invalid_stock_quantity");
    if (!input.idempotencyKey?.trim()) throw new Error("idempotency_key_required");

    return this.prisma.$transaction(async (tx) => {
      // All reservation writers lock this variant before reading its reservations.
      // Tenant ownership is checked before idempotent retries as well.
      if (!await this.lockVariant(tx, input.variantId, input.merchantId)) throw new Error("stock_not_found");
      const now = new Date();
      const existing = await tx.stockReservation.findFirst({
        where: { variantId: input.variantId, cartId: input.idempotencyKey },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        if (existing.quantity !== input.quantity) throw new Error("reservation_idempotency_conflict");
        if (existing.status === "EXPIRED" || (existing.status === "ACTIVE" && existing.expiresAt <= now)) {
          throw new Error("reservation_not_active");
        }
        return { reservationId: existing.id, expiresAt: existing.expiresAt };
      }
      const stocks = await tx.productStock.findMany({
        where: { variantId: input.variantId, variant: { product: { merchantId: input.merchantId } } },
        orderBy: { id: "asc" },
      });
      if (!stocks.length) throw new Error("stock_not_found");
      const stock = stocks.find((candidate) => candidate.quantity - candidate.reserved >= input.quantity);
      if (!stock) throw new Error("insufficient_stock");
      const updated = await tx.productStock.updateMany({
        where: { id: stock.id, variantId: input.variantId, reserved: stock.reserved, quantity: { gte: stock.reserved + input.quantity } },
        data: { reserved: { increment: input.quantity } },
      });
      if (updated.count !== 1) throw new Error("insufficient_stock");
      const reservation = await tx.stockReservation.create({
        data: {
          variantId: input.variantId,
          stockId: stock.id,
          cartId: input.idempotencyKey,
          quantity: input.quantity,
          status: "ACTIVE",
          expiresAt: new Date(now.getTime() + 30 * 60 * 1000),
        },
      });
      return { reservationId: reservation.id, expiresAt: reservation.expiresAt };
    });
  }

  async confirm(merchantId: string, reservationId: string): Promise<void> {
    if (typeof merchantId !== "string" || !merchantId.trim()) throw new Error("reservation_not_found");
    await this.prisma.$transaction(async (tx) => {
      const candidate = await tx.stockReservation.findFirst({ where: { id: reservationId, variant: { product: { merchantId } } } });
      if (!candidate || !await this.lockVariant(tx, candidate.variantId, merchantId)) throw new Error("reservation_not_found");
      const reservation = await tx.stockReservation.findUnique({ where: { id: reservationId } });
      if (!reservation) throw new Error("reservation_not_found");
      if (reservation.status === "CONFIRMED") return;
      if (reservation.status !== "ACTIVE" || reservation.expiresAt <= new Date()) throw new Error("reservation_not_active");
      if (!reservation.stockId) throw new Error("reservation_stock_unresolved");
      const claimed = await tx.stockReservation.updateMany({
        where: { id: reservationId, status: "ACTIVE", expiresAt: { gt: new Date() } },
        data: { status: "CONFIRMED" },
      });
      if (claimed.count !== 1) throw new Error("reservation_not_active");
      const updated = await tx.productStock.updateMany({
        where: { id: reservation.stockId, variantId: reservation.variantId, quantity: { gte: reservation.quantity }, reserved: { gte: reservation.quantity } },
        data: { quantity: { decrement: reservation.quantity }, reserved: { decrement: reservation.quantity } },
      });
      if (updated.count !== 1) throw new Error("stock_invariant_violation");
    });
  }

  async releaseExpired(): Promise<number> {
    const now = new Date();
    // Ambiguous legacy rows need reconciliation; never guess their warehouse.
    let released = 0;
    let cursor: string | undefined;
    for (;;) {
      const expired = await this.prisma.stockReservation.findMany({
        where: { status: "ACTIVE", expiresAt: { lte: now }, stockId: { not: null }, ...(cursor ? { id: { gt: cursor } } : {}) },
        orderBy: { id: "asc" },
        take: 100,
      });
      if (!expired.length) break;
      for (const candidate of expired) {
        released += await this.prisma.$transaction(async (tx) => {
          if (!await this.lockVariant(tx, candidate.variantId)) return 0;
          const reservation = await tx.stockReservation.findUnique({ where: { id: candidate.id } });
          if (!reservation?.stockId || reservation.status !== "ACTIVE" || reservation.expiresAt > now) return 0;
          const claimed = await tx.stockReservation.updateMany({
            where: { id: reservation.id, status: "ACTIVE", expiresAt: { lte: now } },
            data: { status: "EXPIRED" },
          });
          if (claimed.count !== 1) return 0;
          const updated = await tx.productStock.updateMany({
            where: { id: reservation.stockId, variantId: reservation.variantId, reserved: { gte: reservation.quantity } },
            data: { reserved: { decrement: reservation.quantity } },
          });
          if (updated.count !== 1) throw new Error("stock_invariant_violation");
          return 1;
        });
      }
      cursor = expired[expired.length - 1].id;
    }
    if (released) this.logger.log(`Released ${released} expired stock reservations`);
    return released;
  }

  private async lockVariant(tx: Prisma.TransactionClient, variantId: string, merchantId?: string): Promise<boolean> {
    const rows = merchantId === undefined
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM product_variants WHERE id = ${variantId} FOR UPDATE`
      : await tx.$queryRaw<Array<{ id: string }>>`
          SELECT v.id FROM product_variants v JOIN products p ON p.id = v.product_id
          WHERE v.id = ${variantId} AND p.merchant_id = ${merchantId} FOR UPDATE OF v`;
    return rows.length === 1;
  }

  async getAvailableStock(variantId: string): Promise<{ quantity: number; reserved: number }> {
    const stock = await this.prisma.productStock.findFirst({ where: { variantId }, orderBy: { id: "asc" } });
    return { quantity: stock?.quantity ?? 0, reserved: stock?.reserved ?? 0 };
  }

  async decrementBySku(merchantId: string, sku: string, quantity: number): Promise<{ ok: boolean; quantity?: number }> {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return { ok: false };
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId } }, select: { id: true },
    });
    if (!variant) return { ok: false };
    const updated = await this.prisma.productStock.updateMany({
      where: { variantId: variant.id, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (updated.count !== 1) return { ok: false };
    const stock = await this.prisma.productStock.findFirst({ where: { variantId: variant.id }, orderBy: { id: "asc" } });
    return { ok: true, quantity: stock?.quantity };
  }

  async getStockBySku(merchantId: string, sku: string): Promise<{ variantId: string; quantity: number; reserved: number } | null> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId } }, select: { id: true, stock: { orderBy: { id: "asc" }, take: 1 } },
    });
    if (!variant) return null;
    const stock = variant.stock[0];
    return { variantId: variant.id, quantity: stock?.quantity ?? 0, reserved: stock?.reserved ?? 0 };
  }

  async setQuantityBySku(merchantId: string, sku: string, quantity: number): Promise<{ ok: boolean }> {
    if (!Number.isSafeInteger(quantity) || quantity < 0) return { ok: false };
    const updated = await this.prisma.productStock.updateMany({
      where: { variant: { sku, product: { merchantId } }, reserved: { lte: quantity } }, data: { quantity },
    });
    return { ok: updated.count > 0 };
  }
}
