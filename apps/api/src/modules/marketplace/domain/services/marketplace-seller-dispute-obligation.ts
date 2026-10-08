import type { MarketplaceSellerFeeCredit } from "../ports/marketplace-seller-fee-collection.port.js";
import type { MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence } from "./marketplace-debt-principal-extinction-positive-fee.js";
import { marketplaceDebtPrincipalExtinctionId } from "./marketplace-debt-principal-extinction.js";
import { buildSellerFeeCredit, validSellerFeeCollection } from "./marketplace-seller-fee-collection.js";
import { fundingHash } from "../../infrastructure/repositories/prisma-marketplace-funding.repository.js";
import type { MarketplaceFeeExcessReturn } from "../ports/marketplace-fee-excess-return.port.js";
import { marketplaceFeeExcessReturnHashes } from "./marketplace-fee-excess-return.js";

import type { MarketplaceSellerDisputeObligationEvidence, MarketplaceSellerPositiveFeeDisputeObligationEvidence,
  MarketplaceSellerZeroFeeDisputeObligationEvidence } from "../ports/marketplace-seller-dispute-obligation.port.js";
import type { MarketplaceDisputeClosureRequest } from "../ports/marketplace-dispute-closure.port.js";
import type { MarketplaceDebtPrincipalExtinctionCertificateEvidence } from "./marketplace-debt-principal-extinction-positive-fee.js";
import { allocateMarketplaceDisputeFee } from "./marketplace-dispute-closure-evidence.js";
export type { MarketplaceSellerDisputeObligationEvidence, MarketplaceSellerPositiveFeeDisputeObligationEvidence,
  MarketplaceSellerZeroFeeDisputeObligationEvidence } from "../ports/marketplace-seller-dispute-obligation.port.js";

const same = (a: unknown, b: unknown): boolean => fundingHash(a) === fundingHash(b);
const positiveCents = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v > 0 && v <= 2147483647;

/** Historical credits close only this seller's certified obligation. The caller
 * must separately prove the persisted principal certificate and financial outbox.
 * This evidence never releases the original funding or reauthorizes its payout. */
export function buildMarketplaceSellerDisputeObligation(evidence: MarketplaceDebtPrincipalExtinctionPositiveFeeEvidence,
  feeCertificateId: string, feeCertificateHash: string, credits: MarketplaceSellerFeeCredit[], returns: MarketplaceFeeExcessReturn[] = []): MarketplaceSellerPositiveFeeDisputeObligationEvidence | undefined {
  try {
    if (evidence.version !== 2 || evidence.reason !== "stripe_dispute_principal_extinguished" || evidence.provider !== "stripe" ||
        evidence.feeCollectionState !== "uncollected" || evidence.fundingHoldReleased !== false || evidence.payoutReauthorized !== false ||
        !positiveCents(evidence.amountCents) || !positiveCents(evidence.disputeFeeCents) || !positiveCents(evidence.sellerDisputeFeeCents) ||
        feeCertificateId !== marketplaceDebtPrincipalExtinctionId(evidence) || feeCertificateHash !== fundingHash(evidence) ||
        !Array.isArray(credits) || credits.length < 1 || credits.length > 2000) return;
    const hashes: string[] = [], collections = new Set<string>(), receipts = new Set<string>();
    let collected = 0, processingFee = 0;
    const originalRequest = credits[0]!.request.disputeRequest;
    for (const credit of credits) {
      const request = credit.request;
      if (!validSellerFeeCollection(request) || request.feeCertificateId !== feeCertificateId || request.feeCertificateHash !== feeCertificateHash ||
          !same(request.feeEvidence, evidence) || !same(request.disputeRequest, originalRequest) ||
          !same(request.priorCreditHashes, hashes) || request.maximumCreditCents !== evidence.sellerDisputeFeeCents - collected ||
          collections.has(request.collectionId)) return;
      const rebuilt = buildSellerFeeCredit(request, credit.proof, new Date(credit.proof.observedAt), false);
      if (!rebuilt || !same(rebuilt, credit) || !positiveCents(credit.creditCents)) return;
      for (const receipt of [credit.proof.sessionId, credit.proof.paymentIntent.id, credit.proof.charge.id, credit.proof.balance.id]) {
        if (receipts.has(receipt)) return;
        receipts.add(receipt);
      }
      collections.add(request.collectionId);
      collected += credit.creditCents;
      processingFee += credit.processingFeeCents;
      if (!Number.isSafeInteger(collected) || collected > evidence.sellerDisputeFeeCents || !Number.isSafeInteger(processingFee)) return;
      hashes.push(credit.certificateHash);
    }
    if (collected !== evidence.sellerDisputeFeeCents) return;
    const returnHashes = marketplaceFeeExcessReturnHashes("seller", credits, returns);
    if (!returnHashes) return;
    return { version: 1, reason: "stripe_seller_dispute_obligation_closed", debtId: evidence.debtId, feeCertificateId, feeCertificateHash,
      hostMerchantId: evidence.hostMerchantId, fundingPlanId: evidence.fundingPlanId, sellerMerchantId: evidence.sellerMerchantId,
      providerDisputeId: evidence.providerDisputeId, closureSnapshotId: evidence.closureSnapshotId, provider: "stripe",
      environment: evidence.environment, accountFingerprint: evidence.accountFingerprint, principalAmountCents: evidence.amountCents,
      disputeFeeCents: evidence.sellerDisputeFeeCents, collectedFeeCents: collected, processingFeeCents: processingFee,
      excessLiabilityCents: 0, creditHashes: hashes, ...(returnHashes.length ? { excessReturnHashes: returnHashes } : {}), fundingHoldReleased: false, payoutReauthorized: false };
  } catch { return; }
}

/** The caller must prove the persisted principal certificate, native ledger and
 * causal outbox. A zero allocation closes the individual obligation without
 * representing restored principal as a fee payment or fabricating a credit. */
export function buildMarketplaceSellerZeroFeeDisputeObligation(e: MarketplaceDebtPrincipalExtinctionCertificateEvidence,
  feeCertificateId: string, feeCertificateHash: string, request: MarketplaceDisputeClosureRequest): MarketplaceSellerZeroFeeDisputeObligationEvidence | undefined {
  try {
    if (e.reason !== "stripe_dispute_principal_extinguished" || e.provider !== "stripe" || !positiveCents(e.amountCents) ||
        e.fundingHoldReleased !== false || e.payoutReauthorized !== false ||
        feeCertificateId !== marketplaceDebtPrincipalExtinctionId(e) || feeCertificateHash !== fundingHash(e) ||
        e.requestHash !== request.requestHash || e.hostMerchantId !== request.hostMerchantId || e.fundingPlanId !== request.paymentIntentId ||
        e.providerDisputeId !== request.providerDisputeId || e.environment !== request.environment || e.accountFingerprint !== request.accountFingerprint ||
        e.providerPaymentId !== request.providerPaymentId || e.sourceId !== request.sourceId ||
        e.instructionsHash !== request.instructionsHash || e.budgetHash !== request.budgetHash ||
        !e.debtId?.trim() || !e.settlementId?.trim() || !e.payoutId?.trim() || e.sellerMerchantId === e.hostMerchantId ||
        !/^tr_[A-Za-z0-9_]+$/.test(e.providerTransferId) || !/^mdispute_snapshot_[a-f0-9]{64}$/.test(e.closureSnapshotId) ||
        !/^[a-f0-9]{64}$/.test(e.proofHash)) return;
    const allocations = allocateMarketplaceDisputeFee(request, e.disputeFeeCents);
    if (!allocations.some(a => a.sellerMerchantId === e.sellerMerchantId && a.feeCents === 0)) return;
    if (e.version === 1) { if (e.disputeFeeCents !== 0) return; }
    else if (e.version === 2) {
      if (!positiveCents(e.disputeFeeCents) || e.sellerDisputeFeeCents !== 0 || e.feeCollectionState !== "uncollected" || !same(e.feeAllocation, allocations)) return;
    } else return;
    return { version: 2, reason: "stripe_seller_zero_fee_dispute_obligation_closed", debtId: e.debtId, feeCertificateId, feeCertificateHash,
      hostMerchantId: e.hostMerchantId, fundingPlanId: e.fundingPlanId, sellerMerchantId: e.sellerMerchantId,
      providerDisputeId: e.providerDisputeId, closureSnapshotId: e.closureSnapshotId, provider: "stripe", environment: e.environment,
      accountFingerprint: e.accountFingerprint, principalAmountCents: e.amountCents, disputeFeeCents: 0, collectedFeeCents: 0,
      processingFeeCents: 0, excessLiabilityCents: 0, creditHashes: [], fundingHoldReleased: false, payoutReauthorized: false };
  } catch { return; }
}

export function marketplaceSellerDisputeObligationId(evidence: Pick<MarketplaceSellerDisputeObligationEvidence, "hostMerchantId" | "fundingPlanId" | "debtId">): string {
  return `mseller_obligation_${fundingHash([evidence.hostMerchantId, evidence.fundingPlanId, evidence.debtId])}`;
}

export function marketplaceSellerDisputeObligationPayload(evidence: MarketplaceSellerDisputeObligationEvidence) {
  return { obligation_id: marketplaceSellerDisputeObligationId(evidence), debt_id: evidence.debtId, fee_certificate_id: evidence.feeCertificateId,
    funding_plan_id: evidence.fundingPlanId, seller_merchant_id: evidence.sellerMerchantId, evidence_hash: fundingHash(evidence),
    principal_amount_cents: evidence.principalAmountCents, dispute_fee_cents: evidence.disputeFeeCents, collected_fee_cents: evidence.collectedFeeCents,
    processing_fee_cents: evidence.processingFeeCents, excess_liability_cents: 0, funding_hold_released: false, payout_reauthorized: false,
    ...(evidence.version === 1 && evidence.excessReturnHashes?.length ? { excess_return_hashes: evidence.excessReturnHashes } : {}),
    ...(evidence.version === 2 ? { certificate_version: 2, fee_resolution: "zero_allocation" } : {}) };
}
