import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

export const NAV_BADGE_KEYS = ["orders", "messages", "cart-recovery"] as const;
export type NavBadgeKey = (typeof NAV_BADGE_KEYS)[number];

export function isNavBadgeKey(value: string): value is NavBadgeKey {
  return (NAV_BADGE_KEYS as readonly string[]).includes(value);
}

/**
 * Marks a nav-badge section as viewed by advancing its lastViewedAt to now.
 * Subsequent GetNavCountsUseCase calls will then count only items newer than
 * this timestamp, dropping the badge to 0 until genuinely new items arrive.
 */
export class MarkBadgeViewedUseCase {
  private readonly logger = new Logger(MarkBadgeViewedUseCase.name);

  constructor(private readonly prisma: PrismaClient) {}

  async execute(merchantId: string, badgeKey: NavBadgeKey): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.navBadgeView.upsert({
        where: { merchantId_badgeKey: { merchantId, badgeKey } },
        create: { merchantId, badgeKey, lastViewedAt: now },
        update: { lastViewedAt: now },
      });
    } catch (error) {
      // Non-critical: badge dismissal is best-effort. Log and swallow so the
      // nav interaction never fails on a transient DB error.
      this.logger.error(`Failed to mark badge ${badgeKey} viewed for ${merchantId}:`, error);
    }
  }
}
