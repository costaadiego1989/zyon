import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplacePayoutObservation, MarketplacePayoutRequest } from "../../domain/ports/marketplace-payout-provider.port.js";
import type { MarketplacePayoutOperation, MarketplacePayoutRepository } from "../../domain/ports/marketplace-payout-repository.port.js";
import { PrismaMarketplaceSellerDebtRepository } from "./prisma-marketplace-seller-debt.repository.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";

@Injectable()
export class PrismaMarketplacePayoutRepository implements MarketplacePayoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async lock(tx: Prisma.TransactionClient, id: string) {
    const initial = await tx.marketplacePayout.findFirst({ where: { OR: [{ id }, { settlementId: id }] }, include: { settlement: true, fundingPlan: true } });
    if (!initial) return null;
    const host = initial.fundingPlan?.hostMerchantId ?? initial.settlement?.hostMerchantId;
    if (!host) throw new ConflictException("marketplace_payout_owner_missing");
    await lockMarketplaceOrder(tx, host, initial.providerPaymentId);
    if (initial.settlementId) await tx.$queryRaw`SELECT id FROM marketplace_settlements WHERE id = ${initial.settlementId} FOR UPDATE`;
    return tx.marketplacePayout.findUniqueOrThrow({ where: { id: initial.id }, include: { settlement: true, fundingPlan: true } });
  }

  async claim(settlementId: string, now: Date) {
    return this.prisma.$transaction(async tx => {
      const payout = await this.lock(tx, settlementId);
      // No destination is guessed from today's merchant connection. A checkout
      // must persist its immutable funding/recipient plan before this can run.
      if (!payout) return undefined;
      const { settlement, fundingPlan: plan } = payout;
      const hostMerchantId = plan?.hostMerchantId ?? settlement!.hostMerchantId;
      const beneficiary = payout.beneficiaryMerchantId ?? settlement!.sellerMerchantId;
      if ((!plan && (payout.providerPaymentId !== settlement?.orderId || payout.amountCents !== settlement.sellerNetCents)) ||
          payout.currency !== "BRL" || !["stripe", "asaas"].includes(payout.provider)) {
        throw new ConflictException("marketplace_payout_binding_mismatch");
      }
      if (payout.status !== "planned") return { operation: this.map(payout), submit: false };
      if (payout.providerTransferId) throw new ConflictException("marketplace_payout_existing_receipt_requires_reconciliation");
      if (settlement && ["chargeback_cancelled", "return_cancelled", "chargeback_debt"].includes(settlement.status)) {
        const cancelled = await tx.marketplacePayout.update({ where: { id: payout.id }, data: { status: "cancelled", version: { increment: 1 } } });
        return { operation: this.map(cancelled, plan), submit: false };
      }
      if (settlement && (settlement.status !== "transfer_scheduled" || !settlement.transferScheduledAt || settlement.transferScheduledAt > now)) return undefined;
      if (plan) {
        if (plan.status !== "funded" || !payout.dueAt || payout.dueAt > now) return undefined;
        if (await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: plan.paymentIntentId } })) return undefined;
        await this.verifyBudget(tx, plan);
        if (!settlement && payout.kind !== "host_receivable") throw new ConflictException("marketplace_payout_kind_invalid");
        const blocked = await tx.marketplaceSettlement.count({ where: { hostMerchantId, orderId: payout.providerPaymentId,
          status: { in: ["return_cancelled", "chargeback_cancelled", "chargeback_debt"] } } });
        if (blocked) return undefined;
      } else if (await tx.marketplaceFundingPlan.count({ where: { hostMerchantId,
        OR: [{ providerPaymentId: payout.providerPaymentId }, { payment: { providerPaymentId: payout.providerPaymentId } }] } })) {
        throw new ConflictException("marketplace_payout_outside_funding_plan");
      }
      const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: {
        hostMerchantId, orderId: payout.providerPaymentId,
      } } });
      if (!ledger?.purchasedAt || ledger.chargebackAt) return undefined;
      const payment = await tx.paymentIntent.findUnique({ where: { merchantId_providerPaymentId: {
        merchantId: hostMerchantId, providerPaymentId: payout.providerPaymentId,
      } } });
      const creation = payment?.creation as { input?: { provider?: string; providerAccountFingerprint?: string } } | null;
      if (payment?.status !== "approved" || payment.approvedAmountCents !== payment.amountCents ||
          creation?.input?.provider !== payout.provider || creation.input.providerAccountFingerprint !== payout.accountFingerprint) return undefined;
      // Debt netting requires its own auditable allocation. Until present, hold
      // the whole payout instead of silently forgetting or over-deducting debt.
      if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: beneficiary, status: "outstanding" } }) ||
          await tx.marketplaceHostDebt.count({ where: { hostMerchantId: beneficiary, status: "outstanding" } }) ||
          await hasMarketplaceRecoveryExposure(tx, beneficiary)) return undefined;
      // An opened return already holds the money, before acceptance/refund.
      const paymentOrderIds = [payout.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])];
      const completed = await tx.completedOrder.findMany({ where: { merchantId: hostMerchantId, externalOrderId: { in: paymentOrderIds } }, select: { id: true } });
      if (await tx.return.count({ where: { merchantId: hostMerchantId,
        orderId: { in: [...paymentOrderIds, ...completed.map(row => row.id)] },
        status: { notIn: ["REJECTED", "CANCELLED"] } } })) return undefined;
      const claimed = await tx.marketplacePayout.update({ where: { id: payout.id, status: "planned" },
        data: { status: "unknown", claimedAt: now, version: { increment: 1 } } });
      return { operation: this.map(claimed, plan), submit: true };
    });
  }

  async releaseUnsubmittedClaim(operation: MarketplacePayoutOperation): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      if (!await this.lock(tx, operation.payoutId)) return false;
      // A stale owner or an independently observed receipt cannot grant retry.
      const result = await tx.marketplacePayout.updateMany({ where: { id: operation.payoutId,
        version: operation.version, status: "unknown", providerTransferId: null },
        data: { status: "planned", claimedAt: null, version: { increment: 1 } } });
      return result.count === 1;
    });
  }

  async record(operation: MarketplacePayoutOperation, observation: MarketplacePayoutObservation): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const current = await this.lock(tx, operation.payoutId);
      if (!current) throw new Error("marketplace_payout_settlement_missing");
      const settlement = current.settlement;
      if (current.version !== operation.version) return false;
      if (["confirmed", "failed", "cancelled"].includes(current.status)) return false;
      if ((observation.state === "confirmed" || observation.state === "failed") && !observation.providerTransferId) {
        throw new Error("marketplace_payout_receipt_required");
      }
      if (current.providerTransferId && observation.providerTransferId && current.providerTransferId !== observation.providerTransferId) {
        throw new ConflictException("marketplace_payout_receipt_changed");
      }
      await tx.marketplacePayout.update({ where: { id: operation.payoutId, version: operation.version },
        data: { status: observation.state, providerTransferId: observation.providerTransferId,
          reconciledAt: new Date(), version: { increment: 1 } } });
      if (observation.state !== "confirmed") return true;
      if (!settlement) {
        const plan = current.fundingPlan!;
        const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: {
          hostMerchantId: plan.hostMerchantId, orderId: current.providerPaymentId,
        } } });
        if (ledger?.chargebackAt) await tx.marketplaceHostDebt.upsert({ where: { payoutId: current.id },
          create: { payoutId: current.id, hostMerchantId: plan.hostMerchantId, amountCents: current.amountCents }, update: {} });
        return true;
      }
      const disputed = ["chargeback_cancelled", "chargeback_debt"].includes(settlement.status);
      if (!disputed && settlement.status !== "transfer_scheduled") throw new ConflictException("marketplace_payout_settlement_status_changed");
      await tx.marketplaceSettlement.update({ where: { id: settlement.id, status: settlement.status },
        data: { status: disputed ? "chargeback_debt" : "transferred", providerTransferId: observation.providerTransferId, transferredAt: new Date() } });
      if (disputed) await new PrismaMarketplaceSellerDebtRepository(tx as PrismaClient).create({
        settlementId: settlement.id, sellerMerchantId: settlement.sellerMerchantId, amountCents: current.amountCents,
      });
      return true;
    });
  }

  async listUnresolved(limit: number): Promise<string[]> {
    const rows = await this.prisma.marketplacePayout.findMany({ where: { status: { in: ["unknown", "pending"] } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, limit)), select: { id: true, settlementId: true } });
    return rows.map(row => row.settlementId ?? row.id);
  }

  async listDueHost(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.marketplacePayout.findMany({ where: { kind: "host_receivable", status: "planned", dueAt: { lte: now },
      OR: [{ fundingPlanId: null }, { fundingPlan: { is: { residualPlans: { none: {} } } } }] },
      orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, limit)), select: { id: true } });
    return rows.map(row => row.id);
  }

  private async verifyBudget(tx: Prisma.TransactionClient, plan: { paymentIntentId: string; instructions: Prisma.JsonValue;
    instructionsHash: string; budget: Prisma.JsonValue | null; payoutTotalCents: number | null; netAmountCents: number | null; platformRetainedCents: number | null }) {
    const instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
    const budget = plan.budget as unknown as FundingBudget;
    if (fundingHash(instructions) !== plan.instructionsHash || !budget ||
        fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget)) throw new ConflictException("marketplace_funding_budget_invalid");
    const expected = fundingTransferAllocations(instructions, budget);
    const rows = await tx.marketplacePayout.findMany({ where: { fundingPlanId: plan.paymentIntentId }, include: { settlement: true } });
    if (rows.length !== expected.length || new Set(rows.map(row => JSON.stringify([row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== rows.length ||
        rows.reduce((sum, row) => sum + row.amountCents, 0) !== budget.payoutTotalCents ||
        plan.payoutTotalCents !== budget.payoutTotalCents || plan.netAmountCents !== budget.capture.netAmountCents ||
        plan.platformRetainedCents !== budget.platformRetainedCents || rows.some(row => {
          const allocation = expected.find(e => e.lineItemId === (row.settlement?.lineItemId ?? null) && e.merchantId === row.beneficiaryMerchantId);
          return !allocation || allocation.kind !== row.kind || allocation.amountCents !== row.amountCents || row.currency !== "BRL" ||
            row.provider !== instructions.provider || row.accountFingerprint !== instructions.accountFingerprint ||
            row.providerPaymentId !== budget.capture.providerPaymentId ||
            row.destination !== instructions.destinations.find(d => d.merchantId === allocation.merchantId)?.destination;
        })) throw new ConflictException("marketplace_funding_reservation_mismatch");
  }

  private map(row: { id: string; settlementId: string | null; provider: string; accountFingerprint: string; providerPaymentId: string;
    destination: string; amountCents: number; currency: string; reference: string; status: string; version: number; providerTransferId: string | null;
    fundingPlan?: { budget: Prisma.JsonValue | null } | null }, plan = row.fundingPlan): MarketplacePayoutOperation {
    return { payoutId: row.id, settlementId: row.settlementId ?? undefined, version: row.version, state: row.status as MarketplacePayoutOperation["state"],
      providerTransferId: row.providerTransferId ?? undefined, request: {
        provider: row.provider as MarketplacePayoutRequest["provider"], accountFingerprint: row.accountFingerprint,
        providerPaymentId: row.providerPaymentId, destination: row.destination, amountCents: row.amountCents,
        currency: row.currency as "BRL", reference: row.reference,
        ...((plan?.budget as unknown as FundingBudget | undefined)?.capture ? { capture: (plan!.budget as unknown as FundingBudget).capture } : {}),
      } };
  }
}
