import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { PrismaBuyerEarnedBenefitRepository } from "../../../buyer-account/infrastructure/prisma-buyer-earned-benefit.repository.js";
import { PostSaleConfigService } from "../services/post-sale-config.service.js";

export interface CheckLoyaltyMilestoneInput {
  merchantId: string;
  buyerId: string;
  purchaseCount: number;
  buyerPhone?: string;
  buyerEmail?: string;
  buyerName?: string;
  /**
   * Platform-wide buyer id (INV: global_user_id). Falls back to buyerId when the
   * caller already passes the global user id (see on-order-completed.handler).
   */
  globalUserId?: string;
}

const DEFAULT_MILESTONES: Record<number, number> = {
  3: 5,
  5: 10,
  10: 15,
};

/**
 * Parse a comma-separated milestone list like "3,5,10" into a record of
 * milestone → discount percent. Each milestone defaults to a base discount
 * if no explicit percent is given (e.g. "3" → 3%, "5" → 5%, "10" → 10%).
 * Returns the platform defaults when the input is empty/malformed.
 */
function parseMilestones(raw: string | undefined): Record<number, number> {
  const fallback = { ...DEFAULT_MILESTONES };
  if (!raw || typeof raw !== "string") return fallback;
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return fallback;
  const out: Record<number, number> = {};
  for (const t of tokens) {
    // Accept "3", "3=7" (count=3, 7% off), "3:7" (same).
    const eq = t.split(/[=:]/);
    const count = Number(eq[0]);
    if (!Number.isInteger(count) || count <= 0) continue;
    // Explicit percent wins; otherwise reuse the platform default for that
    // milestone (3→5%, 5→10%, 10→15%); last resort, discount = count.
    const explicit = eq.length > 1 ? Number(eq[1]) : NaN;
    const pct = Number.isFinite(explicit) ? explicit : (DEFAULT_MILESTONES[count] ?? count);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) continue;
    out[count] = Math.round(pct);
  }
  return Object.keys(out).length > 0 ? out : fallback;
}

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "LY";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

@Injectable()
export class CheckLoyaltyMilestoneUseCase {
  private readonly logger = new Logger(CheckLoyaltyMilestoneUseCase.name);

  constructor(
    @Inject(SCHEDULED_MESSAGE_REPOSITORY)
    private readonly messages: ScheduledMessageRepositoryPort,
    @Inject(PRISMA_CLIENT)
    private readonly prisma: PrismaClient,
    private readonly config: PostSaleConfigService
  ) {}

  async execute(input: CheckLoyaltyMilestoneInput): Promise<{ milestoneHit: boolean; skipped?: string }> {
    const cfg = await this.config.getConfig(input.merchantId);
    if (!cfg.loyaltyEnabled) {
      return { milestoneHit: false, skipped: "loyalty_disabled" };
    }

    const milestones = parseMilestones(cfg.loyaltyMilestones);
    const discountPercent = milestones[input.purchaseCount];
    if (!discountPercent) {
      return { milestoneHit: false };
    }

    try {
      const code = generateCouponCode();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
      const couponId = `ly-${input.buyerId}-${Date.now()}`.slice(0, 50);

      await (this.prisma as any).coupon.create({
        data: {
          id: couponId,
          merchantId: input.merchantId,
          code,
          discountType: "percent",
          discountValue: discountPercent,
          maxUsages: 1,
          maxPerBuyer: 1,
          status: "active",
          startsAt: new Date(),
          endsAt: expiresAt,
        },
      });

      await this.messages.create({
        merchantId: input.merchantId,
        buyerId: input.buyerId,
        orderId: `loyalty-${input.purchaseCount}-${Date.now()}`,
        type: "loyalty",
        channel: input.buyerPhone ? "whatsapp" : "email",
        sendAt: new Date(),
        buyerPhone: input.buyerPhone,
        buyerEmail: input.buyerEmail,
        buyerName: input.buyerName,
        metadata: {
          couponCode: code,
          discountPercent,
          milestone: input.purchaseCount,
          expiresAt: expiresAt.toISOString(),
        },
      });

      // F5-T03: record the earned benefit so it surfaces in the buyer hub
      // (GET /buyer/me/benefits → earned). Non-fatal: never breaks the milestone flow.
      const globalUserId = input.globalUserId ?? input.buyerId;
      try {
        const benefits = new PrismaBuyerEarnedBenefitRepository(this.prisma);
        await benefits.create({
          merchantId: input.merchantId,
          globalUserId,
          benefitType: "discount_percent",
          value: discountPercent,
          origin: "loyalty_milestone",
          reason: `Cliente fiel: ${discountPercent}% de desconto por ${input.purchaseCount} compras`,
          status: "active",
          expiresAt,
        });
      } catch (benefitErr) {
        this.logger.warn(
          `loyalty: earned benefit not recorded for buyer ${input.buyerId}: ${
            benefitErr instanceof Error ? benefitErr.message : String(benefitErr)
          }`
        );
      }

      this.logger.log(
        `loyalty milestone ${input.purchaseCount} hit for buyer ${input.buyerId}`
      );

      return { milestoneHit: true };
    } catch (err) {
      this.logger.error(
        `loyalty: failed for buyer ${input.buyerId}`,
        { error: err instanceof Error ? err.message : String(err) }
      );
      return { milestoneHit: false };
    }
  }
}
