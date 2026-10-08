import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceResidualBasisV4 } from "../../domain/services/marketplace-residual-allocation.js";
import type { MarketplaceResidualAllocationV4 } from "../../domain/services/marketplace-residual-sources.js";
import type { StripeMarketplaceSourceRefundContext, StripeMarketplaceSourceRefundHistory } from "../../domain/ports/marketplace-stripe-source-refund.port.js";
import { buildStripeMarketplaceSourceRefundPlan, buildStripeMarketplaceSourceRefundRequest } from "../../domain/services/marketplace-stripe-source-refund.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { buildMarketplaceRefundContributionPlan } from "../../domain/services/marketplace-refund-contribution.js";
import { fundingHash as hash, lockMarketplaceOrder, fundingTransferAllocations,
  type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { readMarketplaceResidualContributionBasis } from "./marketplace-residual-contribution-basis.js";
import { buildMarketplaceResidualBasis } from "./marketplace-residual-history.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";

function fail(reason = "marketplace_stripe_source_refund_history_invalid"): never { throw new ConflictException(reason); }

/** READ ONLY, under the original order lock. Source-aware callers use this
 * branch explicitly; legacy/native-dispute readers still deny V4 histories.
 * Receipt certification may read a frozen prefix after a dispute, but that
 * does not authorize another refund, reversal, payout or release a hold. */
export async function readStripeMarketplaceSourceRefundContext(tx: Prisma.TransactionClient, input: {
  hostMerchantId: string; paymentIntentId: string; refundPlanId: string; admission?: boolean;
}) {
  const first = await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: input.hostMerchantId } });
  if (!first?.providerPaymentId) fail();
  await lockMarketplaceOrder(tx, input.hostMerchantId, first.providerPaymentId);
  const payment = await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: input.hostMerchantId } });
  const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: input.paymentIntentId, hostMerchantId: input.hostMerchantId } });
  const admission = input.admission !== false;
  if (!payment || !funding?.budget || funding.provider !== "stripe" || funding.status !== "held" ||
      funding.providerPaymentId !== first.providerPaymentId || payment.providerPaymentId !== first.providerPaymentId || payment.currency !== "BRL" ||
      payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents ||
      !(payment.status === "approved" || payment.status === "refunded" || !admission && payment.status.startsWith("chargeback_"))) fail();
  const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
  const creation = (payment.creation as { input?: { marketplaceFunding?: unknown; provider?: unknown; providerAccountFingerprint?: unknown } })?.input;
  if (funding.instructionsHash !== hash(instructions) || hash(creation?.marketplaceFunding) !== funding.instructionsHash ||
      creation?.provider !== "stripe" || creation.providerAccountFingerprint !== funding.accountFingerprint ||
      instructions.hostMerchantId !== input.hostMerchantId || instructions.accountFingerprint !== funding.accountFingerprint ||
      instructions.environment !== funding.environment || hash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== hash(budget) ||
      budget.capture.providerPaymentId !== payment.providerPaymentId || budget.capture.accountFingerprint !== funding.accountFingerprint ||
      budget.capture.amountCents !== funding.amountCents || budget.capture.netAmountCents !== funding.netAmountCents ||
      budget.capture.providerFeeCents !== funding.providerFeeCents) fail();
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: {
    hostMerchantId: input.hostMerchantId, orderId: payment.providerPaymentId } } });
  if (!ledger?.purchasedAt || admission && ledger.chargebackAt ||
      await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: funding.paymentIntentId } })) fail();
  if (admission && await tx.outboxMessage.count({ where: { merchantId: input.hostMerchantId, correlationId: funding.paymentIntentId,
    eventType: "marketplace.financial_reconciliation_required" } })) {
    fail("marketplace_stripe_source_refund_financial_reconciliation_required");
  }
  if (admission) for (const b of budget.beneficiaries) {
    if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: b.merchantId, status: "outstanding" } }) ||
        await tx.marketplaceHostDebt.count({ where: { hostMerchantId: b.merchantId, status: "outstanding" } }) ||
        await hasMarketplaceRecoveryExposure(tx, b.merchantId)) fail("marketplace_stripe_source_refund_beneficiary_exposure_unreconciled");
  }
  const generations = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operations: true } });
  const historicalDispute = !admission && !!ledger.chargebackAt && funding.status === "held";
  if (generations.length !== 1 || generations[0]!.generation !== 1 || generations[0]!.hostMerchantId !== input.hostMerchantId ||
      !(generations[0]!.status === "completed" && !generations[0]!.heldReason || historicalDispute && generations[0]!.status === "held" &&
        generations[0]!.heldReason === "marketplace_residual_dispute_requires_reconciliation") ||
      (generations[0]!.basis as { version?: number }).version !== 4) fail();
  const residual = generations[0]!, recorded = residual.basis as unknown as MarketplaceResidualBasisV4;
  const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId },
    include: { operation: true, return: { include: { refund: true, items: true } } } });
  refunds.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
    (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents);
  const index = refunds.findIndex(r => r.id === input.refundPlanId), frontier = recorded.refunds.length;
  if (index < frontier || admission && index !== refunds.length - 1 || refunds.slice(0, index).some(r => r.status !== "confirmed")) fail();
  const prefix = refunds.slice(0, index + 1), current = prefix.at(-1)!;
  const initial = await readMarketplaceResidualContributionBasis(tx, { funding, instructions, budget, refunds: prefix.slice(0, frontier) });
  if (!initial || hash(initial.funding) !== hash(recorded.fundingContributions) ||
      hash(buildMarketplaceResidualBasis(funding, budget, prefix.slice(0, frontier), [], [], initial.funding)) !== residual.basisHash ||
      residual.basisHash !== hash(recorded)) fail();
  const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { settlement: true } });
  const expectedPayouts = fundingTransferAllocations(instructions, budget);
  if (payouts.length !== expectedPayouts.length || payouts.some(p => !(p.status === "planned" || historicalDispute && p.status === "cancelled") || p.claimedAt || p.providerTransferId ||
      p.provider !== "stripe" || p.accountFingerprint !== funding.accountFingerprint || p.providerPaymentId !== funding.providerPaymentId ||
      !expectedPayouts.some(e => e.merchantId === p.beneficiaryMerchantId && e.lineItemId === (p.settlement?.lineItemId ?? null) && e.amountCents === p.amountCents))) fail();
  const context: StripeMarketplaceSourceRefundContext = { version: 1, kind: "stripe_v4_refund_sources",
    basis: { ...initial.basis, refunds: prefix.map(r => ({ refundPlanId: r.id, allocationHash: r.allocationHash,
      allocation: r.allocation as unknown as MarketplaceRefundAllocation })) },
    residual: { residualPlanId: residual.id, generation: residual.generation, basis: recorded, basisHash: residual.basisHash,
      allocation: residual.allocation as unknown as MarketplaceResidualAllocationV4, allocationHash: residual.allocationHash,
      operations: residual.operations.map(o => {
        const request = o.request as unknown as import("../../domain/ports/marketplace-residual-provider.port.js").MarketplaceResidualRequest;
        if (o.residualPlanId !== residual.id || o.status !== "confirmed" || !o.claimedAt || !o.reconciledAt ||
            !o.providerTransferId?.startsWith("tr_") || o.provider !== "stripe" || o.accountFingerprint !== funding.accountFingerprint ||
            o.requestHash !== request.requestHash || o.reference !== request.reference || o.amountCents !== request.amountCents || o.sourceId !== request.sourceId) fail();
        return { operationId: o.id, sourceId: o.sourceId, merchantId: o.beneficiaryMerchantId, providerTransferId: o.providerTransferId!, request };
      }).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.merchantId.localeCompare(b.merchantId)) },
    history: [], refundPlanId: current.id, returnId: current.returnId };
  const reversals = await tx.marketplaceTransferReversal.findMany({ where: { OR: [
    { refundPlan: { fundingPlanId: funding.paymentIntentId } }, { residualOperation: { residualPlanId: residual.id } },
    { payoutId: { in: payouts.map(p => p.id) } } ] } });
  if (reversals.some(r => !refunds.some(p => p.id === r.refundPlanId) || !!r.payoutId || !r.residualOperationId ||
      !residual.operations.some(o => o.id === r.residualOperationId)) || reversals.some(r => prefix.slice(0, frontier).some(p => p.id === r.refundPlanId))) fail();
  const orderIds = [payment.providerPaymentId!, ...(payment.commerceOrderId ? [payment.commerceOrderId] : []),
    ...(await tx.completedOrder.findMany({ where: { merchantId: input.hostMerchantId, OR: [
      { externalOrderId: payment.providerPaymentId }, { sessionId: payment.sessionId } ] }, select: { id: true } })).map(o => o.id)];
  for (const [i, row] of prefix.entries()) {
    const a = row.allocation as unknown as MarketplaceRefundAllocation;
    if (row.hostMerchantId !== input.hostMerchantId || row.amountCents !== a.amountCents || row.allocationHash !== hash(a) ||
        row.return.merchantId !== input.hostMerchantId || !orderIds.includes(row.return.orderId) ||
        hash(row.return.items.map(v => ({ variantId: v.variantId, quantity: v.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
        hash(a.lines.map(v => ({ variantId: v.variantId, quantity: v.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) fail();
    if (i === index) break;
    const operation = row.operation, receipt = row.return.refund;
    if (row.status !== "confirmed" || !operation || operation.status !== "confirmed" || !operation.claimedAt || !operation.reconciledAt ||
        !operation.providerOperationId?.startsWith("re_") || row.return.status !== "REFUND_COMPLETED" ||
        !receipt || receipt.id !== `mrefund_return_${hash(row.id)}` || receipt.status !== "COMPLETED" ||
        receipt.providerRefundId !== operation.providerOperationId || receipt.paymentIntentId !== funding.paymentIntentId || receipt.amountInCents !== row.amountCents) fail();
    let request: MarketplaceRefundRequest;
    if (i < frontier) {
      const certs = initial.funding.certificates.filter(c => prefix.findIndex(p => p.id === c.request.refundPlanId) <= i);
      const plan = certs.length ? buildMarketplaceRefundContributionPlan({ ...initial.basis, refunds: context.basis.refunds.slice(0, i + 1) }, certs) : undefined;
      const raw = { kind: "refund" as const, provider: "stripe" as const, environment: instructions.environment,
        accountFingerprint: funding.accountFingerprint, providerPaymentId: funding.providerPaymentId!, sourceId: budget.capture.sourceId,
        paymentAmountCents: funding.amountCents, amountCents: row.amountCents, currency: "BRL" as const,
        previousRefunds: prefix.slice(0, i).map(p => ({ providerOperationId: p.operation!.providerOperationId!, amountCents: p.amountCents })),
        reference: `mrefund_${hash([input.hostMerchantId, row.returnId])}`,
        ...(plan ? { fundingContributions: { planHash: plan.planHash, contributedNetCents: plan.contributedNetCents, certificates: certs } } : {}) };
      request = { ...raw, requestHash: hash(raw) };
    } else {
      const stored = operation.request as unknown as MarketplaceRefundRequest;
      const h: StripeMarketplaceSourceRefundHistory = { refundPlanId: row.id, returnId: row.returnId,
        providerOperationId: operation.providerOperationId, planHash: stored.stripeSourceFunding?.plan.planHash ?? "",
        reversals: reversals.filter(r => r.refundPlanId === row.id).map(r => {
          if (r.status !== "confirmed" || !r.claimedAt || !r.reconciledAt || !r.providerOperationId?.startsWith("trr_") ||
              r.hostMerchantId !== input.hostMerchantId || r.provider !== "stripe" || r.accountFingerprint !== funding.accountFingerprint) fail();
          return { payoutId: r.residualOperationId!, providerOperationId: r.providerOperationId!, amountCents: r.amountCents,
            reference: r.reference, requestHash: r.requestHash };
        }).sort((a, b) => a.payoutId.localeCompare(b.payoutId)) };
      const child: StripeMarketplaceSourceRefundContext = { ...context, basis: { ...context.basis, refunds: context.basis.refunds.slice(0, i + 1) },
        history: [...context.history], refundPlanId: row.id, returnId: row.returnId };
      const childPlan = buildStripeMarketplaceSourceRefundPlan(child);
      if (h.planHash !== childPlan.planHash) fail();
      for (const r of reversals.filter(r => r.refundPlanId === row.id)) {
        const expected = buildStripeMarketplaceSourceRefundRequest(child, childPlan, r.residualOperationId!);
        if (r.requestHash !== expected.requestHash || hash(r.request) !== hash(expected)) fail();
      }
      request = buildStripeMarketplaceSourceRefundRequest(child, childPlan);
      context.history.push(h);
    }
    if (operation.provider !== "stripe" || operation.accountFingerprint !== funding.accountFingerprint || operation.reference !== request.reference ||
        operation.requestHash !== request.requestHash || hash(operation.request) !== hash(request)) fail();
    const event = await tx.outboxMessage.findUnique({ where: { eventId: `marketplace_refund_${row.id}` } });
    if (!event || event.eventType !== "marketplace.refund.confirmed" || event.merchantId !== input.hostMerchantId ||
        event.correlationId !== funding.paymentIntentId || event.causationId !== row.returnId || event.producer !== "marketplace" || event.schemaVersion !== 1 ||
        hash(event.payload) !== hash({ refund_plan_id: row.id, return_id: row.returnId, payment_intent_id: funding.paymentIntentId,
          order_id: funding.providerPaymentId, amount_cents: row.amountCents, cumulative_refund_cents: a.cumulativeRefundCents,
          allocation_hash: row.allocationHash, provider_refund_id: operation.providerOperationId })) fail();
  }
  const plan = buildStripeMarketplaceSourceRefundPlan(context), refundRequest = buildStripeMarketplaceSourceRefundRequest(context, plan);
  const expectedStatus = current.status === "confirmed" ? "REFUND_COMPLETED" : current.status === "submitted" ? "REFUND_PROCESSING" : "INSPECTED_PASS";
  if (!["blocked", "prepared", "submitted", "confirmed"].includes(current.status) || current.return.status !== expectedStatus ||
      current.operation && (current.operation.provider !== "stripe" || current.operation.accountFingerprint !== funding.accountFingerprint ||
        current.operation.requestHash !== refundRequest.requestHash || current.operation.reference !== refundRequest.reference ||
        hash(current.operation.request) !== hash(refundRequest))) fail();
  return { context, plan, refundRequest,
    reversalRequests: plan.requiredReversals.map(r => ({ ...r, request: buildStripeMarketplaceSourceRefundRequest(context, plan, r.payoutId) })) };
}
