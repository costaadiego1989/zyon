import type { buildMarketplaceFundingBudget } from "./marketplace-funding-budget.js";
import type { MarketplaceRefundAllocation } from "./marketplace-refund-allocation.js";

type Budget = ReturnType<typeof buildMarketplaceFundingBudget>;
export interface MarketplaceResidualBasisV1 {
  version: 1;
  fundingPlanId: string;
  instructionsHash: string;
  budgetHash: string;
  refunds: Array<{ refundPlanId: string; returnId: string; allocationHash: string; requestHash: string;
    providerOperationId: string; amountCents: number }>;
}
export interface MarketplaceResidualOriginalTransfer {
  /** Absent for original payout journals, preserving their immutable hashes. */
  kind?: "residual";
  residualPlanId?: string;
  requestHash?: string;
  payoutId: string;
  merchantId: string;
  providerTransferId: string;
  reference: string;
  destination: string;
  amountCents: number;
  reversals: Array<{ providerOperationId: string; amountCents: number; reference: string; requestHash: string }>;
}
export interface MarketplaceResidualBasisV2 extends Omit<MarketplaceResidualBasisV1, "version"> {
  version: 2;
  originalTransfers: MarketplaceResidualOriginalTransfer[];
}
export interface MarketplaceResidualPreviousGeneration {
  residualPlanId: string;
  generation: number;
  basisHash: string;
  allocationHash: string;
}
export interface MarketplaceResidualBasisV3 extends Omit<MarketplaceResidualBasisV2, "version"> {
  version: 3;
  previousGenerations: MarketplaceResidualPreviousGeneration[];
}
export interface MarketplaceResidualBasisV4 extends Omit<MarketplaceResidualBasisV1, "version"> {
  version: 4;
  fundingContributions: import("./marketplace-residual-sources.js").MarketplaceResidualContributionFunding;
}
export type MarketplaceResidualBasis = MarketplaceResidualBasisV1 | MarketplaceResidualBasisV2 | MarketplaceResidualBasisV3 | MarketplaceResidualBasisV4 |
  import("./asaas-marketplace-residual.js").AsaasMarketplaceResidualBasis |
  import("../ports/stripe-marketplace-successive-residual.port.js").StripeMarketplaceSuccessiveResidualBasis |
  import("../ports/asaas-marketplace-host-retention.port.js").AsaasMarketplaceHostRetentionBasis;
export interface MarketplaceResidualAllocationV1 {
  version: 1;
  capturedNetCents: number;
  refundedCents: number;
  platformRetainedCents: number;
  payoutTotalCents: number;
  beneficiaries: Array<{ merchantId: string; destination: string; amountCents: number; providerFeeCents: number }>;
}
export interface MarketplaceResidualAllocationV2 extends Omit<MarketplaceResidualAllocationV1, "version" | "beneficiaries"> {
  version: 2;
  alreadyTransferredCents: number;
  beneficiaries: Array<MarketplaceResidualAllocationV1["beneficiaries"][number] & { alreadyTransferredCents: number }>;
}
export interface MarketplaceResidualAllocationV3 extends Omit<MarketplaceResidualAllocationV2, "version"> { version: 3 }
export type MarketplaceResidualAllocation = MarketplaceResidualAllocationV1 | MarketplaceResidualAllocationV2 | MarketplaceResidualAllocationV3 |
  import("./marketplace-residual-sources.js").MarketplaceResidualAllocationV4 |
  import("./asaas-marketplace-residual.js").AsaasMarketplaceResidualAllocation |
  import("../ports/stripe-marketplace-successive-residual.port.js").StripeMarketplaceSuccessiveResidualAllocation |
  import("../ports/asaas-marketplace-host-retention.port.js").AsaasMarketplaceHostRetentionAllocation;
const cents = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
const fail = (): never => { throw new Error("marketplace_residual_allocation_invalid"); };

/** Replays append-only debits; processing costs stay with the original sellers. */
export function buildMarketplaceResidualAllocation(budget: Budget, refunds: MarketplaceRefundAllocation[]): MarketplaceResidualAllocationV1 {
  if (!refunds.length || !cents(budget.capture.netAmountCents) || !budget.beneficiaries.length ||
      new Set(budget.beneficiaries.map(row => row.merchantId)).size !== budget.beneficiaries.length) fail();
  const remaining = new Map(budget.beneficiaries.map(row => [row.merchantId, row.amountCents]));
  let refundedCents = 0, platformRetainedCents = budget.platformRetainedCents;
  for (const refund of refunds) {
    if (refund.version !== 1 || !cents(refund.amountCents) || !refund.amountCents || !cents(refund.platformDebitCents) ||
        !Number.isSafeInteger(refund.merchantDebitCents) || !Array.isArray(refund.merchantDebits) ||
        new Set(refund.merchantDebits.map(row => row.merchantId)).size !== remaining.size ||
        refund.merchantDebits.length !== remaining.size || refund.requiredContributions.length) fail();
    let debited = 0;
    for (const debit of refund.merchantDebits) {
      if (!remaining.has(debit.merchantId) || !Number.isSafeInteger(debit.amountCents)) fail();
      remaining.set(debit.merchantId, remaining.get(debit.merchantId)! - debit.amountCents);
      debited += debit.amountCents;
    }
    refundedCents += refund.amountCents;
    platformRetainedCents -= refund.platformDebitCents;
    if (!cents(refundedCents) || !cents(platformRetainedCents) || debited !== refund.merchantDebitCents ||
        debited + refund.platformDebitCents !== refund.amountCents || refund.cumulativeRefundCents !== refundedCents ||
        refund.platformRemainingCents !== platformRetainedCents || refund.remainingBeneficiaries.length !== remaining.size ||
        new Set(refund.remainingBeneficiaries.map(row => row.merchantId)).size !== remaining.size ||
        refund.remainingBeneficiaries.some(row => !remaining.has(row.merchantId) || !cents(row.amountCents) ||
          remaining.get(row.merchantId) !== row.amountCents ||
          budget.beneficiaries.find(original => original.merchantId === row.merchantId)?.providerFeeCents !== row.providerFeeCents)) fail();
  }
  const beneficiaries = budget.beneficiaries.map(row => ({ merchantId: row.merchantId, destination: row.destination,
    amountCents: remaining.get(row.merchantId)!, providerFeeCents: row.providerFeeCents }))
    .sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const payoutTotalCents = beneficiaries.reduce((sum, row) => sum + row.amountCents, 0);
  if (!cents(payoutTotalCents) || beneficiaries.some(row => !cents(row.amountCents)) ||
      payoutTotalCents + platformRetainedCents + refundedCents !== budget.capture.netAmountCents) fail();
  return { version: 1, capturedNetCents: budget.capture.netAmountCents, refundedCents,
    platformRetainedCents, payoutTotalCents, beneficiaries };
}

/** Previously confirmed transfers remain the beneficiary's money except for
 * independently proven reversals. Only the unpaid remainder can be sent again. */
export function buildMarketplaceResidualAfterReversalAllocation(budget: Budget, refunds: MarketplaceRefundAllocation[],
  originalTransfers: MarketplaceResidualOriginalTransfer[]): MarketplaceResidualAllocationV2 {
  return afterTransfers(budget, refunds, originalTransfers, 2) as MarketplaceResidualAllocationV2;
}

/** Gross historical transfers may exceed the first budget after money is
 * reversed and redistributed. Only proven net money remains with recipients. */
export function buildMarketplaceResidualAfterGenerationAllocation(budget: Budget, refunds: MarketplaceRefundAllocation[],
  transfers: MarketplaceResidualOriginalTransfer[]): MarketplaceResidualAllocationV3 {
  return afterTransfers(budget, refunds, transfers, 3) as MarketplaceResidualAllocationV3;
}

function afterTransfers(budget: Budget, refunds: MarketplaceRefundAllocation[],
  originalTransfers: MarketplaceResidualOriginalTransfer[], version: 2 | 3): MarketplaceResidualAllocationV2 | MarketplaceResidualAllocationV3 {
  const remaining = buildMarketplaceResidualAllocation(budget, refunds);
  if (!Array.isArray(originalTransfers) || !originalTransfers.length ||
      new Set(originalTransfers.map(row => row.payoutId)).size !== originalTransfers.length ||
      new Set(originalTransfers.map(row => row.providerTransferId)).size !== originalTransfers.length ||
      new Set(originalTransfers.map(row => row.reference)).size !== originalTransfers.length) fail();
  const transferred = new Map(remaining.beneficiaries.map(row => [row.merchantId, { gross: 0, net: 0 }]));
  const reversalIds = new Set<string>(), reversalReferences = new Set<string>();
  for (const transfer of originalTransfers) {
    const beneficiary = budget.beneficiaries.find(row => row.merchantId === transfer.merchantId);
    if (!beneficiary || !transfer.payoutId?.trim() || !transfer.providerTransferId?.trim() || !transfer.reference?.trim() ||
        transfer.destination !== beneficiary.destination || !cents(transfer.amountCents) || !transfer.amountCents || !Array.isArray(transfer.reversals)) fail();
    let reversed = 0;
    for (const reversal of transfer.reversals) {
      if (!reversal.providerOperationId?.trim() || !reversal.reference?.trim() || !/^[a-f0-9]{64}$/.test(reversal.requestHash) ||
          !cents(reversal.amountCents) || !reversal.amountCents || reversalIds.has(reversal.providerOperationId) || reversalReferences.has(reversal.reference)) fail();
      reversalIds.add(reversal.providerOperationId); reversalReferences.add(reversal.reference);
      reversed += reversal.amountCents;
    }
    if (reversed > transfer.amountCents) fail();
    const total = transferred.get(transfer.merchantId)!;
    total.gross += transfer.amountCents; total.net += transfer.amountCents - reversed;
    if (version === 2 && (transfer.kind !== undefined || total.gross > beneficiary!.amountCents)) fail();
    if (version === 3 && transfer.kind === "residual" && (!transfer.residualPlanId || !/^[a-f0-9]{64}$/.test(transfer.requestHash ?? ""))) fail();
  }
  const beneficiaries = remaining.beneficiaries.map(row => ({ ...row,
    amountCents: row.amountCents - transferred.get(row.merchantId)!.net,
    alreadyTransferredCents: transferred.get(row.merchantId)!.net }));
  const alreadyTransferredCents = beneficiaries.reduce((sum, row) => sum + row.alreadyTransferredCents, 0);
  const payoutTotalCents = beneficiaries.reduce((sum, row) => sum + row.amountCents, 0);
  if (!cents(alreadyTransferredCents) || !cents(payoutTotalCents) || beneficiaries.some(row => !cents(row.amountCents)) ||
      alreadyTransferredCents + payoutTotalCents + remaining.platformRetainedCents + remaining.refundedCents !== remaining.capturedNetCents) fail();
  return { ...remaining, version, alreadyTransferredCents, payoutTotalCents, beneficiaries };
}
