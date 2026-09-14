import { nextBillingPeriod } from "../../../domain/services/billing-period.js";
import { Inject, Injectable } from "@nestjs/common";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type PaymentPlatformRepository,
  type SaveBillingSubscriptionInput,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { BillingSubscriptionSnapshot } from "../../../domain/payment-platform.types.js";
import { OrderQuotaService } from "../../services/order-quota.service.js";

export interface HandleAsaasBillingWebhookInput {
  event: string;
  subscriptionId?: string;
  eventId?: string;
  paymentId?: string;
  paymentValueCents?: number;
  paymentDueAt?: string;
  occurredAt?: string;
}

@Injectable()
export class HandleAsaasBillingWebhookUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    private readonly orderQuota?: OrderQuotaService,
  ) {}

  async execute(input: HandleAsaasBillingWebhookInput) {
    const { event, subscriptionId, eventId } = input;

    if (!subscriptionId || !eventId || !input.occurredAt) {
      return { outcome: "ignored" };
    }

    const merchantId = await this.repository.findMerchantByAsaasSubscriptionId(
      subscriptionId,
    );
    if (!merchantId) {
      return { outcome: "ignored" };
    }

    const occurredAt = new Date(input.occurredAt);
    if (Number.isNaN(occurredAt.getTime())) return { outcome: "ignored" };

    const outcome = await this.repository.processBillingWebhook(
      { eventId, merchantId, subscriptionId, paymentId: input.paymentId, occurredAt: occurredAt.toISOString() },
      (billing) => this.decideMutation({ input, merchantId, billing, occurredAt }),
    );
    if (outcome === "processed") await this.orderQuota?.reconcileMerchant(merchantId);
    return { outcome, merchantId };
  }

  private decideMutation(input: {
    input: HandleAsaasBillingWebhookInput;
    merchantId: string;
    billing: BillingSubscriptionSnapshot;
    occurredAt: Date;
  }): SaveBillingSubscriptionInput | undefined {
    const { input: webhook, merchantId, billing, occurredAt } = input;
    if (webhook.event === "PAYMENT_CONFIRMED" || webhook.event === "PAYMENT_RECEIVED") {
      // An authenticated event still cannot grant a plan unless it matches the
      // exact pending charge. This rejects late, unrelated or underpaid events.
      if (billing.lastBillingPaymentId === webhook.paymentId) return undefined;
      if ((billing.billingCycle === "annual" || billing.pendingBillingCycle || billing.lastBillingPaymentDueAt) && !webhook.paymentDueAt) return undefined;
      const paymentDueAt = new Date(webhook.paymentDueAt ?? occurredAt);
      if (Number.isNaN(paymentDueAt.getTime())) return undefined;
      if (billing.lastBillingPaymentDueAt && paymentDueAt.getTime() <= new Date(billing.lastBillingPaymentDueAt).getTime()) return undefined;
      const scheduledChange = Boolean(billing.pendingPlanKey && billing.pendingPlanEffectiveAt &&
        paymentDueAt.toISOString().slice(0, 10) >= billing.pendingPlanEffectiveAt.slice(0, 10));
      const expectedAmount = scheduledChange ? billing.pendingBillingAmountCents ?? billing.billingAmountCents :
        billing.pendingUpgradeAmountCents ?? billing.billingAmountCents;
      if (
        billing.status === "cancelled" ||
        !webhook.paymentId ||
        !Number.isSafeInteger(webhook.paymentValueCents) ||
        !Number.isSafeInteger(expectedAmount) ||
        webhook.paymentValueCents !== expectedAmount
      ) return undefined;

      const scheduledDowngrade = scheduledChange;
      const planKey = billing.pendingUpgradePlanKey ?? (scheduledDowngrade ? billing.pendingPlanKey : billing.planKey);
      if (!planKey) return undefined;
      const billingCycle = scheduledChange ? billing.pendingBillingCycle ?? billing.billingCycle ?? "monthly" : billing.billingCycle ?? "monthly";
      const nextPeriodEnd = nextBillingPeriod(paymentDueAt, billingCycle);
      return {
        merchantId,
        status: "active",
        planKey,
        billingAmountCents: expectedAmount,
        billingCycle,
        billingDiscountPercent: scheduledChange ? billing.pendingBillingDiscountPercent ?? 0 : billing.billingDiscountPercent ?? 0,
        pendingBillingCycle: scheduledChange ? null : undefined,
        pendingBillingAmountCents: scheduledChange ? null : undefined,
        pendingBillingDiscountPercent: scheduledChange ? null : undefined,
        currentPeriodEnd: nextPeriodEnd.toISOString(),
        pendingPlanKey: scheduledDowngrade ? null : undefined,
        pendingPlanEffectiveAt: scheduledDowngrade ? null : undefined,
        pendingUpgradePlanKey: null,
        pendingUpgradeAmountCents: null,
        pendingUpgradeRequestedAt: null,
        lastBillingEventAt: occurredAt.toISOString(),
        lastBillingPaymentId: webhook.paymentId,
        lastBillingPaymentDueAt: webhook.paymentDueAt ?? null,
      };
    }
    if (webhook.event === "PAYMENT_OVERDUE") {
      if (webhook.paymentId === billing.lastBillingPaymentId ||
          (billing.lastBillingEventAt && occurredAt.getTime() <= new Date(billing.lastBillingEventAt).getTime()) ||
          (webhook.paymentDueAt && billing.lastBillingPaymentDueAt && new Date(webhook.paymentDueAt).getTime() <= new Date(billing.lastBillingPaymentDueAt).getTime())) return undefined;
      return { merchantId, status: "past_due", lastBillingEventAt: occurredAt.toISOString() };
    }
    if (
      webhook.event === "SUBSCRIPTION_DELETED" ||
      (webhook.event === "SUBSCRIPTION_INACTIVATED" && !billing.cancelAtPeriodEnd)
    ) {
      return {
        merchantId,
        status: "cancelled",
        cancelAtPeriodEnd: false,
        providerCancellationScheduledAt: null,
        pendingBillingCycle: null,
        pendingBillingAmountCents: null,
        pendingBillingDiscountPercent: null,
        pendingPlanKey: null,
        pendingPlanEffectiveAt: null,
        pendingUpgradePlanKey: null,
        pendingUpgradeAmountCents: null,
        pendingUpgradeRequestedAt: null,
        lastBillingEventAt: occurredAt.toISOString(),
      };
    }
    return undefined;
  }
}
