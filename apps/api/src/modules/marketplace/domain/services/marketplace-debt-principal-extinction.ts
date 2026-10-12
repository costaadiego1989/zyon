import type { MarketplaceDisputeBalanceEntry, MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest } from "../ports/marketplace-dispute-closure.port.js";
import { assertMarketplaceDisputeClosureProof, marketplaceDisputeClosureProofHash } from "./marketplace-dispute-closure-evidence.js";
import { fundingHash } from "../../infrastructure/repositories/prisma-marketplace-funding.repository.js";

export interface MarketplaceDebtPrincipalExtinctionInput {
  hostMerchantId: string; paymentIntentId: string; providerDisputeId: string; debtId: string;
}
export interface MarketplaceDebtPrincipalExtinctionResult {
  status: "extinguished"; debtId: string; certificateId: string; extinguishedAmountCents: number;
  replay: boolean; fundingHoldReleased: false; payoutReauthorized: false;
}
export interface MarketplaceDebtPrincipalExtinctionEvidence {
  version: 1; reason: "stripe_dispute_principal_extinguished";
  debtId: string; sellerMerchantId: string; settlementId: string; payoutId: string;
  hostMerchantId: string; fundingPlanId: string; providerDisputeId: string; closureSnapshotId: string;
  requestHash: string; proofHash: string; provider: "stripe"; environment: "test" | "live";
  accountFingerprint: string; providerPaymentId: string; sourceId: string;
  instructionsHash: string; budgetHash: string; chargebackAt: string; providerTransferId: string;
  amountCents: number; withdrawal: MarketplaceDisputeBalanceEntry; reinstatement: MarketplaceDisputeBalanceEntry;
  disputeFeeCents: 0; fundingHoldReleased: false; payoutReauthorized: false;
}
export interface MarketplaceDebtPrincipalExtinctionBasis {
  request: MarketplaceDisputeClosureRequest; proof: MarketplaceDisputeClosureProof; closureSnapshotId: string;
  chargebackAt: Date; beneficiaryAmountCents: number;
  debt: { id: string; sellerMerchantId: string; settlementId: string; amountCents: number; status: string;
    recoveryId: string | null; resolvedAt: Date | null; deductedFromSettlementId: string | null };
  payout: { id: string; fundingPlanId: string | null; beneficiaryMerchantId: string | null; settlementId: string | null;
    kind: string; status: string; provider: string; accountFingerprint: string | null; providerPaymentId: string | null;
    providerTransferId: string | null; amountCents: number; claimedAt: Date | null; reconciledAt: Date | null };
  settlement: { id: string; hostMerchantId: string; sellerMerchantId: string; orderId: string; status: string; chargebackAt: Date | null };
  replay?: boolean;
}
const fail = (): never => { throw Error("marketplace_debt_principal_extinction_unproven"); };
const date = (value: Date | null): value is Date => value instanceof Date && Number.isFinite(value.getTime());

/** Native reinstatement extinguishes only the matching original principal.
 * It is not recovery from a seller, a fee collection or a payout permission. */
export function assertMarketplaceDebtPrincipalExtinctionBindings(input: MarketplaceDebtPrincipalExtinctionBasis, now = new Date()): void {
  const {request, proof, debt, payout, settlement} = input;
  assertMarketplaceDisputeClosureProof(request, proof, now);
  const proofHash = marketplaceDisputeClosureProofHash(proof);
  const snapshotId = `mdispute_snapshot_${fundingHash([request.hostMerchantId,request.paymentIntentId,request.providerDisputeId,proofHash])}`;
  if (proof.status !== "won" || input.closureSnapshotId !== snapshotId ||
      !date(input.chargebackAt) || !date(settlement.chargebackAt) || input.chargebackAt.getTime() !== settlement.chargebackAt.getTime() ||
      !debt.id?.trim() || !payout.id?.trim() || !Number.isSafeInteger(debt.amountCents) || debt.amountCents <= 0 || debt.amountCents > request.captureNetCents ||
      debt.recoveryId !== null || debt.deductedFromSettlementId !== null ||
      (input.replay ? debt.status !== "extinguished" || !date(debt.resolvedAt) : debt.status !== "outstanding" || debt.resolvedAt !== null) ||
      payout.kind !== "seller_settlement" || payout.status !== "confirmed" || !date(payout.claimedAt) || !date(payout.reconciledAt) ||
      payout.provider !== request.provider || payout.accountFingerprint !== request.accountFingerprint || payout.providerPaymentId !== request.providerPaymentId ||
      payout.fundingPlanId !== request.paymentIntentId || payout.beneficiaryMerchantId !== debt.sellerMerchantId || payout.settlementId !== debt.settlementId ||
      !/^tr_[A-Za-z0-9_]+$/.test(payout.providerTransferId ?? "") || payout.amountCents !== debt.amountCents || payout.amountCents !== input.beneficiaryAmountCents ||
      settlement.id !== debt.settlementId || settlement.sellerMerchantId !== debt.sellerMerchantId || settlement.hostMerchantId !== request.hostMerchantId ||
      settlement.orderId !== request.providerPaymentId || settlement.status !== "chargeback_debt") fail();
}

/** Legacy v1 remains restricted to zero net dispute fee. */
export function buildMarketplaceDebtPrincipalExtinction(input: MarketplaceDebtPrincipalExtinctionBasis, now = new Date()): MarketplaceDebtPrincipalExtinctionEvidence {
  assertMarketplaceDebtPrincipalExtinctionBindings(input, now);
  const {request, proof, debt, payout} = input;
  if (proof.providerFeeCents !== 0 || proof.balanceDeltaCents !== 0) fail();
  const proofHash = marketplaceDisputeClosureProofHash(proof);
  const withdrawal = proof.entries.find(row=>row.kind === "principal_withdrawal")!;
  const reinstatement = proof.entries.find(row=>row.kind === "principal_reinstatement")!;
  return {version:1,reason:"stripe_dispute_principal_extinguished",debtId:debt.id,sellerMerchantId:debt.sellerMerchantId,
    settlementId:debt.settlementId,payoutId:payout.id,hostMerchantId:request.hostMerchantId,fundingPlanId:request.paymentIntentId,
    providerDisputeId:request.providerDisputeId,closureSnapshotId:input.closureSnapshotId,requestHash:request.requestHash,proofHash,
    provider:"stripe",environment:request.environment,accountFingerprint:request.accountFingerprint,providerPaymentId:request.providerPaymentId,
    sourceId:request.sourceId,instructionsHash:request.instructionsHash,budgetHash:request.budgetHash,
    chargebackAt:input.chargebackAt.toISOString(),providerTransferId:payout.providerTransferId!,amountCents:debt.amountCents,
    withdrawal:{...withdrawal},reinstatement:{...reinstatement},disputeFeeCents:0,fundingHoldReleased:false,payoutReauthorized:false};
}
export function marketplaceDebtPrincipalExtinctionId(evidence: Pick<MarketplaceDebtPrincipalExtinctionEvidence,"hostMerchantId"|"fundingPlanId"|"debtId">): string {
  return `mdebt_extinction_${fundingHash([evidence.hostMerchantId,evidence.fundingPlanId,evidence.debtId])}`;
}
