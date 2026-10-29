import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type { MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import { buildMarketplaceTransferRecoveryCreditEvidence, buildMarketplaceTransferRecoveryEvidence, type MarketplaceTransferRecoveryTarget } from "../../domain/services/marketplace-transfer-recovery-evidence.js";
import { fundingHash, lockMarketplaceOrder, type FundingBudget } from "./prisma-marketplace-funding.repository.js";

export type MarketplaceRecoveryProofReader = (refundPlanId: string) => Promise<{
  instructionsHash: string; budget: FundingBudget; chargebackAt: Date;
  required: Array<{ targetId: string; request: MarketplaceRefundRequest }>;
}>;

/** Caller holds the order lock. This function only stores proof and resolves an
 * exactly matching principal debt; it never schedules transfers or refunds. */
export async function recordMarketplaceTransferRecoveries(tx: Prisma.TransactionClient, hostMerchantId: string,
  fundingPlanId: string, readProof: MarketplaceRecoveryProofReader): Promise<string[]> {
  const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: fundingPlanId, hostMerchantId } });
  if (!funding?.providerPaymentId || funding.provider !== "stripe" || funding.status !== "held") return [];
  if (!await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) return [];
  await lockMarketplaceOrder(tx, hostMerchantId, funding.providerPaymentId);
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: funding.providerPaymentId } } });
  if (!ledger?.purchasedAt || !ledger.chargebackAt) return [];
  const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId }, include: { operation: true } });
  if (refunds.some(row => !["blocked", "prepared", "confirmed"].includes(row.status) ||
      row.operation && (["unknown", "pending", "failed"].includes(row.operation.status) ||
        row.status !== "confirmed" && (row.operation.claimedAt || row.operation.providerOperationId)))) return [];
  const rows = await tx.marketplaceTransferReversal.findMany({ where: { OR: [{ refundPlan: { fundingPlanId } },
    { payout: { fundingPlanId } }, { residualOperation: { residualPlan: { fundingPlanId } } }] },
    include: { payout: true, residualOperation: { include: { residualPlan: true } } }, orderBy: { id: "asc" } });
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.payoutId ? `original:${row.payoutId}` : `residual:${row.residualOperationId}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const proofs = new Map<string, Awaited<ReturnType<MarketplaceRecoveryProofReader>> | null>();
  const created: string[] = [];
  for (const allMembers of groups.values()) {
    const first = allMembers[0]!, target = first.payout ?? first.residualOperation;
    if (!target || target.status !== "confirmed" || !target.claimedAt || !target.reconciledAt || !target.providerTransferId ||
        target.provider !== funding.provider || target.accountFingerprint !== funding.accountFingerprint || !target.beneficiaryMerchantId ||
        allMembers.some(row => row.hostMerchantId !== hostMerchantId || row.provider !== funding.provider || row.accountFingerprint !== funding.accountFingerprint)) continue;
    if (first.payout ? first.payout.fundingPlanId !== fundingPlanId : first.residualOperation!.residualPlan.fundingPlanId !== fundingPlanId ||
        first.residualOperation!.residualPlan.status !== "held" || first.residualOperation!.residualPlan.heldReason !== "marketplace_residual_dispute_requires_reconciliation") continue;
    // Consumed reversals remain in historical conservation, but never become dispute credits.
    if (allMembers.filter(row => row.status === "confirmed").reduce((sum, row) => sum + row.amountCents, 0) > target.amountCents) continue;
    const members = allMembers.filter(row => row.status === "confirmed" && row.providerOperationId &&
      refunds.some(refund => refund.id === row.refundPlanId && ["blocked", "prepared"].includes(refund.status)));
    if (!members.length) continue;
    const residualRequest = first.residualOperation?.request as unknown as { destination: string } | undefined;
    const binding: MarketplaceTransferRecoveryTarget = { kind: first.payout ? "original" : "residual", id: target.id,
      beneficiaryMerchantId: target.beneficiaryMerchantId, provider: "stripe", accountFingerprint: funding.accountFingerprint,
      providerPaymentId: funding.providerPaymentId, providerTransferId: target.providerTransferId, reference: target.reference,
      destination: first.payout?.destination ?? residualRequest!.destination, amountCents: target.amountCents,
      ...(first.residualOperation ? { requestHash: first.residualOperation.requestHash } : {}) };
    let verified = true, budget: FundingBudget | undefined;
    for (const row of members) {
      if (!proofs.has(row.refundPlanId)) {
        try { proofs.set(row.refundPlanId, await readProof(row.refundPlanId)); }
        catch (error) {
          if (error instanceof ConflictException || error instanceof Error && /^marketplace_/.test(error.message)) proofs.set(row.refundPlanId, null);
          else throw error;
        }
      }
      const proof = proofs.get(row.refundPlanId), expected = proof?.required.find(item => item.targetId === target.id)?.request;
      if (!proof || proof.chargebackAt.getTime() !== ledger.chargebackAt.getTime() || proof.instructionsHash !== funding.instructionsHash ||
          !expected || expected.requestHash !== row.requestHash || fundingHash(expected) !== fundingHash(row.request) ||
          expected.transfer?.providerTransferId !== target.providerTransferId || expected.amountCents !== row.amountCents ||
          (!!row.residualOperationId) !== (binding.kind === "residual")) { verified = false; break; }
      budget = proof.budget;
    }
    if (!verified || !budget) continue;
    const evidenceInput = { fundingPlanId, hostMerchantId, instructionsHash: funding.instructionsHash,
      budgetHash: fundingHash(budget), chargebackAt: ledger.chargebackAt.toISOString(), target: binding, reversals: members.map(row => {
        const refund = refunds.find(plan => plan.id === row.refundPlanId)!;
        return { reversalId: row.id, refundPlanId: row.refundPlanId, requestHash: row.requestHash, providerOperationId: row.providerOperationId!,
          amountCents: row.amountCents, status: row.status, claimedAt: row.claimedAt, reconciledAt: row.reconciledAt,
          buyerStatus: refund.status, buyerOperationStatus: refund.operation?.status ?? null, buyerClaimedAt: refund.operation?.claimedAt ?? null,
          buyerReceipt: refund.operation?.providerOperationId ?? null };
      }) };
    const sellerDebt = first.payout?.settlementId ? await tx.marketplaceSellerDebt.findUnique({ where: { settlementId: first.payout.settlementId } }) : null;
    const hostDebt = first.payout ? await tx.marketplaceHostDebt.findUnique({ where: { payoutId: first.payout.id } }) : null;
    if (sellerDebt && hostDebt || sellerDebt && (sellerDebt.sellerMerchantId !== binding.beneficiaryMerchantId || sellerDebt.amountCents !== binding.amountCents || sellerDebt.status === "deducted") ||
        hostDebt && (hostDebt.hostMerchantId !== binding.beneficiaryMerchantId || hostDebt.amountCents !== binding.amountCents || hostDebt.status === "deducted")) continue;
    for (const member of members) {
      const creditEvidence = buildMarketplaceTransferRecoveryCreditEvidence({ ...evidenceInput,
        reversals: evidenceInput.reversals.filter(row => row.reversalId === member.id) });
      if (!creditEvidence) continue;
      const creditHash = fundingHash(creditEvidence);
      const prior = await tx.marketplaceTransferRecoveryCredit.findUnique({ where: { reversalId: member.id } });
      if (prior && (prior.evidenceHash !== creditHash || fundingHash(prior.evidence) !== creditHash)) continue;
      const credit = prior ?? await tx.marketplaceTransferRecoveryCredit.create({ data: { fundingPlanId, hostMerchantId,
        beneficiaryMerchantId: binding.beneficiaryMerchantId, reversalId: member.id,
        ...(first.payout ? { payoutId: target.id } : { residualOperationId: target.id }),
        provider: binding.provider, accountFingerprint: binding.accountFingerprint, providerTransferId: binding.providerTransferId,
        providerOperationId: member.providerOperationId!, amountCents: member.amountCents,
        evidence: creditEvidence as unknown as Prisma.InputJsonValue, evidenceHash: creditHash } });
      const creditEventId = `marketplace_transfer_recovery_credit_${credit.id}`;
      await tx.outboxMessage.upsert({ where: { eventId: creditEventId }, update: {}, create: { eventId: creditEventId,
        eventType: "marketplace.transfer_recovery_credit.confirmed", schemaVersion: 1, merchantId: hostMerchantId,
        occurredAt: credit.createdAt, correlationId: fundingPlanId, causationId: member.id, producer: "marketplace",
        payload: { recovery_credit_id: credit.id, funding_plan_id: fundingPlanId, beneficiary_merchant_id: binding.beneficiaryMerchantId,
          target_kind: binding.kind, target_id: binding.id, reversal_id: member.id, amount_cents: member.amountCents, evidence_hash: creditHash } } });
    }
    // Full certificates retain their original V1 contract, including every reversal.
    const evidence = members.length === allMembers.length ? buildMarketplaceTransferRecoveryEvidence(evidenceInput) : undefined;
    if (!evidence) continue;
    const evidenceHash = fundingHash(evidence);
    const existing = await tx.marketplaceTransferRecovery.findFirst({ where: first.payout ? { payoutId: target.id } : { residualOperationId: target.id } });
    if (existing && (existing.evidenceHash !== evidenceHash || fundingHash(existing.evidence) !== evidenceHash)) continue;
    if (sellerDebt?.status === "resolved" && sellerDebt.recoveryId !== existing?.id || hostDebt?.status === "resolved" && hostDebt.recoveryId !== existing?.id) continue;
    const recovery = existing ?? await tx.marketplaceTransferRecovery.create({ data: { fundingPlanId, hostMerchantId,
      beneficiaryMerchantId: binding.beneficiaryMerchantId, ...(first.payout ? { payoutId: target.id } : { residualOperationId: target.id }),
      provider: binding.provider, accountFingerprint: binding.accountFingerprint, providerTransferId: binding.providerTransferId,
      amountCents: binding.amountCents, evidence: evidence as unknown as Prisma.InputJsonValue, evidenceHash } });
    if (sellerDebt?.status === "outstanding") await tx.marketplaceSellerDebt.update({ where: { id: sellerDebt.id, status: "outstanding" },
      data: { status: "resolved", resolvedAt: new Date(), recoveryId: recovery.id } });
    if (hostDebt?.status === "outstanding") await tx.marketplaceHostDebt.update({ where: { payoutId: hostDebt.payoutId, status: "outstanding" },
      data: { status: "resolved", resolvedAt: new Date(), recoveryId: recovery.id } });
    const eventId = `marketplace_transfer_recovery_${recovery.id}`;
    await tx.outboxMessage.upsert({ where: { eventId }, update: {}, create: { eventId, eventType: "marketplace.transfer_recovery.confirmed", schemaVersion: 1,
      merchantId: hostMerchantId, occurredAt: recovery.createdAt, correlationId: fundingPlanId, causationId: target.id, producer: "marketplace",
      payload: { recovery_id: recovery.id, funding_plan_id: fundingPlanId, beneficiary_merchant_id: binding.beneficiaryMerchantId,
        target_kind: binding.kind, target_id: binding.id, amount_cents: binding.amountCents, evidence_hash: evidenceHash } } });
    created.push(recovery.id);
  }
  return created;
}
