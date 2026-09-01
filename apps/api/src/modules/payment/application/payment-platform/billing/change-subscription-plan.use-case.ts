import { Inject, Injectable, BadRequestException } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import {
  BILLING_PROVIDER,
  type BillingProviderPort,
} from "../../../domain/ports/billing-provider.port.js";
import { BILLING_PLANS } from "../../../domain/billing-plans.js";
import type { BillingPlan } from "../../../domain/payment-platform.types.js";

export interface ChangeSubscriptionPlanInput {
  merchantId: string;
  targetPlanKey: BillingPlan;
}

@Injectable()
export class ChangeSubscriptionPlanUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
  ) {}

  async execute(input: ChangeSubscriptionPlanInput) {
    const billing = await this.repository.getBilling(input.merchantId);
    if (!billing) {
      throw new BadRequestException("no_subscription_found");
    }

    const currentPlan = billing.planKey ?? "starter";
    const currentPrice = BILLING_PLANS[currentPlan].monthlyPriceBrl;
    const targetPrice = BILLING_PLANS[input.targetPlanKey].monthlyPriceBrl;

    if (targetPrice === currentPrice) {
      return billing;
    }

    if (targetPrice > currentPrice) {
      // UPGRADE
      if (!billing.asaasSubscriptionId) {
        throw new BadRequestException("no_active_subscription_subscribe_first");
      }
      await this.provider.updateSubscription({
        subscriptionId: billing.asaasSubscriptionId,
        valueBrl: targetPrice,
      });
      await this.repository.saveBilling({
        merchantId: input.merchantId,
        planKey: input.targetPlanKey,
        pendingPlanKey: undefined,
        pendingPlanEffectiveAt: null,
      });
    } else {
      // DOWNGRADE: schedule for next period
      const currentPeriodEnd = billing.currentPeriodEnd
        ? new Date(billing.currentPeriodEnd)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.repository.saveBilling({
        merchantId: input.merchantId,
        pendingPlanKey: input.targetPlanKey,
        pendingPlanEffectiveAt: currentPeriodEnd.toISOString(),
      });
    }

    return this.repository.getBilling(input.merchantId);
  }
}
