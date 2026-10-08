import type { MarketplaceRefundContributionCertificate } from "../ports/marketplace-refund-contribution.port.js";
import { buildMarketplaceRefundContributionPlan, type MarketplaceRefundContributionBasis } from "./marketplace-refund-contribution.js";
import type { MarketplaceResidualAllocationV1 } from "./marketplace-residual-allocation.js";

export interface MarketplaceResidualContributionFunding {
  planHash: string;
  contributedNetCents: number;
  certificates: MarketplaceRefundContributionCertificate[];
}
export interface MarketplaceResidualSourceBudget {
  sourceId: string;
  providerPaymentId: string;
  chargeId: string;
  balanceTransactionId: string;
  capturedGrossCents: number;
  processingFeeCents: number;
  creditedNetCents: number;
  refundDebitCents: number;
  platformRetainedCents: number;
  excessLiabilityCents: number;
  payoutTotalCents: number;
  beneficiaries: Array<{ merchantId: string; destination: string; amountCents: number }>;
}
export interface MarketplaceResidualAllocationV4 extends Omit<MarketplaceResidualAllocationV1, "version"> {
  version: 4;
  contributedNetCents: number;
  contributionProcessingFeeCents: number;
  excessLiabilityCents: number;
  sources: MarketplaceResidualSourceBudget[];
}
const cents = (v: number) => Number.isSafeInteger(v) && v >= 0 && v <= 2_147_483_647;
const fail = (): never => { throw Error("marketplace_residual_source_budget_invalid"); };

/** Credits cover the original seller's deficit. Their processing cost and any
 * excess remain outside the order's spendable budget. Sources never become a
 * merchant balance or a reusable allowance for another order. */
export function buildMarketplaceResidualContributionAllocation(basis: MarketplaceRefundContributionBasis,
  funding: MarketplaceResidualContributionFunding): MarketplaceResidualAllocationV4 {
  const plan = buildMarketplaceRefundContributionPlan(basis, funding.certificates);
  if (!funding.certificates.length || !plan.fullyFunded || plan.planHash !== funding.planHash ||
      plan.contributedNetCents !== funding.contributedNetCents || !basis.budget.capture.balanceTransactionId) fail();
  const beneficiaries = plan.remainingBeneficiaries.map(row => ({ ...row,
    destination: basis.instructions.destinations.find(d => d.merchantId === row.merchantId)!.destination }))
    .sort((a, b) => a.merchantId.localeCompare(b.merchantId));
  const payoutTotalCents = beneficiaries.reduce((s, row) => s + row.amountCents, 0);
  const original = basis.budget.capture;
  let remainingRefund = plan.cumulativeRefundCents;
  const originalRefund = Math.min(remainingRefund, original.netAmountCents);
  remainingRefund -= originalRefund;
  if (plan.platformRemainingCents > original.netAmountCents - originalRefund) fail();
  const sources: MarketplaceResidualSourceBudget[] = [{ sourceId: "original", providerPaymentId: original.providerPaymentId,
    chargeId: original.sourceId, balanceTransactionId: original.balanceTransactionId!, capturedGrossCents: original.amountCents,
    processingFeeCents: original.providerFeeCents, creditedNetCents: original.netAmountCents, refundDebitCents: originalRefund,
    platformRetainedCents: plan.platformRemainingCents, excessLiabilityCents: 0,
    payoutTotalCents: original.netAmountCents - originalRefund - plan.platformRemainingCents, beneficiaries: [] }];
  for (const certificate of funding.certificates) {
    const debit = Math.min(remainingRefund, certificate.creditCents);
    remainingRefund -= debit;
    sources.push({ sourceId: `contribution:${certificate.certificateHash}`, providerPaymentId: certificate.request.providerPaymentIntentId,
      chargeId: certificate.proof.charge.id, balanceTransactionId: certificate.proof.balance.id,
      capturedGrossCents: certificate.request.grossAmountCents, processingFeeCents: certificate.processingFeeCents,
      creditedNetCents: certificate.creditCents, refundDebitCents: debit, platformRetainedCents: 0,
      excessLiabilityCents: certificate.excessLiabilityCents ?? 0, payoutTotalCents: certificate.creditCents - debit, beneficiaries: [] });
  }
  const remaining = new Map(beneficiaries.map(row => [row.merchantId, row.amountCents]));
  for (const source of sources) {
    let available = source.payoutTotalCents;
    for (const row of beneficiaries) {
      const amountCents = Math.min(available, remaining.get(row.merchantId)!);
      if (amountCents) source.beneficiaries.push({ merchantId: row.merchantId, destination: row.destination, amountCents });
      remaining.set(row.merchantId, remaining.get(row.merchantId)! - amountCents);
      available -= amountCents;
    }
    if (available || ![source.capturedGrossCents, source.processingFeeCents, source.creditedNetCents, source.refundDebitCents,
      source.platformRetainedCents, source.excessLiabilityCents, source.payoutTotalCents].every(cents) ||
        source.capturedGrossCents - source.processingFeeCents !== source.creditedNetCents + source.excessLiabilityCents ||
        source.creditedNetCents !== source.refundDebitCents + source.platformRetainedCents + source.payoutTotalCents) fail();
  }
  const excessLiabilityCents = sources.reduce((s, row) => s + row.excessLiabilityCents, 0);
  if (remainingRefund || [...remaining.values()].some(v => v !== 0) || !cents(payoutTotalCents) || !cents(excessLiabilityCents) ||
      beneficiaries.some(row => !cents(row.amountCents)) ||
      sources.reduce((s, row) => s + row.payoutTotalCents, 0) !== payoutTotalCents ||
      original.netAmountCents + plan.contributedNetCents !== plan.cumulativeRefundCents + plan.platformRemainingCents + payoutTotalCents) fail();
  return { version: 4, capturedNetCents: original.netAmountCents, refundedCents: plan.cumulativeRefundCents,
    platformRetainedCents: plan.platformRemainingCents, payoutTotalCents, contributedNetCents: plan.contributedNetCents,
    contributionProcessingFeeCents: plan.contributionProcessingFeeCents, excessLiabilityCents, beneficiaries, sources };
}
