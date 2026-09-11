import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";

export interface HandleAsaasBillingWebhookInput {
  event: string;
  subscriptionId?: string;
}

@Injectable()
export class HandleAsaasBillingWebhookUseCase {
  private readonly logger = new Logger(HandleAsaasBillingWebhookUseCase.name);

  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
  ) {}

  async execute(input: HandleAsaasBillingWebhookInput) {
    const { event, subscriptionId } = input;

    if (!subscriptionId) {
      return { outcome: "ignored" };
    }

    const merchantId = await this.repository.findMerchantByAsaasSubscriptionId(
      subscriptionId,
    );
    if (!merchantId) {
      return { outcome: "ignored" };
    }

    const billing = await this.repository.getBilling(merchantId);
    if (!billing) {
      return { outcome: "ignored" };
    }

    const now = new Date();

    if (event === "PAYMENT_CONFIRMED" || event === "PAYMENT_RECEIVED") {
      // Payment webhooks are at-least-once and can arrive after a cancellation
      // was finalized. Never resurrect a subscription from a late delivery.
      if (billing.status === "cancelled") {
        return { outcome: "processed", merchantId };
      }
      if (billing.pendingPlanKey && billing.pendingPlanEffectiveAt) {
        const effectiveAt = new Date(billing.pendingPlanEffectiveAt);
        if (effectiveAt <= now) {
          const nextPeriodEnd = new Date(now);
          nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 30);

          await this.repository.saveBilling({
            merchantId,
            status: "active",
            planKey: billing.pendingPlanKey,
            pendingPlanKey: undefined,
            pendingPlanEffectiveAt: null,
            currentPeriodEnd: nextPeriodEnd.toISOString(),
          });
        }
      } else if (billing.status !== "active") {
        const nextPeriodEnd = new Date(now);
        nextPeriodEnd.setDate(nextPeriodEnd.getDate() + 30);

        await this.repository.saveBilling({
          merchantId,
          status: "active",
          currentPeriodEnd: nextPeriodEnd.toISOString(),
        });
      }
    } else if (event === "PAYMENT_OVERDUE") {
      await this.repository.saveBilling({
        merchantId,
        status: "past_due",
      });
    } else if (
      event === "SUBSCRIPTION_DELETED" ||
      // The application itself inactivates a recurrence to preserve access
      // through the already-paid period. An unsolicited inactivation must
      // retain the historical safety behavior and revoke the paid plan.
      (event === "SUBSCRIPTION_INACTIVATED" && !billing.cancelAtPeriodEnd)
    ) {
      await this.repository.saveBilling({
        merchantId,
        status: "cancelled",
        cancelAtPeriodEnd: false,
        providerCancellationScheduledAt: null,
        pendingPlanKey: null,
        pendingPlanEffectiveAt: null,
      });
    }

    return { outcome: "processed", merchantId };
  }
}
