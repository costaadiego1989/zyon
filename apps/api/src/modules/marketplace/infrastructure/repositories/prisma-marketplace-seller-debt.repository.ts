import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  MarketplaceSellerDebtRepository,
  MarketplaceSellerDebtSnapshot,
  CreateSellerDebtInput,
  DeductDebtInput,
  SellerDebtStatus,
} from "../../domain/ports/marketplace-seller-debt-repository.port.js";
import { recordMarketplaceReversalRecoveryEvidence } from "./prisma-marketplace-transfer-reversal.repository.js";
import { fundingHash } from "./prisma-marketplace-funding.repository.js";
import { marketplaceDebtPrincipalExtinctionId } from "../../domain/services/marketplace-debt-principal-extinction.js";
import { rebuildMarketplaceDebtPrincipalExtinction,
  type MarketplaceDebtPrincipalExtinctionCertificateEvidence } from "../../domain/services/marketplace-debt-principal-extinction-positive-fee.js";
import type { MarketplaceDisputeClosureProof, MarketplaceDisputeClosureRequest } from "../../domain/ports/marketplace-dispute-closure.port.js";

@Injectable()
export class PrismaMarketplaceSellerDebtRepository
  implements MarketplaceSellerDebtRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateSellerDebtInput,
  ): Promise<MarketplaceSellerDebtSnapshot> {
    const debt = await this.prisma.marketplaceSellerDebt.upsert({
      where: { settlementId: input.settlementId },
      update: {},
      create: {
        sellerMerchantId: input.sellerMerchantId,
        settlementId: input.settlementId,
        amountCents: input.amountCents,
        status: "outstanding",
      },
    });
    if (debt.sellerMerchantId !== input.sellerMerchantId || debt.amountCents !== input.amountCents) {
      throw new Error("marketplace_debt_replay_mismatch");
    }
    return this.toSnapshot(debt);
  }

  async getById(
    debtId: string,
  ): Promise<MarketplaceSellerDebtSnapshot | undefined> {
    const debt = await this.prisma.marketplaceSellerDebt.findUnique({
      where: { id: debtId },
    });
    if (!debt) return undefined;
    return this.toSnapshot(debt);
  }

  async findBySellerMerchantId(
    sellerMerchantId: string,
    status?: SellerDebtStatus,
  ): Promise<MarketplaceSellerDebtSnapshot[]> {
    const debts = await this.prisma.marketplaceSellerDebt.findMany({
      where: {
        sellerMerchantId,
        ...(status && { status }),
      },
      orderBy: { createdAt: "desc" },
    });
    return Promise.all(debts.map((d: any) => this.toSnapshot(d)));
  }

  async findOutstandingBySellerMerchantId(
    sellerMerchantId: string,
  ): Promise<MarketplaceSellerDebtSnapshot[]> {
    return this.findBySellerMerchantId(sellerMerchantId, "outstanding");
  }

  async deductDebt(input: DeductDebtInput): Promise<MarketplaceSellerDebtSnapshot> {
    // No append-only netting ledger exists. A settlement identifier alone does
    // not prove that any principal was actually withheld and applied.
    throw new ConflictException("marketplace_debt_netting_evidence_required");
  }

  async resolveDebt(debtId: string): Promise<MarketplaceSellerDebtSnapshot> {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.marketplaceSellerDebt.findUnique({ where: { id: debtId } });
      const payout = initial && await tx.marketplacePayout.findUnique({ where: { settlementId: initial.settlementId }, include: { fundingPlan: true } });
      if (!initial || !payout?.fundingPlan || !payout.fundingPlanId || !await tx.paymentIntent.findFirst({
        where: { id: payout.fundingPlanId, merchantId: payout.fundingPlan.hostMerchantId }, select: { id: true } })) {
        throw new ConflictException("marketplace_debt_recovery_evidence_required");
      }
      // An existing extinction is a native principal disposition, never a
      // fabricated transfer recovery. Reading it cannot release a funding hold.
      if (initial.status === "extinguished") return this.toSnapshot(initial,tx);
      await recordMarketplaceReversalRecoveryEvidence(tx, payout.fundingPlan.hostMerchantId, payout.fundingPlanId);
      const debt = await tx.marketplaceSellerDebt.findUniqueOrThrow({ where: { id: debtId } });
      if (debt.status !== "resolved" || !debt.recoveryId) throw new ConflictException("marketplace_debt_recovery_evidence_required");
      return this.toSnapshot(debt, tx);
    });
  }

  private async toSnapshot(debt: any, tx: Prisma.TransactionClient = this.prisma): Promise<MarketplaceSellerDebtSnapshot & {extinguishedAmountCents:number}> {
    const payout = await tx.marketplacePayout.findUnique({ where: { settlementId: debt.settlementId },
      include: { recovery: true, recoveryCredits: true } });
    // Identity mismatches never reduce a debt. The immutable principal is still reported.
    const matches = payout && payout.kind === "seller_settlement" && payout.beneficiaryMerchantId === debt.sellerMerchantId && payout.amountCents === debt.amountCents;
    const recoveredAmountCents = matches ? Math.min(debt.amountCents, payout.recovery?.amountCents ??
      payout.recoveryCredits.filter(row => row.beneficiaryMerchantId === debt.sellerMerchantId && row.fundingPlanId === payout.fundingPlanId &&
        row.providerTransferId === payout.providerTransferId && row.accountFingerprint === payout.accountFingerprint).reduce((sum, row) => sum + row.amountCents, 0)) : 0;
    let extinguishedAmountCents = 0;
    if (debt.status === "extinguished") {
      if (!matches || recoveredAmountCents || debt.recoveryId || !payout.fundingPlanId) throw new ConflictException("marketplace_debt_principal_extinction_unproven");
      const rows = await tx.$queryRaw<Array<{id:string;evidence:unknown;evidence_hash:string;observation:MarketplaceDisputeClosureProof;
        snapshot_id:string;request:MarketplaceDisputeClosureRequest;proof_hash:string}>>`SELECT c.id,c.evidence,c.evidence_hash,c.observation,
          s.id AS snapshot_id,s.request,s.proof_hash FROM marketplace_debt_principal_extinctions c
          JOIN marketplace_dispute_closure_snapshots s ON s.id=c.closure_snapshot_id WHERE c.debt_id=${debt.id}`;
      const [certificate] = rows;
      const settlement = await tx.marketplaceSettlement.findUnique({where:{id:debt.settlementId}});
      const ledger = certificate && await tx.marketplaceOrderLedger.findUnique({where:{hostMerchantId_orderId:{
        hostMerchantId:certificate.request.hostMerchantId,orderId:certificate.request.providerPaymentId}}});
      if (rows.length !== 1 || !certificate || !settlement || !ledger?.chargebackAt) throw new ConflictException("marketplace_debt_principal_extinction_unproven");
      let expected: MarketplaceDebtPrincipalExtinctionCertificateEvidence;
      try { expected = rebuildMarketplaceDebtPrincipalExtinction({request:certificate.request,proof:certificate.observation,
        closureSnapshotId:certificate.snapshot_id,chargebackAt:ledger.chargebackAt,beneficiaryAmountCents:payout.amountCents,
        debt,payout,settlement,replay:true},(certificate.evidence as {version?:unknown})?.version,new Date(certificate.observation.observedAt)); } catch { throw new ConflictException("marketplace_debt_principal_extinction_unproven"); }
      if (certificate.proof_hash !== expected.proofHash || certificate.id !== marketplaceDebtPrincipalExtinctionId(expected) ||
          certificate.evidence_hash !== fundingHash(expected) || fundingHash(certificate.evidence) !== certificate.evidence_hash) throw new ConflictException("marketplace_debt_principal_extinction_unproven");
      extinguishedAmountCents = expected.amountCents;
    }
    return {
      id: debt.id,
      sellerMerchantId: debt.sellerMerchantId,
      settlementId: debt.settlementId,
      amountCents: debt.amountCents,
      recoveredAmountCents,
      extinguishedAmountCents,
      outstandingAmountCents: debt.amountCents - recoveredAmountCents - extinguishedAmountCents,
      status: debt.status as SellerDebtStatus,
      deductedFromSettlementId: debt.deductedFromSettlementId,
      createdAt: debt.createdAt,
      resolvedAt: debt.resolvedAt,
    };
  }
}
