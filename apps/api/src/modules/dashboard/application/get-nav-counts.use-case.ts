import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

export interface NavCountsOutput {
  orders: number;
  messages: number;
  cartRecovery: number;
}

const EPOCH = new Date(0);

/**
 * Computes sidebar badge counts as UNREAD-ONLY: for each section, counts items
 * that appeared after the merchant last viewed that section (tracked in
 * NavBadgeView). Viewing a section (MarkBadgeViewedUseCase) advances the
 * timestamp, so the badge drops to 0 and only re-appears for genuinely new items.
 * This keeps badges meaningful instead of a perpetual, ever-growing total.
 */
export class GetNavCountsUseCase {
  private readonly logger = new Logger(GetNavCountsUseCase.name);

  constructor(private readonly prisma: PrismaClient) {}

  async execute(merchantId: string): Promise<NavCountsOutput> {
    try {
      const views = await this.prisma.navBadgeView.findMany({
        where: { merchantId },
        select: { badgeKey: true, lastViewedAt: true },
      });
      const since = (key: string): Date =>
        views.find((v) => v.badgeKey === key)?.lastViewedAt ?? EPOCH;

      const [orders, messages, cartRecovery] = await Promise.all([
        // Orders shipped after last view (awaiting delivery confirmation)
        this.prisma.completedOrder.count({
          where: {
            merchantId,
            status: "shipped",
            completedAt: { gt: since("orders") },
          },
        }),
        // Support tickets opened after last view
        this.prisma.supportTicket.count({
          where: {
            merchantId,
            status: { in: ["open", "in_progress"] },
            createdAt: { gt: since("messages") },
          },
        }),
        // Cart recovery attempts pending after last view
        this.prisma.recoveryAttempt.count({
          where: {
            merchantId,
            status: "pending",
            createdAt: { gt: since("cart-recovery") },
          },
        }),
      ]);

      return { orders, messages, cartRecovery };
    } catch (error) {
      this.logger.error(`Failed to get nav counts for ${merchantId}:`, error);
      // Graceful fallback: all zeros on error, nav still renders but won't show badges
      return { orders: 0, messages: 0, cartRecovery: 0 };
    }
  }
}
