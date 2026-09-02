import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient, Prisma } from "@prisma/client";
import { StockRepositoryPort, ReserveStockInput, ReserveStockResult } from "../../domain/ports/product-repository.port.js";

@Injectable()
export class PrismaStockRepository implements StockRepositoryPort {
  private readonly logger = new Logger(PrismaStockRepository.name);

  constructor(private readonly prisma: PrismaClient) {}

  async reserve(input: ReserveStockInput): Promise<ReserveStockResult> {
    const existing = await this.prisma.stockReservation.findFirst({
      where: {
        variantId: input.variantId,
        cartId: input.idempotencyKey,
        status: "ACTIVE",
        variant: { product: { merchantId: input.merchantId } },
      },
    });

    if (existing) {
      return { reservationId: existing.id, expiresAt: existing.expiresAt };
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Scope stock lookup to the merchant boundary: a variant's stock is only
      // reservable by the merchant that owns the parent product. Without this
      // filter, any merchant could reserve (and via confirm, decrement) another
      // tenant's stock by guessing a variantId.
      const stock = await tx.productStock.findFirst({
        where: {
          variantId: input.variantId,
          variant: { product: { merchantId: input.merchantId } },
        },
      });

      if (!stock) {
        throw new Error("stock_not_found");
      }

      const available = stock.quantity - stock.reserved;
      if (available < input.quantity) {
        throw new Error("insufficient_stock");
      }

      const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min

      const reservation = await tx.stockReservation.create({
        data: {
          variantId: input.variantId,
          cartId: input.idempotencyKey,
          quantity: input.quantity,
          status: "ACTIVE",
          expiresAt,
        },
      });

      // Atomic: only reserve if available > 0 (prevents TOCTOU race)
      const updated = await tx.productStock.updateMany({
        where: {
          id: stock.id,
          quantity: { gte: stock.reserved + input.quantity }
        },
        data: { reserved: { increment: input.quantity } },
      });

      if (updated.count === 0) {
        throw new Error("stock_insufficient");
      }

      return reservation;
    });

    return { reservationId: result.id, expiresAt: result.expiresAt };
  }

  async confirm(merchantId: string, reservationId: string): Promise<void> {
    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const reservation = await tx.stockReservation.findUnique({
        where: { id: reservationId },
        include: { variant: { include: { product: { select: { merchantId: true } } } } },
      });

      if (!reservation) throw new Error("reservation_not_found");
      if (reservation.variant.product.merchantId !== merchantId) throw new Error("forbidden");
      if (reservation.status !== "ACTIVE") throw new Error("reservation_not_active");

      await tx.productStock.updateMany({
        where: { variantId: reservation.variantId },
        data: {
          quantity: { decrement: reservation.quantity },
          reserved: { decrement: reservation.quantity },
        },
      });

      await tx.stockReservation.update({
        where: { id: reservationId },
        data: { status: "CONFIRMED" },
      });
    });
  }

  async releaseExpired(): Promise<number> {
    const now = new Date();

    const expired = await this.prisma.stockReservation.findMany({
      where: { status: "ACTIVE", expiresAt: { lt: now } },
    });

    if (expired.length === 0) return 0;

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      for (const reservation of expired) {
        await tx.productStock.updateMany({
          where: { variantId: reservation.variantId },
          data: { reserved: { decrement: reservation.quantity } },
        });
      }

      await tx.stockReservation.updateMany({
        where: { id: { in: expired.map((r) => r.id) } },
        data: { status: "EXPIRED" },
      });
    });

    this.logger.log(`Released ${expired.length} expired stock reservations`);
    return expired.length;
  }

  async getAvailableStock(variantId: string): Promise<{ quantity: number; reserved: number }> {
    const stock = await this.prisma.productStock.findFirst({
      where: { variantId },
    });

    return { quantity: stock?.quantity ?? 0, reserved: stock?.reserved ?? 0 };
  }

  async decrementBySku(
    merchantId: string,
    sku: string,
    quantity: number,
  ): Promise<{ ok: boolean; quantity?: number }> {
    if (quantity <= 0) return { ok: false };
    // Resolve the merchant's variant for this sku (tenant boundary).
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId } },
      select: { id: true },
    });
    if (!variant) return { ok: false };

    // Atomic, never-negative decrement (same conditional-where guard as confirm).
    const updated = await this.prisma.productStock.updateMany({
      where: { variantId: variant.id, quantity: { gte: quantity } },
      data: { quantity: { decrement: quantity } },
    });
    if (updated.count === 0) {
      this.logger.warn("stock.decrementBySku.insufficient", { merchantId, sku, quantity });
      return { ok: false };
    }
    const row = await this.prisma.productStock.findFirst({ where: { variantId: variant.id } });
    return { ok: true, quantity: row?.quantity };
  }

  async getStockBySku(
    merchantId: string,
    sku: string,
  ): Promise<{ variantId: string; quantity: number; reserved: number } | null> {
    const variant = await this.prisma.productVariant.findFirst({
      where: { sku, product: { merchantId } },
      select: { id: true, stock: true },
    });
    if (!variant) return null;
    const s = variant.stock?.[0];
    return { variantId: variant.id, quantity: s?.quantity ?? 0, reserved: s?.reserved ?? 0 };
  }
}
