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
      },
    });

    if (existing) {
      return { reservationId: existing.id, expiresAt: existing.expiresAt };
    }

    const result = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const stock = await tx.productStock.findFirst({
        where: { variantId: input.variantId },
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

      await tx.productStock.update({
        where: { id: stock.id },
        data: { reserved: { increment: input.quantity } },
      });

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
}
