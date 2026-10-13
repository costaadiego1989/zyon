import { Inject, Injectable, Optional } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { readFulfillment } from "../../operations/domain/order-fulfillment.js";
import { RETAINED_MERCHANT_PAYMENT_PROVIDER, type RetainedMerchantPaymentProvider } from "../domain/ports/retained-merchant-payment.port.js";
import { PAYMENT_SETTLEMENT_LEDGER, type PaymentSettlementLedgerPort } from "../domain/ports/payment-settlement-ledger.port.js";
import type { CreateProviderPaymentInput } from "../domain/ports/payment-provider.port.js";
import type { MarketplaceCaptureEvidence } from "../../marketplace/domain/ports/marketplace-capture-provider.port.js";
import type { MarketplacePayoutRequest } from "../../marketplace/domain/ports/marketplace-payout-provider.port.js";
import { PaymentHoldLifecycleService } from "./payment-hold-lifecycle.service.js";
import { PAYMENT_REPOSITORY, type PaymentRepository } from "../domain/ports/payment-repository.port.js";

type Hold = { id: string; merchantId: string; paymentIntentId: string; provider: "stripe" | "asaas"; providerPaymentId: string;
  payoutDestination: string; totalAmountCents: number; platformFeeCents: number; providerFeeCents: number; merchantNetCents: number;
  captureEvidence: MarketplaceCaptureEvidence; fulfilledAt: Date | null; holdUntil: Date | null; payoutReference: string | null; payoutProviderTransferId: string | null };
const activeReturn = (hold: Hold) => ({ merchantId: hold.merchantId, orderId: hold.providerPaymentId,
  status: { notIn: ["REJECTED", "CANCELLED"] } });
const captureFields = ["provider", "environment", "accountFingerprint", "providerPaymentId", "amountCents", "currency",
  "sourceId", "balanceTransactionId", "providerFeeCents", "netAmountCents"] as const;

/** Seven days after proven fulfillment, independent of the provider's bank schedule. */
@Injectable()
export class ScheduledMerchantSplitService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(RETAINED_MERCHANT_PAYMENT_PROVIDER) private readonly provider: RetainedMerchantPaymentProvider,
    @Inject(PAYMENT_SETTLEMENT_LEDGER) private readonly ledger: PaymentSettlementLedgerPort,
    @Optional() private readonly lifecycle?: PaymentHoldLifecycleService,
    @Optional() @Inject(PAYMENT_REPOSITORY) private readonly payments?: PaymentRepository) {}

  async execute(now = new Date()) {
    const result = { scheduled: 0, submitted: 0, released: 0, blocked: 0, unresolved: 0 };
    if (this.lifecycle && this.payments) {
      // Approval webhooks can precede the provider's fee/balance record. Repair
      // those missing holds without creating any new charge or transfer.
      const missing = await this.prisma.$queryRawUnsafe<Array<{ id: string; merchantId: string }>>(
        `SELECT p.id, p.merchant_id AS "merchantId" FROM payment_intents p
         WHERE p.status = 'approved' AND p.creation->'input'->>'merchantPayoutAnchor' = 'fulfillment'
         AND NOT EXISTS (SELECT 1 FROM payment_holds h WHERE h.payment_intent_id = p.id)
         ORDER BY p.created_at ASC LIMIT 25`);
      for (const row of missing) {
        try {
          const payment = await this.payments.getIntentById(row.merchantId, row.id);
          if (payment) await this.lifecycle.createForApprovedPayment(payment.snapshot());
        } catch { result.unresolved++; }
      }
    }
    const completed = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT h.id FROM payment_holds h JOIN completed_orders o
       ON o.merchant_id = h.merchant_id AND o.external_order_id = h.provider_payment_id
       WHERE h.hold_anchor = 'fulfillment' AND h.hold_days = 7 AND h.status = 'awaiting_fulfillment'
       AND o.fulfilled_at IS NOT NULL ORDER BY o.fulfilled_at ASC LIMIT 100`);
    const waiting = completed.length ? await this.prisma.paymentHold.findMany({ where: { id: { in: completed.map(row => row.id) },
      holdAnchor: "fulfillment", holdDays: 7, status: "awaiting_fulfillment" } }) as unknown as Hold[] : [];
    for (const hold of waiting) {
      const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: hold.merchantId, externalOrderId: hold.providerPaymentId },
        select: { id: true, fulfilledAt: true, completedAt: true, fulfillmentJson: true, status: true } });
      const state = readFulfillment(order?.fulfillmentJson);
      if (!order?.fulfilledAt || !state || ["cancelled", "refunded", "returned", "failed"].includes(order.status) ||
          order.fulfilledAt < order.completedAt || order.fulfilledAt > now ||
          state.units.some(unit => unit.completedQuantity !== unit.quantity || !["delivered", "collected", "completed", "available"].includes(unit.status))) continue;
      const changed = await this.prisma.paymentHold.updateMany({ where: { id: hold.id, merchantId: hold.merchantId, status: "awaiting_fulfillment",
        holdAnchor: "fulfillment", holdDays: 7, holdUntil: null },
      data: { orderId: order.id, fulfilledAt: order.fulfilledAt, holdUntil: new Date(order.fulfilledAt.getTime() + 7 * 86_400_000), status: "held" } });
      result.scheduled += changed.count;
    }

    const due = await this.prisma.paymentHold.findMany({ where: { holdAnchor: "fulfillment", holdDays: 7,
      status: { in: ["held", "payout_ready"] }, holdUntil: { lte: now }, fulfilledAt: { not: null } }, orderBy: { holdUntil: "asc" }, take: 25 }) as unknown as Hold[];
    for (const hold of due) {
      try {
        if (!await this.admitted(hold)) { result.blocked++; continue; }
        const input = await this.creationInput(hold);
        const capture = await this.provider.readCapture(input, hold.providerPaymentId);
        this.assertCapture(hold, capture);
        const reference = `zyon:payment-hold:${hold.id}`;
        // Share the return-opening lock, then journal one submission before POST.
        const claimed = await this.prisma.$transaction(async tx => {
          await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", `return-order:${hold.merchantId}:${hold.providerPaymentId}`);
          if (await tx.return.findFirst({ where: activeReturn(hold) as any, select: { id: true } })) return false;
          const payment = await tx.paymentIntent.findFirst({ where: { id: hold.paymentIntentId, merchantId: hold.merchantId, status: "approved" }, select: { id: true } });
          if (!payment) return false;
          const order = await tx.completedOrder.findFirst({ where: { merchantId: hold.merchantId, externalOrderId: hold.providerPaymentId },
            select: { fulfilledAt: true, fulfillmentJson: true, status: true } });
          if (!this.fulfillmentMatches(hold, order)) return false;
          const changed = await tx.paymentHold.updateMany({ where: { id: hold.id, merchantId: hold.merchantId, status: { in: ["held", "payout_ready"] },
            holdAnchor: "fulfillment", holdDays: 7, holdUntil: { lte: now }, fulfilledAt: { not: null } },
          data: { status: "payout_submitted", payoutReference: reference, payoutAttemptedAt: now, failureCode: null } });
          return changed.count === 1;
        });
        if (!claimed) { result.blocked++; continue; }
        const receipt = await this.provider.submit(this.request(hold, reference));
        const update = { where: { id: hold.id, merchantId: hold.merchantId, status: "payout_submitted", payoutReference: reference } };
        if (receipt.state === "not_submitted" || receipt.state === "failed") {
          await this.prisma.paymentHold.updateMany({ ...update, data: { status: "payout_failed", failureCode: "scheduled_split_not_submitted" } });
          result.blocked++;
        } else {
          await this.prisma.paymentHold.updateMany({ ...update, data: { ...(receipt.providerTransferId ? { payoutProviderTransferId: receipt.providerTransferId } : {}),
            failureCode: receipt.state === "unknown" ? "scheduled_split_submission_unknown" : null } });
          if (receipt.state === "unknown") result.unresolved++; else result.submitted++;
        }
      } catch {
        // A claimed row stays submitted after any ambiguous provider/DB outcome.
        // Reconciliation below uses GETs and never repeats the financial POST.
        result.unresolved++;
        await this.prisma.paymentHold.updateMany({ where: { id: hold.id, merchantId: hold.merchantId, status: "payout_submitted" },
          data: { failureCode: "scheduled_split_requires_reconciliation" } });
      }
    }

    const pending = await this.prisma.paymentHold.findMany({ where: { holdAnchor: "fulfillment", holdDays: 7, status: "payout_submitted" },
      orderBy: { payoutAttemptedAt: "asc" }, take: 25 }) as unknown as Hold[];
    for (const hold of pending) {
      try {
        if (!hold.payoutReference || !hold.holdUntil || hold.holdUntil > now || !await this.admitted(hold)) { result.blocked++; continue; }
        await this.creationInput(hold);
        const receipt = await this.provider.reconcile(this.request(hold, hold.payoutReference), hold.payoutProviderTransferId ?? undefined);
        if (receipt.state !== "confirmed" || !receipt.providerTransferId) continue;
        if (!this.ledger) throw new Error("scheduled_split_ledger_unavailable");
        await this.ledger.appendObservation({ merchantId: hold.merchantId, paymentIntentId: hold.paymentIntentId, provider: hold.provider,
          status: "confirmed", currency: "BRL", providerSettlementId: `scheduled-split:${receipt.providerTransferId}`,
          providerPaymentId: hold.providerPaymentId, providerReference: hold.payoutReference,
          confirmedGrossCents: hold.totalAmountCents, confirmedPlatformFeeCents: hold.platformFeeCents,
          confirmedProviderFeeCents: hold.providerFeeCents, confirmedMerchantNetCents: hold.merchantNetCents,
          occurredAt: now, confirmedAt: now, entries: [
            { entryKey: "platform_fee", confirmedAmountCents: hold.platformFeeCents },
            { entryKey: "merchant_payout", confirmedAmountCents: hold.merchantNetCents, providerTransferId: receipt.providerTransferId },
          ] });
        const changed = await this.prisma.paymentHold.updateMany({ where: { id: hold.id, merchantId: hold.merchantId, status: "payout_submitted", payoutReference: hold.payoutReference },
          data: { status: "released", releasedAt: now, payoutConfirmedAt: now, payoutProviderTransferId: receipt.providerTransferId, failureCode: null } });
        result.released += changed.count;
      } catch { result.unresolved++; }
    }
    return result;
  }

  private async admitted(hold: Hold): Promise<boolean> {
    const [payment, order, ret] = await Promise.all([
      this.prisma.paymentIntent.findFirst({ where: { id: hold.paymentIntentId, merchantId: hold.merchantId, providerPaymentId: hold.providerPaymentId,
        status: "approved", amountCents: hold.totalAmountCents, approvedAmountCents: hold.totalAmountCents }, select: { id: true } }),
      this.prisma.completedOrder.findFirst({ where: { merchantId: hold.merchantId, externalOrderId: hold.providerPaymentId }, select: { status: true, fulfilledAt: true, fulfillmentJson: true } }),
      this.prisma.return.findFirst({ where: activeReturn(hold) as any, select: { id: true } }),
    ]);
    return Boolean(payment && this.fulfillmentMatches(hold, order) && !ret);
  }

  private fulfillmentMatches(hold: Hold, order: { status: string; fulfilledAt: Date | null; fulfillmentJson: unknown } | null): boolean {
    const state = readFulfillment(order?.fulfillmentJson);
    return Boolean(order?.fulfilledAt && hold.fulfilledAt && order.fulfilledAt.getTime() === hold.fulfilledAt.getTime() && state &&
      !["cancelled", "refunded", "returned", "failed"].includes(order.status) &&
      state.units.every(unit => unit.completedQuantity === unit.quantity && ["delivered", "collected", "completed", "available"].includes(unit.status)));
  }

  private async creationInput(hold: Hold): Promise<CreateProviderPaymentInput> {
    const payment = await this.prisma.paymentIntent.findFirst({ where: { id: hold.paymentIntentId, merchantId: hold.merchantId }, select: { creation: true } });
    const input = (payment?.creation as { input?: CreateProviderPaymentInput } | null)?.input;
    if (!input || input.merchantId !== hold.merchantId || input.intentId !== hold.paymentIntentId || input.provider !== hold.provider ||
        input.amountCents !== hold.totalAmountCents || input.platformFeeCents !== hold.platformFeeCents || input.merchantPayoutDestination !== hold.payoutDestination ||
        input.merchantPayoutAnchor !== "fulfillment" || input.merchantPayoutHoldDays !== 7 || input.providerAccountFingerprint !== hold.captureEvidence?.accountFingerprint) {
      throw new Error("scheduled_split_original_payment_unproven");
    }
    return input;
  }

  private assertCapture(hold: Hold, capture: MarketplaceCaptureEvidence): void {
    if (!hold.captureEvidence || captureFields.some(field => capture[field] !== hold.captureEvidence[field]) ||
        hold.totalAmountCents !== hold.platformFeeCents + hold.providerFeeCents + hold.merchantNetCents ||
        hold.providerFeeCents !== capture.providerFeeCents || hold.merchantNetCents <= 0) throw new Error("scheduled_split_capture_changed");
  }

  private request(hold: Hold, reference: string): MarketplacePayoutRequest {
    this.assertCapture(hold, hold.captureEvidence);
    return { provider: hold.provider, accountFingerprint: hold.captureEvidence.accountFingerprint, providerPaymentId: hold.providerPaymentId,
      destination: hold.payoutDestination, amountCents: hold.merchantNetCents, currency: "BRL", reference, capture: hold.captureEvidence };
  }
}
