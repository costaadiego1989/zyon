import { quoteBilling } from "../../../infrastructure/billing-offers.js";
import { effectiveBillingPlan } from "../../../domain/billing-plans.js";
import type { BillingCycle } from "@zyon/shared-types";
import { STRIPE_PLATFORM_PORT, BILLING_CONFIG_PORT, type StripePlatformPort, type BillingConfigPort } from "../../../domain/ports/payment-platform-provider.port.js";
import { Inject, Injectable, BadRequestException, Optional } from "@nestjs/common";
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
  billingCycle?: BillingCycle;
}

@Injectable()
export class ChangeSubscriptionPlanUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(BILLING_PROVIDER)
    private readonly provider: BillingProviderPort,
    @Optional() @Inject(STRIPE_PLATFORM_PORT) private readonly stripe?: StripePlatformPort,
    @Optional() @Inject(BILLING_CONFIG_PORT) private readonly billingConfig?: BillingConfigPort,
  ) {}

  async execute(input: ChangeSubscriptionPlanInput) {
    const billing = await this.repository.getBilling(input.merchantId);
    if (!billing) {
      throw new BadRequestException("no_subscription_found");
    }

    if (!Object.hasOwn(BILLING_PLANS, input.targetPlanKey)) throw new BadRequestException("invalid_billing_selection");
    if (billing.status !== "active" || billing.cancelAtPeriodEnd) throw new BadRequestException("billing_subscription_change_unavailable");
    const currentPlan = effectiveBillingPlan(billing);
    const cycle = input.billingCycle ?? billing.billingCycle ?? "monthly";
    if (input.targetPlanKey === currentPlan && cycle === (billing.billingCycle ?? "monthly")) return billing;
    if (billing.pendingPlanKey || billing.pendingUpgradePlanKey) throw new BadRequestException("billing_change_already_pending");
    const offer = quoteBilling(input.targetPlanKey, cycle);
    // Every interval change and changes to an annual subscription take effect at renewal.
    if (cycle !== (billing.billingCycle ?? "monthly") || billing.billingCycle === "annual" || billing.provider === "stripe") {
      if (input.targetPlanKey === "starter") throw new BadRequestException("billing_use_cancellation_for_free");
      if (billing.pendingUpgradePlanKey) throw new BadRequestException("billing_change_already_pending");
      let effectiveAt = billing.currentPeriodEnd;
      if (!effectiveAt || new Date(effectiveAt).getTime() <= Date.now()) throw new BadRequestException("billing_period_end_unavailable");
      if (billing.provider === "stripe") {
        if (!billing.stripeSubscriptionId || !this.stripe?.scheduleBillingChange || !this.billingConfig) throw new BadRequestException("billing_subscription_change_unavailable");
        const result = await this.stripe.scheduleBillingChange({
          subscriptionId: billing.stripeSubscriptionId, merchantId: input.merchantId,
          priceId: this.billingConfig.priceId(input.targetPlanKey, cycle), offer,
        });
        effectiveAt = result.effectiveAt;
      } else {
        if (!billing.asaasSubscriptionId) throw new BadRequestException("no_active_subscription_subscribe_first");
        await this.provider.updateSubscription({ subscriptionId: billing.asaasSubscriptionId,
          valueBrl: offer.amountCents / 100, billingCycle: cycle, nextDueDate: effectiveAt.slice(0, 10) });
      }
      await this.repository.saveBilling({ merchantId: input.merchantId, pendingPlanKey: input.targetPlanKey,
        pendingBillingCycle: cycle, pendingBillingAmountCents: offer.amountCents,
        pendingBillingDiscountPercent: offer.discountPercent, pendingPlanEffectiveAt: effectiveAt });
      return this.repository.getBilling(input.merchantId);
    }
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
        // The provider mutation only changes the recurrence. Entitlement and
        // quota are activated by a correlated paid billing webhook.
        pendingUpgradePlanKey: input.targetPlanKey,
        pendingUpgradeAmountCents: Math.round(targetPrice * 100),
        pendingUpgradeRequestedAt: new Date().toISOString(),
      });
    } else {
      if (input.targetPlanKey === "starter") throw new BadRequestException("billing_use_cancellation_for_free");
      if (!billing.asaasSubscriptionId || !billing.currentPeriodEnd) throw new BadRequestException("billing_period_end_unavailable");
      await this.provider.updateSubscription({ subscriptionId: billing.asaasSubscriptionId,
        valueBrl: offer.amountCents / 100, billingCycle: cycle, nextDueDate: billing.currentPeriodEnd.slice(0, 10) });
      // DOWNGRADE: schedule for next period
      const currentPeriodEnd = billing.currentPeriodEnd
        ? new Date(billing.currentPeriodEnd)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await this.repository.saveBilling({
        merchantId: input.merchantId,
        pendingPlanKey: input.targetPlanKey,
        pendingBillingCycle: cycle,
        pendingBillingAmountCents: offer.amountCents,
        pendingBillingDiscountPercent: offer.discountPercent,
        pendingPlanEffectiveAt: currentPeriodEnd.toISOString(),
      });
    }

    return this.repository.getBilling(input.merchantId);
  }
}
