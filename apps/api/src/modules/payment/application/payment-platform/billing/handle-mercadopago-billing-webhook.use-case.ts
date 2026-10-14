import { Inject, Injectable } from "@nestjs/common";
import { nextBillingPeriod } from "../../../domain/services/billing-period.js";
import {
  MERCADOPAGO_BILLING_PORT,
  type MercadoPagoBillingAuthorizedPayment,
  type MercadoPagoBillingPort,
} from "../../../domain/ports/mercadopago-billing.port.js";
import {
  PAYMENT_PLATFORM_REPOSITORY,
  type BillingReceivableMutation,
  type BillingWebhookDecision,
  type PaymentPlatformRepository,
} from "../../../domain/ports/payment-platform-repository.port.js";
import type { BillingPlan } from "../../../domain/payment-platform.types.js";

export type MercadoPagoBillingWebhookInput = {
  type: "subscription_preapproval" | "subscription_authorized_payment";
  resourceId: string;
  eventId: string;
};

/**
 * Treats the Mercado Pago notification only as a wake-up signal. The state
 * stored in the journal always comes from the API resource fetched with the
 * platform billing credential, not from the public request body.
 */
@Injectable()
export class HandleMercadoPagoBillingWebhookUseCase {
  constructor(
    @Inject(PAYMENT_PLATFORM_REPOSITORY)
    private readonly repository: PaymentPlatformRepository,
    @Inject(MERCADOPAGO_BILLING_PORT)
    private readonly mercadoPago: MercadoPagoBillingPort,
  ) {}

  async execute(input: MercadoPagoBillingWebhookInput): Promise<{
    outcome: "processed" | "duplicate" | "ignored";
    merchantId?: string;
  }> {
    if (input.type === "subscription_preapproval") return this.handlePreapproval(input);
    return this.handleAuthorizedPayment(input);
  }

  private async handlePreapproval(input: MercadoPagoBillingWebhookInput) {
    const preapproval = await this.mercadoPago.getPreapproval(input.resourceId);
    if (!preapproval || preapproval.id !== input.resourceId) return { outcome: "ignored" as const };
    const merchantId = await this.repository.findMerchantByMercadoPagoPreapprovalId(preapproval.id);
    if (!merchantId || preapproval.externalReference !== `zyon_billing:${merchantId}`) {
      return { outcome: "ignored" as const };
    }
    const outcome = await this.repository.processBillingWebhook(
      {
        provider: "mercadopago",
        eventId: input.eventId,
        merchantId,
        subscriptionId: preapproval.id,
        occurredAt: preapproval.occurredAt,
      },
      (billing) => this.preapprovalDecision(merchantId, billing, preapproval.status, preapproval.nextPaymentAt, preapproval.occurredAt),
    );
    return { outcome, merchantId };
  }

  private async handleAuthorizedPayment(input: MercadoPagoBillingWebhookInput) {
    const payment = await this.mercadoPago.getAuthorizedPayment(input.resourceId);
    if (!payment || payment.id !== input.resourceId) return { outcome: "ignored" as const };
    const merchantId = await this.repository.findMerchantByMercadoPagoPreapprovalId(payment.preapprovalId);
    if (!merchantId) return { outcome: "ignored" as const };
    const outcome = await this.repository.processBillingWebhook(
      {
        provider: "mercadopago",
        eventId: input.eventId,
        merchantId,
        subscriptionId: payment.preapprovalId,
        paymentId: payment.id,
        occurredAt: payment.occurredAt,
      },
      (billing) => this.authorizedPaymentDecision(merchantId, billing, payment),
    );
    return { outcome, merchantId };
  }

  private preapprovalDecision(
    merchantId: string,
    billing: { status: string },
    providerStatus: string,
    nextPaymentAt: string | undefined,
    occurredAt: string,
  ): BillingWebhookDecision | undefined {
    const status = providerStatus.toLowerCase();
    const localStatus = status === "cancelled" ? "cancelled"
      : status === "paused" ? "paused"
        // An authorization is not proof that an installment was paid. The
        // authorized-payment resource is the only source that activates a
        // paid plan or writes a receivable. An existing trial stays intact.
        : status === "authorized" || status === "pending"
          ? billing.status === "trialing" ? "trialing" : "incomplete"
          : undefined;
    if (!localStatus) return undefined;
    if (billing.status === "cancelled" && localStatus !== "cancelled") return undefined;
    return {
      subscription: {
        merchantId,
        status: localStatus,
        ...(nextPaymentAt ? { currentPeriodEnd: nextPaymentAt } : {}),
        lastBillingEventAt: occurredAt,
      },
    };
  }

  private authorizedPaymentDecision(
    merchantId: string,
    billing: {
      status: string;
      planKey?: BillingPlan;
      pendingPlanKey?: BillingPlan;
      pendingUpgradePlanKey?: BillingPlan;
      pendingUpgradeAmountCents?: number;
      billingAmountCents?: number;
      billingCycle?: "monthly" | "annual";
      billingDiscountPercent?: number;
      pendingBillingCycle?: "monthly" | "annual";
      pendingBillingAmountCents?: number;
      pendingBillingDiscountPercent?: number;
    },
    payment: MercadoPagoBillingAuthorizedPayment,
  ): BillingWebhookDecision | undefined {
    const receivable = toReceivable(payment);
    if (!receivable) return undefined;
    const status = receivable.status;
    const base = { merchantId, lastBillingEventAt: payment.occurredAt };

    if (status === "paid") {
      const scheduledChange = Boolean(
        billing.pendingPlanKey &&
        billing.pendingBillingAmountCents !== undefined,
      );
      const expectedAmount = scheduledChange
        ? billing.pendingBillingAmountCents
        : billing.pendingUpgradeAmountCents ?? billing.billingAmountCents;
      const planKey = billing.pendingUpgradePlanKey
        ?? (scheduledChange ? billing.pendingPlanKey : billing.planKey);
      const billingCycle = scheduledChange
        ? billing.pendingBillingCycle ?? billing.billingCycle ?? "monthly"
        : billing.billingCycle ?? "monthly";
      const periodStart = payment.paidAt ?? payment.dueAt ?? payment.occurredAt;
      if (
        billing.status !== "cancelled" &&
        planKey &&
        expectedAmount !== undefined &&
        payment.amountCents === expectedAmount
      ) {
        return {
          subscription: {
            ...base,
            status: "active",
            planKey,
            billingAmountCents: scheduledChange ? billing.pendingBillingAmountCents : undefined,
            billingCycle: scheduledChange ? billingCycle : undefined,
            billingDiscountPercent: scheduledChange ? billing.pendingBillingDiscountPercent ?? 0 : undefined,
            currentPeriodEnd: nextBillingPeriod(new Date(periodStart), billingCycle).toISOString(),
            pendingPlanKey: scheduledChange ? null : undefined,
            pendingPlanEffectiveAt: scheduledChange ? null : undefined,
            pendingBillingCycle: scheduledChange ? null : undefined,
            pendingBillingAmountCents: scheduledChange ? null : undefined,
            pendingBillingDiscountPercent: scheduledChange ? null : undefined,
            pendingUpgradePlanKey: null,
            pendingUpgradeAmountCents: null,
            pendingUpgradeRequestedAt: null,
            lastBillingPaymentId: payment.id,
            lastBillingPaymentDueAt: payment.dueAt ?? null,
          },
          receivable,
        };
      }
    }

    if (status === "overdue" && billing.status !== "cancelled") {
      return { subscription: { ...base, status: "past_due" }, receivable };
    }
    return { subscription: base, receivable };
  }
}

function toReceivable(payment: MercadoPagoBillingAuthorizedPayment): BillingReceivableMutation | undefined {
  const status = receivableStatus(payment);
  if (!status) return undefined;
  return {
    providerPaymentId: payment.id,
    providerSubscriptionId: payment.preapprovalId,
    status,
    ...(payment.amountCents !== undefined ? { amountCents: payment.amountCents } : {}),
    currency: payment.currency,
    ...(payment.dueAt ? { dueAt: payment.dueAt } : {}),
    ...(status === "paid" ? { paidAt: payment.paidAt ?? payment.occurredAt } : {}),
    occurredAt: payment.occurredAt,
    eventId: payment.id,
  };
}

function receivableStatus(payment: MercadoPagoBillingAuthorizedPayment): BillingReceivableMutation["status"] | undefined {
  const paymentStatus = payment.paymentStatus?.toLowerCase();
  if (paymentStatus === "approved") return "paid";
  if (paymentStatus === "refunded" || paymentStatus === "charged_back") return "refunded";
  if (paymentStatus === "rejected" || paymentStatus === "cancelled") return "overdue";
  const status = payment.status.toLowerCase();
  if (status === "cancelled") return "cancelled";
  if (status === "scheduled" || status === "pending" || status === "in_process") return "open";
  return undefined;
}
