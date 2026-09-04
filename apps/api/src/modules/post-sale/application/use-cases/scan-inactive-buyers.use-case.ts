import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  LOYALTY_TRACKER_REPOSITORY,
  type LoyaltyTrackerRepositoryPort,
  type BuyerLoyaltyTracker,
} from "../../domain/ports/loyalty-tracker-repository.port.js";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { PostSaleConfigService } from "../services/post-sale-config.service.js";

const MAX_PER_RUN = 50;
const DAYS_30 = 30 * 24 * 60 * 60 * 1000;
const DAYS_60 = 60 * 24 * 60 * 60 * 1000;
const DAYS_90 = 90 * 24 * 60 * 60 * 1000;

interface WinBackTier {
  discountPercent: number;
  freeShipping: boolean;
  label: string;
}

function determineTier(lastPurchaseAt: Date): WinBackTier {
  const daysInactive = Math.floor(
    (Date.now() - lastPurchaseAt.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysInactive >= 90) return { discountPercent: 15, freeShipping: true, label: "90d" };
  if (daysInactive >= 60) return { discountPercent: 10, freeShipping: false, label: "60d" };
  return { discountPercent: 5, freeShipping: false, label: "30d" };
}

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "WB";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable()
export class ScanInactiveBuyersUseCase {
  private readonly logger = new Logger(ScanInactiveBuyersUseCase.name);

  constructor(
    @Inject(LOYALTY_TRACKER_REPOSITORY)
    private readonly trackers: LoyaltyTrackerRepositoryPort,
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
    private readonly config: PostSaleConfigService
  ) {}

  async execute(): Promise<{ processed: number; couponsCreated: number; skipped: number; merchantsScanned: number }> {
    const now = new Date();
    const merchants = await (this.prisma as any).merchant.findMany({
      where: { status: { not: "deleted" } },
      select: { id: true },
      take: 200,
    });

    let processed = 0;
    let couponsCreated = 0;
    let skipped = 0;
    let merchantsScanned = 0;

    for (const { id: merchantId } of merchants) {
      try {
        const cfg = await this.config.getConfig(merchantId);
        if (!cfg.winBackEnabled) {
          skipped++;
          continue;
        }
        merchantsScanned++;
        const thresholdDays = Math.max(1, cfg.winBackThresholdDays);
        const inactiveBefore = new Date(now.getTime() - thresholdDays * 24 * 60 * 60 * 1000);

        const inactive = await this.trackers.findInactive({
          inactiveBefore,
          winBackBefore: inactiveBefore,
          limit: MAX_PER_RUN,
        });

        for (const tracker of inactive) {
          processed++;
          try {
            await this.processInactiveBuyer(tracker);
            couponsCreated++;
          } catch (err) {
            this.logger.error(
              `win-back: failed for buyer ${tracker.buyerId}`,
              { merchantId, error: err instanceof Error ? err.message : String(err) }
            );
          }
        }
      } catch (err) {
        this.logger.error(
          `win-back: merchant loop failed`,
          { merchantId, error: err instanceof Error ? err.message : String(err) }
        );
      }
    }

    if (couponsCreated > 0) {
      this.logger.log(
        `win-back scanner: merchants=${merchantsScanned} processed=${processed} coupons=${couponsCreated} skipped=${skipped}`
      );
    }

    return { processed, couponsCreated, skipped, merchantsScanned };
  }

  private async processInactiveBuyer(tracker: BuyerLoyaltyTracker): Promise<void> {
    if (!tracker.lastPurchaseAt) return;

    const tier = determineTier(tracker.lastPurchaseAt);
    const code = generateCouponCode();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create coupon directly via Prisma
    const couponId = `wb-${tracker.buyerId}-${Date.now()}`.slice(0, 50);
    await (this.prisma as any).coupon.create({
      data: {
        id: couponId,
        merchantId: tracker.merchantId,
        code,
        discountType: "percent",
        discountValue: tier.discountPercent,
        maxUsages: 1,
        maxPerBuyer: 1,
        status: "active",
        startsAt: new Date(),
        endsAt: expiresAt,
      },
    });

    // Schedule win-back message
    await this.messages.create({
      merchantId: tracker.merchantId,
      buyerId: tracker.buyerId,
      orderId: `winback-${Date.now()}`,
      type: "win_back",
      channel: "whatsapp",
      sendAt: new Date(),
      metadata: {
        couponCode: code,
        discountPercent: tier.discountPercent,
        freeShipping: tier.freeShipping,
        tierLabel: tier.label,
        expiresAt: expiresAt.toISOString(),
      },
    });

    // Update lastWinBackAt
    await this.trackers.updateLastWinBack(tracker.merchantId, tracker.buyerId);
  }
}
