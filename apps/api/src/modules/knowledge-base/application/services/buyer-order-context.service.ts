import { Injectable, Inject, Logger } from "@nestjs/common";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PrismaClient } from "@prisma/client";

/**
 * Service to build buyer order context for support chat.
 * Queries recent completed orders for a buyer to provide context about order status and tracking.
 */
@Injectable()
export class BuyerOrderContextService {
  private readonly logger = new Logger(BuyerOrderContextService.name);

  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  /**
   * Get recent orders context for a buyer.
   * Used by support chat to answer "where is my order" type questions.
   *
   * @param merchantId - Tenant boundary
   * @param globalUserId - Optional buyer identifier; returns null if not provided
   * @returns Human-readable order context, or null if no orders or no globalUserId
   */
  async getRecentOrdersContext(merchantId: string, globalUserId?: string): Promise<string | null> {
    if (!globalUserId) {
      return null;
    }

    try {
      // Query up to 3 recent completed orders for this buyer on this merchant
      const orders = await this.prisma.completedOrder.findMany({
        where: {
          merchantId,
          session: {
            globalUserId,
          },
        },
        include: {
          session: {
            select: {
              customer: true,
            },
          },
        },
        orderBy: {
          completedAt: "desc",
        },
        take: 3,
      });

      if (!orders.length) {
        return null;
      }

      // Build context string with order details
      const orderLines = orders.map((order) => {
        const parts: string[] = [];

        // Order identifier
        if (order.externalOrderId) {
          parts.push(`Pedido #${order.externalOrderId}`);
        } else {
          parts.push(`Pedido ${order.id}`);
        }

        // Total
        parts.push(`Total: R$${order.orderTotal}`);

        // Status
        if (order.status) {
          parts.push(`Status: ${order.status}`);
        }

        // Tracking code
        if (order.trackingCode) {
          parts.push(`Rastreio: ${order.trackingCode}`);
        }

        // Completion date
        if (order.completedAt) {
          const date = new Date(order.completedAt);
          parts.push(`Data: ${date.toLocaleDateString("pt-BR")}`);
        }

        return parts.join(" | ");
      });

      const context = `Pedidos recentes do cliente:\n${orderLines.join("\n")}`;
      return context;
    } catch (err) {
      this.logger.warn(
        `Failed to fetch recent orders for buyer ${globalUserId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
