import type { Prisma } from "@prisma/client";
import { buildMarketplaceTransferRecoveryCreditEvidence, buildMarketplaceTransferRecoveryEvidence, type MarketplaceTransferRecoveryTarget } from "../domain/services/marketplace-transfer-recovery-evidence.js";
import { fundingHash } from "./repositories/prisma-marketplace-funding.repository.js";
import { readMarketplaceReversalRecoveryForExposure, buildMarketplaceTransferReversalRequest } from "./repositories/prisma-marketplace-transfer-reversal.repository.js";
import { readMarketplaceNativeRecoveryRequest, readMarketplaceResidualNativeRecoveryRequest, validateMarketplaceNativeRecoveryCredits } from "./repositories/prisma-marketplace-native-recovery.repository.js";
import { buildMarketplaceCumulativeRecoveryEvidence } from "../domain/services/marketplace-native-recovery-evidence.js";

/** Reconstructs certificates without changing debt, journals or provider state. */
export async function auditMarketplaceTransferRecoveries(tx: Prisma.TransactionClient, host: string, fundingPlanId: string) {
  const valid = new Map<string, string>(), validCredits = new Map<string, { targetId: string; amountCents: number }>(), findings: Array<{ code: string; reference: string }> = [];
  const certificates = await tx.marketplaceTransferRecovery.findMany({ where: { fundingPlanId },
    include: { payout: true, residualOperation: { include: { residualPlan: true } } } });
  const credits = await tx.marketplaceTransferRecoveryCredit.findMany({ where: { fundingPlanId },
    include: { payout: true, residualOperation: { include: { residualPlan: true } } } });
  for (const certificate of [...certificates.map(row => ({ ...row, reversalId: null, providerOperationId: null, isCredit: false })), ...credits.map(row => ({ ...row, isCredit: true }))]) {
    const isCredit = certificate.isCredit;
    try {
      const nativeVersion = (certificate.evidence as { version?: number })?.version;
      if (nativeVersion === 2 || nativeVersion === 3) {
        if (nativeVersion === 2 ? !certificate.payoutId || !!certificate.residualOperationId : !certificate.residualOperationId || !!certificate.payoutId) throw Error("native_target");
        const targetId = nativeVersion === 2 ? certificate.payoutId! : certificate.residualOperationId!;
        const request = nativeVersion === 2 ? await readMarketplaceNativeRecoveryRequest(tx, host, targetId) :
          await readMarketplaceResidualNativeRecoveryRequest(tx, host, targetId);
        const proven = await validateMarketplaceNativeRecoveryCredits(tx, request);
        if (isCredit) {
          if (!proven.some(row => row.id === certificate.id && row.evidenceHash === certificate.evidenceHash)) throw Error("native_credit");
          validCredits.set(certificate.id, { targetId, amountCents: certificate.amountCents });
        } else {
          const expected = buildMarketplaceCumulativeRecoveryEvidence(request, proven.map(row => ({ creditId: row.id, evidenceHash: row.evidenceHash,
            providerOperationId: row.providerOperationId, amountCents: row.amountCents })));
          if (!expected || certificate.hostMerchantId !== host || certificate.fundingPlanId !== fundingPlanId || certificate.provider !== "stripe" ||
            certificate.beneficiaryMerchantId !== request.target.beneficiaryMerchantId || certificate.providerTransferId !== request.target.providerTransferId ||
            certificate.accountFingerprint !== request.target.accountFingerprint || certificate.amountCents !== request.target.amountCents ||
            fundingHash(expected) !== certificate.evidenceHash || fundingHash(certificate.evidence) !== certificate.evidenceHash) throw Error("native_certificate");
          valid.set(certificate.id, targetId);
        }
        const event = await tx.outboxMessage.findFirst({ where: { eventId: `${isCredit ? "marketplace_transfer_recovery_credit" : "marketplace_transfer_recovery"}_${certificate.id}`,
          eventType: isCredit ? "marketplace.transfer_recovery_credit.confirmed" : "marketplace.transfer_recovery.confirmed", merchantId: host, producer: "marketplace", schemaVersion: 1 } });
        const payload = { ...(isCredit ? { recovery_credit_id: certificate.id, reversal_id: null, source: "provider_reconciliation" } : { recovery_id: certificate.id }),
          funding_plan_id: fundingPlanId, beneficiary_merchant_id: request.target.beneficiaryMerchantId, target_kind: request.target.kind, target_id: targetId,
          amount_cents: certificate.amountCents, evidence_hash: certificate.evidenceHash };
        if (!event || event.correlationId !== fundingPlanId || event.causationId !== (isCredit ? certificate.providerOperationId : targetId) ||
          fundingHash(event.payload) !== fundingHash(payload)) findings.push({ code: isCredit ? "transfer_recovery_credit_event_missing_or_inconsistent" : "transfer_recovery_event_missing_or_inconsistent", reference: certificate.id });
        continue;
      }
      const target = certificate.payout ?? certificate.residualOperation;
      if (certificate.hostMerchantId !== host || !target || Boolean(certificate.payoutId) === Boolean(certificate.residualOperationId) || target.status !== "confirmed" ||
          !target.claimedAt || !target.reconciledAt || !target.providerTransferId || target.provider !== "stripe" ||
          target.provider !== certificate.provider || target.accountFingerprint !== certificate.accountFingerprint ||
          target.providerTransferId !== certificate.providerTransferId || (isCredit ? certificate.amountCents <= 0 || certificate.amountCents > target.amountCents : target.amountCents !== certificate.amountCents) ||
          target.beneficiaryMerchantId !== certificate.beneficiaryMerchantId) throw Error("target");
      if (certificate.payout ? certificate.payout.fundingPlanId !== fundingPlanId :
          certificate.residualOperation!.residualPlan.fundingPlanId !== fundingPlanId || certificate.residualOperation!.residualPlan.status !== "held" ||
          certificate.residualOperation!.residualPlan.heldReason !== "marketplace_residual_dispute_requires_reconciliation") throw Error("funding");
      const reversals = await tx.marketplaceTransferReversal.findMany({
        where: isCredit ? { id: certificate.reversalId! } : certificate.payoutId ? { payoutId: certificate.payoutId } : { residualOperationId: certificate.residualOperationId },
        include: { refundPlan: { include: { operation: true } } },
      });
      if (!reversals.length || isCredit && (reversals.length !== 1 || reversals[0]!.providerOperationId !== certificate.providerOperationId ||
        reversals[0]!.amountCents !== certificate.amountCents || reversals[0]!.payoutId !== certificate.payoutId ||
        reversals[0]!.residualOperationId !== certificate.residualOperationId)) throw Error("reversals");
      if (isCredit) {
        const allReversals = await tx.marketplaceTransferReversal.aggregate({ where: { status: "confirmed",
          ...(certificate.payoutId ? { payoutId: certificate.payoutId } : { residualOperationId: certificate.residualOperationId }) }, _sum: { amountCents: true } });
        const credited = credits.filter(row => certificate.payoutId ? row.payoutId === certificate.payoutId : row.residualOperationId === certificate.residualOperationId);
        if ((allReversals._sum.amountCents ?? 0) > target.amountCents || credited.reduce((sum, row) => sum + row.amountCents, 0) > target.amountCents) throw Error("conservation");
      }
      let context: Awaited<ReturnType<typeof readMarketplaceReversalRecoveryForExposure>> | undefined;
      for (const reversal of reversals) {
        const proof = await readMarketplaceReversalRecoveryForExposure(tx, host, reversal.refundPlanId);
        const required = proof.required.find(row => row.payoutId === target.id);
        if (proof.funding.paymentIntentId !== fundingPlanId || proof.funding.status !== "held" || !proof.ledger.chargebackAt ||
            !required || reversal.hostMerchantId !== host || reversal.provider !== certificate.provider ||
            reversal.accountFingerprint !== certificate.accountFingerprint || reversal.amountCents !== required.amountCents) throw Error("request");
        const expected = buildMarketplaceTransferReversalRequest(proof, target.id, required.amountCents);
        if (reversal.requestHash !== expected.requestHash || fundingHash(reversal.request) !== fundingHash(expected)) throw Error("hash");
        context = proof;
      }
      const binding: MarketplaceTransferRecoveryTarget = { kind: certificate.payout ? "original" : "residual", id: target.id,
        beneficiaryMerchantId: certificate.beneficiaryMerchantId, provider: "stripe", accountFingerprint: target.accountFingerprint,
        providerPaymentId: context!.funding.providerPaymentId!, providerTransferId: target.providerTransferId,
        reference: target.reference, destination: certificate.payout?.destination ??
          (certificate.residualOperation!.request as unknown as { destination: string }).destination,
        amountCents: target.amountCents, ...(certificate.residualOperation ? { requestHash: certificate.residualOperation.requestHash } : {}) };
      const expected = (isCredit ? buildMarketplaceTransferRecoveryCreditEvidence : buildMarketplaceTransferRecoveryEvidence)({ fundingPlanId, hostMerchantId: host,
        instructionsHash: context!.funding.instructionsHash, budgetHash: fundingHash(context!.budget),
        chargebackAt: context!.ledger.chargebackAt!.toISOString(), target: binding, reversals: reversals.map(row => ({
          reversalId: row.id, refundPlanId: row.refundPlanId, requestHash: row.requestHash, providerOperationId: row.providerOperationId!,
          amountCents: row.amountCents, status: row.status, claimedAt: row.claimedAt, reconciledAt: row.reconciledAt,
          buyerStatus: row.refundPlan.status, buyerOperationStatus: row.refundPlan.operation?.status ?? null,
          buyerClaimedAt: row.refundPlan.operation?.claimedAt ?? null, buyerReceipt: row.refundPlan.operation?.providerOperationId ?? null,
        })) });
      if (!expected || certificate.evidenceHash !== fundingHash(expected) || fundingHash(certificate.evidence) !== certificate.evidenceHash) throw Error("evidence");
      if (isCredit) validCredits.set(certificate.id, { targetId: target.id, amountCents: certificate.amountCents });
      else valid.set(certificate.id, target.id);
      const event = await tx.outboxMessage.findFirst({ where: { eventId: `${isCredit ? "marketplace_transfer_recovery_credit" : "marketplace_transfer_recovery"}_${certificate.id}`,
        eventType: isCredit ? "marketplace.transfer_recovery_credit.confirmed" : "marketplace.transfer_recovery.confirmed", merchantId: host, producer: "marketplace", schemaVersion: 1 } });
      if (!event || event.correlationId !== fundingPlanId || event.causationId !== (isCredit ? certificate.reversalId : target.id) || fundingHash(event.payload) !== fundingHash({
        ...(isCredit ? { recovery_credit_id: certificate.id, reversal_id: certificate.reversalId } : { recovery_id: certificate.id }), funding_plan_id: fundingPlanId, beneficiary_merchant_id: binding.beneficiaryMerchantId,
        target_kind: binding.kind, target_id: target.id, amount_cents: certificate.amountCents, evidence_hash: certificate.evidenceHash,
      })) findings.push({ code: isCredit ? "transfer_recovery_credit_event_missing_or_inconsistent" : "transfer_recovery_event_missing_or_inconsistent", reference: certificate.id });
    } catch { findings.push({ code: isCredit ? "transfer_recovery_credit_evidence_invalid" : "transfer_recovery_evidence_invalid", reference: certificate.id }); }
  }
  return { valid, validCredits, findings };
}
