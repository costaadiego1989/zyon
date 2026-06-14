import { Inject, Injectable, Optional } from "@nestjs/common";
import type { CurrencyCode } from "@aacp/shared-types";
import { PaymentIntentEntity, type PaymentIntentSnapshot } from "../domain/payment-intent.entity.js";
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository
} from "../domain/ports/payment-repository.port.js";
import {
  PAYMENT_PROVIDER_PORT,
  type PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT, type CheckoutPaymentPort } from "../domain/ports/checkout-payment.port.js";
import { MetricsService } from "../../../shared/observability/metrics.service.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";

export type ReconcilePaymentIntentsInput = {
  /** Intents idle for at least this many ms are reconciled. */
  staleAfterMs?: number;
  limit?: number;
};

export type ReconcileOutcome = "approved" | "failed" | "still_pending" | "unknown" | "skipped";

export type ReconcilePaymentIntentsResult = {
  scanned: number;
  reconciled: Array<{ paymentIntentId: string; outcome: ReconcileOutcome }>;
};

const DEFAULT_STALE_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_LIMIT = 50;

function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

@Injectable()
export class ReconcilePaymentIntentsUseCase {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Inject(CHECKOUT_PAYMENT_PORT) private readonly checkoutPayment: CheckoutPaymentPort,
    @Optional() private readonly metrics?: MetricsService,
    @Optional() private readonly markCommerceOrderPaid?: MarkCommerceOrderPaidUseCase
  ) {}

  async execute(input: ReconcilePaymentIntentsInput = {}): Promise<ReconcilePaymentIntentsResult> {
    if (!this.provider.fetchPaymentStatus) {
      return { scanned: 0, reconciled: [] };
    }

    const staleAfterMs = input.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
    const limit = input.limit ?? DEFAULT_LIMIT;
    const olderThan = new Date(Date.now() - staleAfterMs);

    const candidates = await this.payments.listStalePending({ olderThan, limit });
    const reconciled: ReconcilePaymentIntentsResult["reconciled"] = [];

    for (const intent of candidates) {
      const snap = intent.snapshot();
      if (!snap.providerPaymentId) {
        reconciled.push({ paymentIntentId: snap.id, outcome: "skipped" });
        continue;
      }

      const authoritative = await this.provider.fetchPaymentStatus({
        merchantId: snap.merchantId,
        providerPaymentId: snap.providerPaymentId
      });

      const outcome = await this.applyAuthoritativeState(intent, authoritative.state, authoritative.approvedAmountCents);
      reconciled.push({ paymentIntentId: snap.id, outcome });
    }

    return { scanned: candidates.length, reconciled };
  }

  private async applyAuthoritativeState(
    intent: PaymentIntentEntity,
    state: "approved" | "failed" | "pending" | "unknown",
    approvedAmountCents: number | undefined
  ): Promise<ReconcileOutcome> {
    const snap = intent.snapshot();

    if (state === "approved") {
      const cents = approvedAmountCents ?? snap.amountCents;
      if (cents !== snap.amountCents) {
        return this.fail(intent, "reconcile_value_mismatch");
      }
      intent.markApproved({ providerPaymentId: snap.providerPaymentId!, approvedAmountCents: snap.amountCents });
      await this.payments.saveIntent({ intent });
      await this.checkoutPayment.recordPaymentStatusChanged({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        paymentIntentId: snap.id,
        status: "approved",
        reason: "reconciliation",
        commerceOrderId: snap.commerceOrderId
      });
      this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });
      await this.checkoutPayment.completeAfterApproval({
        merchantId: snap.merchantId,
        sessionId: snap.sessionId,
        externalOrderId: snap.providerPaymentId!,
        orderTotalMajorUnits: majorUnitsFromCents(snap.amountCents),
        currency: snap.currency as CurrencyCode,
        acceptedOfferId: snap.acceptedOfferId
      });
      await this.markLinkedCommerceOrderPaid(snap, snap.providerPaymentId!);
      return "approved";
    }

    if (state === "failed") {
      return this.fail(intent, "reconciliation");
    }

    return state === "pending" ? "still_pending" : "unknown";
  }

  private async fail(intent: PaymentIntentEntity, reason: string): Promise<ReconcileOutcome> {
    const snap = intent.snapshot();
    intent.markFailed(reason);
    await this.payments.saveIntent({ intent });
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
    return "failed";
  }

  private async markLinkedCommerceOrderPaid(snap: PaymentIntentSnapshot, paymentReference: string): Promise<void> {
    const commerceOrderId = snap.commerceOrderId?.trim();
    if (!commerceOrderId || !this.markCommerceOrderPaid) return;
    await this.markCommerceOrderPaid.execute({
      merchantId: snap.merchantId,
      commerceOrderId,
      paymentReference
    });
  }
}
