import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceResidualRequest } from "../../domain/ports/marketplace-residual-provider.port.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { buildMarketplaceResidualAllocation, buildMarketplaceResidualAfterReversalAllocation, buildMarketplaceResidualAfterGenerationAllocation,
  type MarketplaceResidualAllocation, type MarketplaceResidualBasis, type MarketplaceResidualOriginalTransfer,
  type MarketplaceResidualPreviousGeneration } from "../../domain/services/marketplace-residual-allocation.js";
import { fundingHash, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { buildMarketplaceRefundContributionPlan, type MarketplaceRefundContributionBasis } from "../../domain/services/marketplace-refund-contribution.js";
import { buildMarketplaceResidualContributionAllocation, type MarketplaceResidualContributionFunding } from "../../domain/services/marketplace-residual-sources.js";

type Funding = { paymentIntentId: string; hostMerchantId: string; provider: string; environment: string; providerPaymentId: string | null;
  accountFingerprint: string; amountCents: number; instructionsHash: string };
type Refund = Prisma.MarketplaceRefundPlanGetPayload<{ include: { operation: true } }>;
export type ResidualGeneration = Prisma.MarketplaceResidualPlanGetPayload<{ include: { operations: true } }>;
type Payout = { id: string; beneficiaryMerchantId: string | null; destination: string; reference: string; amountCents: number;
  status: string; providerTransferId: string | null; claimedAt: Date | null; reconciledAt: Date | null };
function fail(reason = "marketplace_residual_history_unreconciled"): never { throw new ConflictException(reason); }

export function buildMarketplaceResidualBasis(funding: Funding, budget: FundingBudget, refunds: Refund[],
  transfers: MarketplaceResidualOriginalTransfer[], previousGenerations: MarketplaceResidualPreviousGeneration[],
  contributions?: MarketplaceResidualContributionFunding): Exclude<MarketplaceResidualBasis, {version: 5 | 6 | 7}> {
  const base = { fundingPlanId: funding.paymentIntentId, instructionsHash: funding.instructionsHash, budgetHash: fundingHash(budget),
    refunds: refunds.map(row => ({ refundPlanId: row.id, returnId: row.returnId, allocationHash: row.allocationHash,
      requestHash: row.operation!.requestHash, providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents })) };
  if (contributions) {
    if (transfers.length || previousGenerations.length) fail("marketplace_residual_contribution_history_requires_reconciliation");
    return { ...base, version: 4, fundingContributions: contributions };
  }
  return previousGenerations.length ? { ...base, version: 3, originalTransfers: transfers, previousGenerations } :
    transfers.length ? { ...base, version: 2, originalTransfers: transfers } : { ...base, version: 1 };
}

export function buildMarketplaceResidualHistoryAllocation(budget: FundingBudget, refunds: Refund[], basis: MarketplaceResidualBasis,
  contributionBasis?: MarketplaceRefundContributionBasis): Exclude<MarketplaceResidualAllocation, {version: 5 | 6 | 7}> {
  if (basis.version === 5 || basis.version === 6 || basis.version === 7) fail("marketplace_residual_history_provider_unavailable");
  if (basis.version === 4) {
    if (!contributionBasis || fundingHash(contributionBasis.budget) !== fundingHash(budget) ||
        fundingHash(contributionBasis.refunds.map(row => row.allocation)) !== fundingHash(refunds.map(row => row.allocation))) fail();
    return buildMarketplaceResidualContributionAllocation(contributionBasis!, basis.fundingContributions);
  }
  const allocations = refunds.map(row => row.allocation as unknown as MarketplaceRefundAllocation);
  return basis.version === 3 ? buildMarketplaceResidualAfterGenerationAllocation(budget, allocations, basis.originalTransfers) :
    basis.version === 2 ? buildMarketplaceResidualAfterReversalAllocation(budget, allocations, basis.originalTransfers) :
      buildMarketplaceResidualAllocation(budget, allocations);
}

export function buildMarketplaceResidualRequest(data: { plan: Funding; budget: FundingBudget; basis: MarketplaceResidualBasis; allocation: MarketplaceResidualAllocation },
  beneficiary: { merchantId: string; destination: string; amountCents: number; sourceId?: string }, basisHash: string): MarketplaceResidualRequest {
  if (data.basis.version === 5 || data.basis.version === 6 || data.basis.version === 7) fail("marketplace_residual_history_provider_unavailable");
  if (data.basis.version === 4) {
    if (data.allocation.version !== 4) fail();
    const source = data.allocation.sources.find(row => row.sourceId === beneficiary.sourceId);
    if (!source || !source.beneficiaries.some(row => row.merchantId === beneficiary.merchantId &&
        row.destination === beneficiary.destination && row.amountCents === beneficiary.amountCents)) fail();
    const reference = (merchantId: string, sourceId = source!.sourceId) => `mresidual_${fundingHash([data.plan.hostMerchantId, data.plan.paymentIntentId, basisHash, sourceId, merchantId])}`;
    const raw = { version: 4 as const, provider: "stripe" as const, accountFingerprint: data.plan.accountFingerprint,
      providerPaymentId: data.plan.providerPaymentId!, destination: beneficiary.destination, amountCents: beneficiary.amountCents,
      currency: "BRL" as const, reference: reference(beneficiary.merchantId), capture: data.budget.capture,
      sourceId: source!.sourceId, sourceAllocation: data.allocation, fundingContributions: data.basis.fundingContributions,
      sourceTransfers: data.allocation.sources.map(s => ({ sourceId: s.sourceId, transfers: s.beneficiaries.map(row => ({
        reference: reference(row.merchantId, s.sourceId), destination: row.destination, amountCents: row.amountCents })) })),
      remainingTotalCents: source!.payoutTotalCents, transfers: source!.beneficiaries.map(row => ({ reference: reference(row.merchantId),
        destination: row.destination, amountCents: row.amountCents })),
      refunds: data.basis.refunds.map(row => ({ providerOperationId: row.providerOperationId, amountCents: row.amountCents })) };
    return { ...raw, requestHash: fundingHash(raw) };
  }
  const raw = { provider: data.plan.provider as "stripe", accountFingerprint: data.plan.accountFingerprint,
    providerPaymentId: data.plan.providerPaymentId!, destination: beneficiary.destination, amountCents: beneficiary.amountCents,
    currency: "BRL" as const, reference: `mresidual_${fundingHash([data.plan.hostMerchantId, data.plan.paymentIntentId, basisHash, beneficiary.merchantId])}`,
    capture: data.budget.capture, remainingTotalCents: data.allocation.payoutTotalCents,
    ...(data.basis.version !== 1 ? { version: data.basis.version, originalTransfers: data.basis.originalTransfers } : {}),
    ...(data.basis.version === 3 ? { previousGenerations: data.basis.previousGenerations } : {}),
    transfers: data.allocation.beneficiaries.filter(row => row.amountCents > 0).map(row => ({
      reference: `mresidual_${fundingHash([data.plan.hostMerchantId, data.plan.paymentIntentId, basisHash, row.merchantId])}`,
      destination: row.destination, amountCents: row.amountCents })),
    refunds: data.basis.refunds.map(row => ({ providerOperationId: row.providerOperationId, amountCents: row.amountCents })) };
  return { ...raw, requestHash: fundingHash(raw) };
}

/** Reconstructs historical snapshots from immutable rows, never from current
 * balances or timestamps. A later refund cannot change an earlier request. */
export async function readMarketplaceResidualTransferHistory(tx: Prisma.TransactionClient, data: {
  funding: Funding; instructions: FrozenMarketplaceFunding; budget: FundingBudget; payouts: Payout[];
  refunds: Refund[]; priorGenerations: ResidualGeneration[];
  /** Read-only proof reconstruction after a dispute; never authorizes a POST. */
  allowDisputeHeld?: boolean;
  contributionBasis?: MarketplaceRefundContributionBasis;
  contributions?: MarketplaceResidualContributionFunding;
}) {
  const { funding, instructions, budget, payouts, refunds } = data;
  const generations = [...data.priorGenerations].sort((a, b) => a.generation - b.generation);
  if (generations.some(row => [5, 6, 7].includes((row.basis as unknown as MarketplaceResidualBasis).version))) {
    fail("marketplace_residual_history_provider_unavailable");
  }
  // Legacy reversal/native-recovery callers must never project a multi-source
  // transfer as if it were funded by the original charge. V4's next generation
  // needs its own per-source refund/reversal agreement and remains held.
  if (generations.some(row => (row.basis as unknown as MarketplaceResidualBasis).version === 4)) {
    fail("marketplace_residual_contribution_history_requires_reconciliation");
  }
  const previousGenerations: MarketplaceResidualPreviousGeneration[] = [];
  const transfers: MarketplaceResidualOriginalTransfer[] = payouts.filter(row => row.status === "confirmed")
    .sort((a, b) => a.id.localeCompare(b.id)).map(row => ({ payoutId: row.id, merchantId: row.beneficiaryMerchantId!,
      providerTransferId: row.providerTransferId!, destination: row.destination, reference: row.reference, amountCents: row.amountCents, reversals: [] }));
  if (payouts.some(row => !((row.status === "planned" || data.allowDisputeHeld && row.status === "cancelled") && !row.providerTransferId && !row.claimedAt ||
      row.status === "confirmed" && row.providerTransferId?.startsWith("tr_") && row.claimedAt && row.reconciledAt))) fail();
  if (data.contributions && (!data.contributionBasis || generations.length || transfers.length)) {
    fail("marketplace_residual_contribution_history_requires_reconciliation");
  }
  for (const [index, refund] of refunds.entries()) {
    const operation = refund.operation;
    const prefixCertificates = data.contributions?.certificates.filter(c =>
      refunds.findIndex(row => row.id === c.request.refundPlanId) <= index);
    const prefixPlan = prefixCertificates?.length ? buildMarketplaceRefundContributionPlan({ ...data.contributionBasis!,
      refunds: data.contributionBasis!.refunds.slice(0, index + 1) }, prefixCertificates) : undefined;
    if (prefixPlan && !prefixPlan.fullyFunded) fail();
    const raw = { kind: "refund" as const, provider: "stripe" as const, environment: instructions.environment,
      accountFingerprint: funding.accountFingerprint, providerPaymentId: funding.providerPaymentId!, sourceId: budget.capture.sourceId,
      paymentAmountCents: funding.amountCents, amountCents: refund.amountCents, currency: "BRL" as const,
      previousRefunds: refunds.slice(0, index).map(row => ({ providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents })),
      reference: `mrefund_${fundingHash([funding.hostMerchantId, refund.returnId])}`,
      ...(prefixPlan ? { fundingContributions: { planHash: prefixPlan.planHash, contributedNetCents: prefixPlan.contributedNetCents,
        certificates: prefixCertificates! } } : {}) };
    const request = { ...raw, requestHash: fundingHash(raw) };
    if (refund.fundingPlanId !== funding.paymentIntentId || refund.hostMerchantId !== funding.hostMerchantId || refund.status !== "confirmed" ||
        fundingHash(refund.allocation) !== refund.allocationHash || !operation || operation.status !== "confirmed" ||
        !operation.claimedAt || !operation.reconciledAt || !operation.providerOperationId?.startsWith("re_") ||
        operation.provider !== funding.provider || operation.accountFingerprint !== funding.accountFingerprint ||
        operation.reference !== request.reference || operation.requestHash !== request.requestHash || fundingHash(operation.request) !== fundingHash(request)) fail();
    const returned = await tx.return.findFirst({ where: { id: refund.returnId, merchantId: funding.hostMerchantId }, include: { refund: true, items: true } });
    const allocation = refund.allocation as unknown as MarketplaceRefundAllocation;
    if (!returned || returned.status !== "REFUND_COMPLETED" || returned.refund?.id !== `mrefund_return_${fundingHash(refund.id)}` ||
        returned.refund.status !== "COMPLETED" || returned.refund.paymentIntentId !== funding.paymentIntentId ||
        returned.refund.amountInCents !== refund.amountCents || returned.refund.providerRefundId !== operation.providerOperationId ||
        fundingHash(returned.items.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
        fundingHash(allocation.lines.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) fail();
  }
  // This also proves cumulative refund cents, original fee ownership and absence of a funding deficit.
  if (data.contributions) buildMarketplaceResidualContributionAllocation(data.contributionBasis!, data.contributions);
  else if (refunds.length) buildMarketplaceResidualAllocation(budget, refunds.map(row => row.allocation as unknown as MarketplaceRefundAllocation));
  const reversals = await tx.marketplaceTransferReversal.findMany({ where: { OR: [
    { refundPlan: { fundingPlanId: funding.paymentIntentId } }, { payout: { fundingPlanId: funding.paymentIntentId } },
    { residualOperation: { residualPlan: { fundingPlanId: funding.paymentIntentId } } },
  ] } });
  const orderRefunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, select: { id: true } });
  if (reversals.some(row => !orderRefunds.some(refund => refund.id === row.refundPlanId))) fail("marketplace_residual_reversal_unconfirmed");
  const refundIndex = new Map(refunds.map((row, index) => [row.id, index]));
  const applicable = reversals.filter(row => refundIndex.has(row.refundPlanId)).sort((a, b) => refundIndex.get(a.refundPlanId)! - refundIndex.get(b.refundPlanId)! || a.id.localeCompare(b.id));
  let applied = 0;
  const applyBefore = (count: number) => {
    while (applied < applicable.length && refundIndex.get(applicable[applied]!.refundPlanId)! < count) {
      const row = applicable[applied++]!, index = refundIndex.get(row.refundPlanId)!;
      const targetId = row.payoutId ?? row.residualOperationId;
      const transfer = transfers.find(item => item.payoutId === targetId && (item.kind === "residual") === !!row.residualOperationId);
      if (!transfer || !!row.payoutId === !!row.residualOperationId) fail("marketplace_residual_reversal_unconfirmed");
      const raw = { kind: "transfer_reversal" as const, provider: "stripe" as const, environment: instructions.environment,
        accountFingerprint: funding.accountFingerprint, providerPaymentId: funding.providerPaymentId!, sourceId: budget.capture.sourceId,
        paymentAmountCents: funding.amountCents, amountCents: row.amountCents, currency: "BRL" as const,
        previousRefunds: refunds.slice(0, index).map(refund => ({ providerOperationId: refund.operation!.providerOperationId!, amountCents: refund.amountCents })),
        reference: `mreverse_${fundingHash([funding.hostMerchantId, row.refundPlanId, transfer!.payoutId])}`,
        transfer: { providerTransferId: transfer!.providerTransferId, destination: transfer!.destination, amountCents: transfer!.amountCents,
          reference: transfer!.reference, ...(transfer!.kind === "residual" ? { kind: "residual" as const, requestHash: transfer!.requestHash } : {}),
          ...(transfer!.reversals.length ? { previousReversals: [...transfer!.reversals] } : {}) } };
      const request: MarketplaceRefundRequest = { ...raw, requestHash: fundingHash(raw) };
      if (row.hostMerchantId !== funding.hostMerchantId || row.provider !== "stripe" || row.accountFingerprint !== funding.accountFingerprint ||
          row.status !== "confirmed" || !row.claimedAt || !row.reconciledAt || !row.providerOperationId?.startsWith("trr_") ||
          row.reference !== request.reference || row.requestHash !== request.requestHash || fundingHash(row.request) !== fundingHash(request) ||
          !Number.isSafeInteger(row.amountCents) || row.amountCents <= 0 ||
          transfer!.reversals.reduce((sum, item) => sum + item.amountCents, row.amountCents) > transfer!.amountCents) fail("marketplace_residual_reversal_unconfirmed");
      transfer!.reversals.push({ providerOperationId: row.providerOperationId!, amountCents: row.amountCents, reference: row.reference, requestHash: row.requestHash });
    }
  };
  let previousFrontier = 0;
  for (const generation of generations) {
    const recorded = generation.basis as unknown as MarketplaceResidualBasis;
    const frontier = recorded.refunds?.length;
    if (generation.generation !== previousGenerations.length + 1 || generation.fundingPlanId !== funding.paymentIntentId ||
        generation.hostMerchantId !== funding.hostMerchantId ||
        !(generation.status === "completed" && !generation.heldReason || data.allowDisputeHeld && generation.status === "held" && generation.heldReason === "marketplace_residual_dispute_requires_reconciliation") ||
        !Number.isInteger(frontier) || frontier <= previousFrontier || frontier > refunds.length) fail();
    applyBefore(frontier);
    const prefix = refunds.slice(0, frontier);
    const basis = buildMarketplaceResidualBasis(funding, budget, prefix, structuredClone(transfers), [...previousGenerations]);
    const allocation = buildMarketplaceResidualHistoryAllocation(budget, prefix, basis);
    if (generation.basisHash !== fundingHash(basis) || generation.allocationHash !== fundingHash(allocation) ||
        fundingHash(generation.basis) !== generation.basisHash || fundingHash(generation.allocation) !== generation.allocationHash ||
        generation.operations.length !== allocation.beneficiaries.filter(row => row.amountCents > 0).length) fail();
    const beneficiaries = new Set<string>();
    for (const operation of [...generation.operations].sort((a, b) => a.beneficiaryMerchantId.localeCompare(b.beneficiaryMerchantId))) {
      const beneficiary = allocation.beneficiaries.find(row => row.merchantId === operation.beneficiaryMerchantId);
      if (!beneficiary || beneficiary.amountCents <= 0 || beneficiaries.has(beneficiary.merchantId)) fail();
      beneficiaries.add(beneficiary!.merchantId);
      const request = buildMarketplaceResidualRequest({ plan: funding, budget, basis, allocation }, beneficiary!, generation.basisHash);
      if (operation.status !== "confirmed" || !operation.claimedAt || !operation.reconciledAt || !operation.providerTransferId?.startsWith("tr_") ||
          operation.residualPlanId !== generation.id || operation.provider !== funding.provider || operation.accountFingerprint !== funding.accountFingerprint ||
          operation.amountCents !== request.amountCents || operation.reference !== request.reference || operation.requestHash !== request.requestHash ||
          fundingHash(operation.request) !== fundingHash(request)) fail();
      transfers.push({ kind: "residual", residualPlanId: generation.id, requestHash: operation.requestHash, payoutId: operation.id,
        merchantId: operation.beneficiaryMerchantId, providerTransferId: operation.providerTransferId!, reference: operation.reference,
        destination: beneficiary!.destination, amountCents: operation.amountCents, reversals: [] });
    }
    previousGenerations.push({ residualPlanId: generation.id, generation: generation.generation, basisHash: generation.basisHash, allocationHash: generation.allocationHash });
    previousFrontier = frontier;
  }
  applyBefore(refunds.length);
  if (new Set(transfers.map(row => row.payoutId)).size !== transfers.length || new Set(transfers.map(row => row.providerTransferId)).size !== transfers.length) fail();
  return { transfers, previousGenerations };
}
