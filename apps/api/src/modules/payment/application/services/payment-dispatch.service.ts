import { Inject, Injectable, Optional, type OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { savePaymentTransition } from "./save-payment-transition.js";
import { PaymentIntentConflictError } from "../../domain/payment-persistence.js";
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
export class PaymentDispatchService implements OnModuleInit {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment: CheckoutPaymentPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase,
    @Optional() @Inject(DOMAIN_EVENT_BUS) private readonly eventBus?: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.eventBus?.subscribe("payment.status.changed", async event => {
      const payload = event.payload as { status?: string; payment_intent_id?: string };
      if (payload?.status !== "approved") return;
      if (!payload.payment_intent_id) throw new Error("payment_completion_intent_required");
      await this.completeApprovedById(event.merchantId, payload.payment_intent_id);
    }, "payment.complete-approved.v1");
  }

  async completeApprovedById(merchantId: string, id: string): Promise<void> {
    const current = await this.payments.getIntentById(merchantId, id);
    if (!current) throw new Error("payment_completion_intent_not_found");
    const snapshot = current.snapshot();
    if (snapshot.status !== "approved") return;
    if (!snapshot.providerPaymentId) throw new Error("payment_completion_provider_id_required");
    await this.complete(snapshot, snapshot.providerPaymentId);
  }

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
      // The committed outbox event owns retry of checkout completion.
      await this.markLinkedCommerceOrderPaid(snap, providerPaymentId);
      return "already_approved";
    }

    // Mark approved in domain
    intentEntity.markApproved({
      providerPaymentId,
      approvedAmountCents: snap.amountCents
    });
    try { await savePaymentTransition(this.payments, intentEntity); }
    catch (error) {
      if (!(error instanceof PaymentIntentConflictError)) throw error;
      const current = await this.payments.getIntentById(snap.merchantId, snap.id);
      if (current?.status === "approved" && current.snapshot().providerPaymentId === providerPaymentId) return "already_approved";
      throw error;
    }

    this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });

    return this.complete(intentEntity.snapshot(), providerPaymentId);
  }

  private async complete(snap: PaymentIntentSnapshot, providerPaymentId: string): Promise<string> {
    await this.checkoutPayment.completeAfterApproval({
      paymentIntentId: snap.id,
      amountBreakdown: snap.amountBreakdown,
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
    if (snap.status !== "pending" && snap.status !== "requires_action") return;

    intentEntity.markFailed(reason);
    await savePaymentTransition(this.payments, intentEntity, reason);

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
    if (snap.status === "refunded") return;
    if (snap.status !== "approved") throw new Error("payment_refund_precedes_approval");

    intentEntity.markRefunded(reason);
    await savePaymentTransition(this.payments, intentEntity, reason);
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
