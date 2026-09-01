import { Injectable, Inject, Logger } from "@nestjs/common";
import {
  SCHEDULED_MESSAGE_REPOSITORY,
  type ScheduledMessageRepositoryPort,
} from "../../domain/ports/scheduled-message-repository.port.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { PrismaBuyerEarnedBenefitRepository } from "../../../buyer-account/infrastructure/prisma-buyer-earned-benefit.repository.js";

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

const MILESTONES: Record<number, number> = {
  3: 5,
  5: 10,
  10: 15,
};

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
    private readonly prisma: PrismaClient
  ) {}

  async execute(input: CheckLoyaltyMilestoneInput): Promise<{ milestoneHit: boolean }> {
    const discountPercent = MILESTONES[input.purchaseCount];
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
