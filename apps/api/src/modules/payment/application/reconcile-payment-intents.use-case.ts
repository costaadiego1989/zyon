import { ResumePaymentCreationService } from "./resume-payment-creation.service.js";
import { savePaymentTransition } from "./services/save-payment-transition.js";
import { Inject, Injectable, Optional , Logger} from "@nestjs/common";
import type { CurrencyCode } from "@zyon/shared-types";
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
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { MarkCommerceOrderPaidUseCase } from "../../commerce/application/mark-commerce-order-paid.use-case.js";

export type ReconcilePaymentIntentsInput = {
  /** Intents idle for at least this many ms are reconciled. */
  staleAfterMs?: number;
  limit?: number;
};

export type ReconcileOutcome = "approved" | "failed" | "still_pending" | "unknown" | "skipped" | "completion_retried";

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
  private readonly logger = new Logger(ReconcilePaymentIntentsUseCase.name);

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
      let snap = intent.snapshot();
      if (!snap.providerPaymentId) {
        try { snap = await new ResumePaymentCreationService(this.payments, this.provider).execute(intent); }
        catch { reconciled.push({ paymentIntentId: snap.id, outcome: "unknown" }); continue; }
        if (!snap.providerPaymentId) { reconciled.push({ paymentIntentId: snap.id, outcome: "unknown" }); continue; }
      }

      try {
      const authoritative = await this.provider.fetchPaymentStatus({
        provider: snap.creation?.input.provider,
        providerAccountFingerprint: snap.creation?.input.providerAccountFingerprint,
        merchantId: snap.merchantId,
        providerPaymentId: snap.providerPaymentId
      });

      const outcome = await this.applyAuthoritativeState(PaymentIntentEntity.rehydrate(snap), authoritative.state, authoritative.approvedAmountCents);
      reconciled.push({ paymentIntentId: snap.id, outcome });
      } catch { reconciled.push({ paymentIntentId: snap.id, outcome: "unknown" }); }
    }

    // R2P-P03: Recover intents approved but whose checkout completion was lost
    // (crash between markApproved and completeAfterApproval). These are no longer
    // "pending" so listStalePending never picks them up.
    const staleApproved = await this.payments.listStaleApproved?.({ olderThan, limit });
    if (staleApproved?.length) {
      for (const intent of staleApproved) {
        const snap = intent.snapshot();
        try {
          await this.checkoutPayment.completeAfterApproval({
            paymentIntentId: snap.id, amountBreakdown: snap.amountBreakdown,
            merchantId: snap.merchantId,
            sessionId: snap.sessionId,
            externalOrderId: snap.providerPaymentId!,
            orderTotalMajorUnits: majorUnitsFromCents(snap.amountCents),
            currency: snap.currency as CurrencyCode,
            acceptedOfferId: snap.acceptedOfferId
          });
          await this.markLinkedCommerceOrderPaid(snap, snap.providerPaymentId!);
          this.logger.log(`reconcile_approved_completion_retried: intent=${snap.id}`);
          reconciled.push({ paymentIntentId: snap.id, outcome: "completion_retried" });
        } catch (err) {
          this.logger.warn(`reconcile_approved_completion_failed: intent=${snap.id} err=${(err as Error).message}`);
          reconciled.push({ paymentIntentId: snap.id, outcome: "skipped" });
        }
      }
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
      const cents = approvedAmountCents;
      if (cents !== snap.amountCents) {
        return "unknown";
      }
      intent.markApproved({ providerPaymentId: snap.providerPaymentId!, approvedAmountCents: snap.amountCents });
      await savePaymentTransition(this.payments, intent, "reconciliation");
      this.metrics?.paymentApproved.inc({ merchant_id: snap.merchantId });
      await this.checkoutPayment.completeAfterApproval({
            paymentIntentId: snap.id, amountBreakdown: snap.amountBreakdown,
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
    await savePaymentTransition(this.payments, intent, reason);
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
