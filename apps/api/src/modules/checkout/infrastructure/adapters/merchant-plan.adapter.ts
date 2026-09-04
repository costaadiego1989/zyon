import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { BILLING_PLANS, effectiveBillingPlan } from "../../../payment/domain/billing-plans.js";
import { PAYMENT_PLATFORM_REPOSITORY, type PaymentPlatformRepository } from "../../../payment/domain/ports/payment-platform-repository.port.js";
import type { MerchantPlanPort } from "../../domain/ports/merchant-plan.port.js";

@Injectable()
export class MerchantPlanAdapter implements MerchantPlanPort {
  private readonly logger = new Logger(MerchantPlanAdapter.name);

  constructor(
    @Optional() @Inject(PAYMENT_PLATFORM_REPOSITORY) private readonly paymentRepo?: PaymentPlatformRepository
  ) {}

  async resolveExperienceFlags(
    merchantId: string
  ): Promise<{ showBranding: boolean; voiceEnabled: boolean }> {
    try {
      if (!this.paymentRepo) {
        return { showBranding: true, voiceEnabled: false };
      }

      const sub = await this.paymentRepo.getBilling(merchantId);
      if (!sub) {
        return { showBranding: true, voiceEnabled: false };
      }

      const plan = effectiveBillingPlan({
        status: sub.status,
        trialEndsAt: sub.trialEndsAt,
        stripePriceId: sub.stripePriceId ?? undefined,
      });

      return {
        showBranding: !BILLING_PLANS[plan].features.whiteLabel,
        voiceEnabled: BILLING_PLANS[plan].features.voiceCheckout,
      };
    } catch (err) {
      this.logger.warn(`billing plan resolution failed (non-blocking)`, {
        merchantId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { showBranding: true, voiceEnabled: false };
    }
  }
}
