import type { BillingCycle } from "@zyon/shared-types";
import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { BillingSubscriptionSnapshot } from "../../../domain/payment-platform.types.js";
import { planFromPriceId, cycleFromPriceId } from "../../../domain/billing-plans.js";

@Injectable()
export class HandleStripePlatformEventUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async accountUpdated(input: {
    merchantId: string;
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirements: string[];
  }): Promise<void> {
    const current = await this.repository.getConnection(
      input.merchantId,
      "stripe",
    );
    await this.repository.saveConnection({
      merchantId: input.merchantId,
      provider: "stripe",
      environment: current?.environment ?? "test",
      status:
        input.chargesEnabled &&
        input.payoutsEnabled &&
        input.detailsSubmitted &&
        input.requirements.length === 0
          ? "active"
          : "restricted",
      externalAccountId: input.accountId,
      chargesEnabled: input.chargesEnabled,
      payoutsEnabled: input.payoutsEnabled,
      requirements: input.requirements,
      syncedAt: new Date().toISOString(),
    });
  }

  async checkoutCompleted(input: {
    merchantId: string;
    customerId?: string;
    subscriptionId?: string;
  }): Promise<void> {
    await this.repository.saveBilling({
      merchantId: input.merchantId,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      provider: "stripe",
    });
  }

  async subscriptionUpdated(input: {
    merchantId?: string;
    customerId: string;
    subscriptionId: string;
    priceId?: string;
    billingCycle?: BillingCycle;
    billingAmountCents?: number;
    billingDiscountPercent?: number;
    status: BillingSubscriptionSnapshot["status"];
    currentPeriodEnd?: string;
    cancelAtPeriodEnd: boolean;
  }): Promise<void> {
    const merchantId =
      input.merchantId ??
      (await this.repository.findMerchantByStripeSubscriptionId(
        input.subscriptionId,
      )) ??
      (await this.repository.findMerchantByStripeCustomerId(
        input.customerId,
      ));
    if (!merchantId) return;
    const current = await this.repository.getBilling(merchantId);
    if (current?.stripeSubscriptionId && current.stripeSubscriptionId !== input.subscriptionId &&
        (input.status === "cancelled" || input.status === "incomplete")) return;
    const nextPlan = planFromPriceId(input.priceId);
    const nextCycle = input.billingCycle ?? cycleFromPriceId(input.priceId);
    const applied = input.status === "cancelled" || current?.pendingPlanKey === nextPlan && current?.pendingBillingCycle === nextCycle &&
      Boolean(current?.pendingPlanEffectiveAt && input.currentPeriodEnd && input.currentPeriodEnd > current.pendingPlanEffectiveAt);
    await this.repository.saveBilling({
      merchantId,
      billingCycle: nextCycle,
      billingAmountCents: input.billingAmountCents,
      billingDiscountPercent: input.billingDiscountPercent,
      pendingPlanKey: applied ? null : undefined,
      pendingPlanEffectiveAt: applied ? null : undefined,
      pendingBillingCycle: applied ? null : undefined,
      pendingBillingAmountCents: applied ? null : undefined,
      pendingBillingDiscountPercent: applied ? null : undefined,
      stripeCustomerId: input.customerId,
      stripeSubscriptionId: input.subscriptionId,
      stripePriceId: input.priceId,
      provider: "stripe",
      planKey: planFromPriceId(input.priceId),
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      cancelAtPeriodEnd: input.cancelAtPeriodEnd,
    });
  }
}

