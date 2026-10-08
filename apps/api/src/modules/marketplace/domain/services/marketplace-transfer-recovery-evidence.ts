export interface MarketplaceTransferRecoveryTarget {
  kind: "original" | "residual";
  id: string;
  beneficiaryMerchantId: string;
  provider: "stripe";
  accountFingerprint: string;
  providerPaymentId: string;
  providerTransferId: string;
  reference: string;
  destination: string;
  amountCents: number;
  requestHash?: string;
}
export interface MarketplaceTransferRecoveryEvidence {
  version: 1;
  reason: "chargeback_transfer_principal_recovered";
  fundingPlanId: string;
  hostMerchantId: string;
  instructionsHash: string;
  budgetHash: string;
  chargebackAt: string;
  target: MarketplaceTransferRecoveryTarget;
  reversals: Array<{ reversalId: string; refundPlanId: string; requestHash: string; providerOperationId: string; amountCents: number }>;
}

export type MarketplaceTransferRecoveryCreditEvidence = Omit<MarketplaceTransferRecoveryEvidence, "reason"> & {
  reason: "chargeback_transfer_principal_credit";
};
export type MarketplaceTransferRecoveryEvidenceInput = Omit<MarketplaceTransferRecoveryEvidence, "version" | "reason" | "reversals"> & {
  reversals: Array<MarketplaceTransferRecoveryEvidence["reversals"][number] & {
    status: string; claimedAt: Date | null; reconciledAt: Date | null;
    buyerStatus: string; buyerOperationStatus: string | null; buyerClaimedAt: Date | null; buyerReceipt: string | null;
  }>;
};

/** A single unspent provider receipt reduces principal outstanding but never
 * proves full recovery or resolves a dispute. Original target principal stays frozen. */
export function buildMarketplaceTransferRecoveryCreditEvidence(input: MarketplaceTransferRecoveryEvidenceInput): MarketplaceTransferRecoveryCreditEvidence | undefined {
  if (input.reversals.length !== 1 || input.reversals[0]!.amountCents > input.target.amountCents) return undefined;
  const validated = buildMarketplaceTransferRecoveryEvidence({ ...input,
    target: { ...input.target, amountCents: input.reversals[0]!.amountCents } });
  if (!validated || !Number.isSafeInteger(input.target.amountCents) || input.target.amountCents <= 0 || input.target.amountCents > 2_147_483_647) return undefined;
  return { ...validated, reason: "chargeback_transfer_principal_credit", target: { ...input.target } };
}

/** Certifies principal returned to the platform, never provider/dispute fees,
 * future offsets, a partial reversal or money already used for a buyer refund. */
export function buildMarketplaceTransferRecoveryEvidence(input: MarketplaceTransferRecoveryEvidenceInput): MarketplaceTransferRecoveryEvidence | undefined {
  const validCents = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;
  const { target, reversals } = input;
  if (!input.fundingPlanId || !input.hostMerchantId || !Number.isFinite(Date.parse(input.chargebackAt)) ||
      !/^[a-f0-9]{64}$/.test(input.instructionsHash) || !/^[a-f0-9]{64}$/.test(input.budgetHash) ||
      !target.id || !target.beneficiaryMerchantId || target.provider !== "stripe" || !target.accountFingerprint ||
      !target.providerPaymentId || !/^tr_[A-Za-z0-9_]+$/.test(target.providerTransferId) || !target.reference || !target.destination || !validCents(target.amountCents) ||
      (target.kind === "residual" ? !/^[a-f0-9]{64}$/.test(target.requestHash ?? "") : target.kind !== "original" || target.requestHash !== undefined) ||
      !reversals.length || new Set(reversals.map(row => row.reversalId)).size !== reversals.length ||
      new Set(reversals.map(row => row.providerOperationId)).size !== reversals.length ||
      reversals.some(row => !row.reversalId || !row.refundPlanId || row.status !== "confirmed" || !row.claimedAt || !row.reconciledAt ||
        !Number.isFinite(row.claimedAt.getTime()) || !Number.isFinite(row.reconciledAt.getTime()) ||
        !/^[a-f0-9]{64}$/.test(row.requestHash) || !/^trr_[A-Za-z0-9_]+$/.test(row.providerOperationId) || !validCents(row.amountCents) ||
        !["blocked", "prepared"].includes(row.buyerStatus) || row.buyerOperationStatus !== null && row.buyerOperationStatus !== "planned" || row.buyerClaimedAt || row.buyerReceipt) ||
      reversals.reduce((sum, row) => sum + row.amountCents, 0) !== target.amountCents) return undefined;
  return { version: 1, reason: "chargeback_transfer_principal_recovered", fundingPlanId: input.fundingPlanId,
    hostMerchantId: input.hostMerchantId, instructionsHash: input.instructionsHash, budgetHash: input.budgetHash, chargebackAt: input.chargebackAt, target,
    reversals: [...reversals].sort((a, b) => a.reversalId < b.reversalId ? -1 : a.reversalId > b.reversalId ? 1 : 0).map(({ reversalId, refundPlanId, requestHash, providerOperationId, amountCents }) =>
      ({ reversalId, refundPlanId, requestHash, providerOperationId, amountCents })) };
}
