import type { Prisma } from "@prisma/client";
import type { MarketplaceCaptureEvidence } from "../../domain/ports/marketplace-capture-provider.port.js";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { fundingHash } from "./prisma-marketplace-funding.repository.js";

/** A completed provider receipt without the committed return and financial
 * outbox is not spendable history. The caller owns the original order lock. */
export async function readConfirmedAsaasMarketplaceRefundHistory(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string, capture: MarketplaceCaptureEvidence, excludeRefundId?: string) {
  const rows = await tx.marketplaceRefundPlan.findMany({ where: { hostMerchantId, fundingPlanId,
    status: "confirmed", ...(excludeRefundId ? { id: { not: excludeRefundId } } : {}) },
    include: { operation: true, return: { include: { refund: true } } } });
  if (rows.length > 2000) throw Error("marketplace_refund_asaas_history_limit");
  rows.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
    (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents);
  const receipts: Array<{ providerOperationId: string; amountCents: number }> = [];
  const allocations: MarketplaceRefundAllocation[] = [];
  let total = 0;
  for (const row of rows) {
    const op = row.operation, allocation = row.allocation as unknown as MarketplaceRefundAllocation;
    const request = op?.request as unknown as MarketplaceRefundRequest | undefined;
    if (!op || !request) throw Error("marketplace_refund_asaas_history_unproven");
    const { requestHash, ...raw } = request;
    total += row.amountCents;
    if (op.status !== "confirmed" || op.provider !== "asaas" || !op.claimedAt || !op.reconciledAt ||
      !op.providerOperationId || !/^asaas_refund_[a-f0-9]{64}$/.test(op.providerOperationId) ||
      receipts.some(prior => prior.providerOperationId === op.providerOperationId) ||
      request.kind !== "refund" || request.provider !== "asaas" || request.transfer !== undefined || request.fundingContributions !== undefined ||
      request.accountFingerprint !== capture.accountFingerprint || request.environment !== capture.environment ||
      request.providerPaymentId !== capture.providerPaymentId || request.sourceId !== capture.providerPaymentId ||
      request.paymentAmountCents !== capture.amountCents || request.currency !== "BRL" || request.amountCents !== row.amountCents ||
      requestHash !== op.requestHash || fundingHash(raw) !== requestHash || request.reference !== op.reference ||
      fundingHash(request.asaasCapture) !== fundingHash(capture) || fundingHash(request.previousRefunds) !== fundingHash(receipts) ||
      fundingHash(allocation) !== row.allocationHash || allocation.amountCents !== row.amountCents ||
      allocation.cumulativeRefundCents !== total || allocation.requiredContributions.length || total > capture.netAmountCents ||
      row.return.merchantId !== hostMerchantId || row.return.status !== "REFUND_COMPLETED" ||
      row.return.refund?.id !== `mrefund_return_${fundingHash(row.id)}` || row.return.refund.status !== "COMPLETED" ||
      row.return.refund.paymentIntentId !== fundingPlanId || row.return.refund.amountInCents !== row.amountCents ||
      row.return.refund.providerRefundId !== op.providerOperationId || !row.return.refund.processedAt) {
      throw Error("marketplace_refund_asaas_history_unproven");
    }
    const event = await tx.outboxMessage.findUnique({ where: { eventId: `marketplace_refund_${row.id}` } });
    if (!event || event.eventType !== "marketplace.refund.confirmed" || event.merchantId !== hostMerchantId ||
      event.correlationId !== fundingPlanId || event.causationId !== row.returnId || event.schemaVersion !== 1 || event.producer !== "marketplace" ||
      fundingHash(event.payload) !== fundingHash({ refund_plan_id: row.id, return_id: row.returnId, payment_intent_id: fundingPlanId,
        order_id: capture.providerPaymentId, amount_cents: row.amountCents, cumulative_refund_cents: allocation.cumulativeRefundCents,
        allocation_hash: row.allocationHash, provider_refund_id: op.providerOperationId })) {
      throw Error("marketplace_refund_asaas_history_event_missing");
    }
    receipts.push({ providerOperationId: op.providerOperationId, amountCents: row.amountCents });
    allocations.push(allocation);
  }
  return { rows, receipts, allocations };
}
