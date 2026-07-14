import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CurrencyCode } from "@zyon/shared-types";
import type { PaymentIntentEntity } from "../../domain/payment-intent.entity.js";
import type { PaymentIntentSnapshot } from "../../domain/payment-intent.entity.js";
import type { CheckoutPaymentPort } from "../../domain/ports/checkout-payment.port.js";
import { CHECKOUT_PAYMENT_PORT } from "../../domain/ports/checkout-payment.port.js";
import type { PaymentRepository } from "../../domain/ports/payment-repository.port.js";
import { PAYMENT_REPOSITORY } from "../../domain/ports/payment-repository.port.js";
import { MetricsService } from "../../../../shared/observability/metrics.service.js";
import { MarkCommerceOrderPaidUseCase } from "../../../commerce/application/mark-commerce-order-paid.use-case.js";

/**
 * Shared payment intent state-machine & checkout completion logic.
 * Extracted from both Stripe and Asaas webhook handlers (C1 fix).
 */
@Injectable()
export class PaymentDispatchService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment: CheckoutPaymentPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase
  ) {}

  /**
   * Mark intent approved, record checkout status change, and emit completion.
   * Used by both Stripe and Asaas webhook handlers after provider-specific validation.
   */
  async markApprovedAndComplete(
    intentEntity: PaymentIntentEntity,
    providerPaymentId: string
  ): Promise<string> {
    const snap = intentEntity.snapshot();

    if (snap.status === "approved") {
      await this.markLinkedCommerceOrderPaid(snap, providerPaymentId);
      return "already_approved";
    }

    // Mark approved in domain
    intentEntity.markApproved({
      providerPaymentId,
      approvedAmountCents: snap.amountCents
    });
    await this.payments.saveIntent({ intent: intentEntity });

    // Notify checkout layer
    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "approved",
      commerceOrderId: snap.commerceOrderId
    });

    this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });

    // Complete checkout flow
    await this.checkoutPayment.completeAfterApproval({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      externalOrderId: providerPaymentId,
      orderTotalMajorUnits: snap.amountCents / 100,
      currency: snap.currency as CurrencyCode,
      acceptedOfferId: snap.acceptedOfferId
    });

    const commerceSynced = await this.markLinkedCommerceOrderPaid(snap, providerPaymentId);

    return commerceSynced
      ? "checkout_completed_after_payment_and_commerce_paid"
      : "checkout_completed_after_payment";
  }

  /**
   * Mark intent as failed with reason, record status change and failure metrics.
   */
  async markFailed(
    intentEntity: PaymentIntentEntity,
    reason: string
  ): Promise<void> {
    const snap = intentEntity.snapshot();
    if (snap.status === "approved" || snap.status === "failed") return;

    intentEntity.markFailed(reason);
    await this.payments.saveIntent({ intent: intentEntity });

    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "failed",
      reason,
      commerceOrderId: snap.commerceOrderId
    });

    await this.checkoutPayment.recordPaymentFailure({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      reason
    });
  }

  /**
   * Mark intent as refunded.
   */
  async markRefunded(
    intentEntity: PaymentIntentEntity,
    reason: string
  ): Promise<void> {
    const snap = intentEntity.snapshot();
    if (snap.status !== "approved") return;

    intentEntity.markRefunded(reason);
    await this.payments.saveIntent({ intent: intentEntity });

    await this.checkoutPayment.recordPaymentStatusChanged({
      merchantId: snap.merchantId,
      sessionId: snap.sessionId,
      paymentIntentId: snap.id,
      status: "refunded",
      reason,
      commerceOrderId: snap.commerceOrderId
    });
  }

  private async markLinkedCommerceOrderPaid(
    snap: PaymentIntentSnapshot,
    paymentReference: string
  ): Promise<boolean> {
    const commerceOrderId = snap.commerceOrderId?.trim();
    if (!commerceOrderId || !this.markCommerceOrderPaid) return false;

    const result = await this.markCommerceOrderPaid.execute({
      merchantId: snap.merchantId,
      commerceOrderId,
      paymentReference
    });
    return result.invokedCommerceSync;
  }
}
