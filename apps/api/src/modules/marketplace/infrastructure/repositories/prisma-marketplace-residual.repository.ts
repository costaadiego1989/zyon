import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplaceResidualOperation, MarketplaceResidualRepository } from "../../domain/ports/marketplace-residual-repository.port.js";
import type { MarketplaceResidualObservation, MarketplaceResidualRequest } from "../../domain/ports/marketplace-residual-provider.port.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import type { MarketplaceResidualBasis } from "../../domain/services/marketplace-residual-allocation.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";
import { readMarketplaceResidualTransferHistory, buildMarketplaceResidualBasis, buildMarketplaceResidualHistoryAllocation,
  buildMarketplaceResidualRequest } from "./marketplace-residual-history.js";
import { readMarketplaceResidualContributionBasis } from "./marketplace-residual-contribution-basis.js";
import { readMarketplaceAsaasResidualProfileBasis, buildMarketplaceAsaasResidualOperationRequest,
  buildMarketplaceAsaasHostRetentionOperationRequest } from "./asaas-marketplace-residual-basis.js";
import type { AsaasMarketplaceResidualBasis, AsaasMarketplaceResidualAllocation } from "../../domain/services/asaas-marketplace-residual.js";
import type { AsaasMarketplaceHostRetentionBasis, AsaasMarketplaceHostRetentionAllocation,
  AsaasMarketplaceHostRetentionOutboundRequest } from "../../domain/ports/asaas-marketplace-host-retention.port.js";
import { buildAsaasMarketplaceHostRetentionRequest, validAsaasHostRetentionOutboundProof } from "../../domain/services/asaas-marketplace-host-retention.js";
import { prepareAsaasMarketplaceHostRetentionJournal } from "./prisma-asaas-marketplace-host-retention.repository.js";
import { readStripeMarketplaceSuccessiveResidualBasis } from "./stripe-marketplace-successive-residual-history.js";
import { buildStripeMarketplaceSuccessiveResidualRequest } from "../../domain/services/stripe-marketplace-successive-residual.js";
import { provisionStripeSuccessiveResidualGeneration } from "./prisma-stripe-marketplace-successive-residual-generation.repository.js";
import { asaasResidualSubmissionEventId } from "./prisma-asaas-marketplace-residual-authorization.repository.js";
import { validAsaasResidualTransferProof } from "../../domain/services/asaas-marketplace-residual.js";
import type { AsaasMarketplaceResidualRequest } from "../../domain/ports/asaas-marketplace-residual.port.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
function fail(reason: string): never { throw new ConflictException(reason); }

/** A separate generation spends only proven post-refund balances. */
@Injectable()
export class PrismaMarketplaceResidualRepository implements MarketplaceResidualRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async prepare(hostMerchantId: string, paymentIntentId: string) {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
      if (!initial?.providerPaymentId) return fail("marketplace_residual_order_missing");
      await lockMarketplaceOrder(tx, hostMerchantId, initial.providerPaymentId);
      const data = await this.order(tx, hostMerchantId, paymentIntentId);
      const existing = await tx.marketplaceResidualPlan.findFirst({ where: { fundingPlanId: paymentIntentId, basisHash: fundingHash(data.basis) }, include: { operations: true } });
      const basisHash = fundingHash(data.basis), allocationHash = fundingHash(data.allocation);
      if (existing) {
        if (existing.hostMerchantId !== hostMerchantId || existing.basisHash !== basisHash || existing.allocationHash !== allocationHash) {
          fail("marketplace_residual_generation_changed");
        }
        this.verifyOperations(existing, data);
        return existing;
      }
      const plan = await tx.marketplaceResidualPlan.create({ data: { fundingPlanId: paymentIntentId, hostMerchantId, generation: data.generation,
        basis: json(data.basis), basisHash, allocation: json(data.allocation), allocationHash,
        dueAt: data.dueAt, status: data.basis.version === 6 || data.basis.version === 7 || data.allocation.payoutTotalCents ? "prepared" : "completed" } });
      for (const beneficiary of this.operationAllocations(data)) {
        const request = this.request(data, beneficiary, basisHash);
        await tx.marketplaceResidualOperation.create({ data: { residualPlanId: plan.id,
          beneficiaryMerchantId: beneficiary.merchantId, sourceId: beneficiary.sourceId ?? "original",
          provider: data.plan.provider, accountFingerprint: data.plan.accountFingerprint,
          request: json(request), requestHash: request.requestHash, reference: request.reference, amountCents: request.amountCents } });
      }
      if (data.profile === "stripe_successive") await provisionStripeSuccessiveResidualGeneration(tx, plan);
      if (data.profile === "asaas_host_retention") await prepareAsaasMarketplaceHostRetentionJournal(tx, plan,
        buildAsaasMarketplaceHostRetentionRequest({basis: data.basis, allocation: data.allocation, capture: data.budget.capture}));
      // Original transfer identities and amounts remain historical evidence, held forever.
      await tx.marketplaceFundingPlan.update({ where: { paymentIntentId }, data: { status: "held" } });
      await tx.outboxMessage.create({ data: { eventId: `marketplace_residual_prepared_${plan.id}`, eventType: "marketplace.residual.prepared",
        schemaVersion: 1, merchantId: hostMerchantId, occurredAt: new Date(), correlationId: paymentIntentId,
        causationId: data.basis.refunds.at(-1)!.refundPlanId, producer: "marketplace", payload: {
          residual_plan_id: plan.id, payment_intent_id: paymentIntentId, order_id: data.plan.providerPaymentId,
          refunded_cents: data.allocation.refundedCents, payout_total_cents: data.allocation.payoutTotalCents,
          platform_retained_cents: data.allocation.platformRetainedCents, basis_hash: basisHash, allocation_hash: allocationHash } } });
      return tx.marketplaceResidualPlan.findUniqueOrThrow({ where: { id: plan.id }, include: { operations: true } });
    });
  }

  async claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, hostMerchantId, operationId);
      if (!row) return undefined;
      this.verifyOperation(row);
      if (row.status !== "planned") return { operation: this.map(row), submit: false };
      if (options?.reconcileOnly || row.residualPlan.status !== "prepared" || row.residualPlan.dueAt > now) return undefined;
      if (row.providerTransferId || row.claimedAt) fail("marketplace_residual_existing_receipt");
      const data = await this.order(tx, hostMerchantId, row.residualPlan.fundingPlanId);
      const plan = await tx.marketplaceResidualPlan.findUniqueOrThrow({ where: { id: row.residualPlanId }, include: { operations: true } });
      this.verifyOperations(plan, data);
      if (plan.generation !== data.generation || await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: row.beneficiaryMerchantId, status: "outstanding" } }) ||
          await tx.marketplaceHostDebt.count({ where: { hostMerchantId: row.beneficiaryMerchantId, status: "outstanding" } }) ||
          await hasMarketplaceRecoveryExposure(tx, row.beneficiaryMerchantId)) return undefined;
      const claimed = await tx.marketplaceResidualOperation.update({ where: { id: row.id, version: row.version, status: "planned" },
        data: { status: "unknown", claimedAt: now, version: { increment: 1 } } });
      return { operation: this.map({ ...claimed, residualPlan: row.residualPlan }), submit: true };
    });
  }

  async releaseUnsubmittedClaim(operation: MarketplaceResidualOperation) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, operation.hostMerchantId, operation.operationId);
      if (!row || row.version !== operation.version || row.status !== "unknown" || row.providerTransferId) return false;
      this.assertOwner(row, operation);
      if (operation.request.version === 6) return false;
      // A committed one-use permission may have reached the PSP before a crash.
      // The absence of a transfer ID cannot make that operation submit again.
      if (row.provider === "asaas" && await tx.outboxMessage.findUnique({
        where: { eventId: asaasResidualSubmissionEventId(row.id) }, select: { eventId: true },
      })) return false;
      await tx.marketplaceResidualOperation.update({ where: { id: row.id, version: row.version },
        data: { status: "planned", claimedAt: null, version: { increment: 1 } } });
      return true;
    });
  }

  async record(operation: MarketplaceResidualOperation, observation: MarketplaceResidualObservation) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, operation.hostMerchantId, operation.operationId);
      if (!row || row.version !== operation.version || !["unknown", "pending"].includes(row.status)) return false;
      this.assertOwner(row, operation);
      const terminal = observation.state === "confirmed" || observation.state === "failed";
      if (!["unknown", "pending", "confirmed", "failed"].includes(observation.state) ||
          (terminal && (!observation.providerTransferId || observation.amountCents !== row.amountCents || !observation.observedAt ||
            !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) < Date.now() - 300_000 ||
            Date.parse(observation.observedAt) > Date.now() + 60_000))) fail("marketplace_residual_evidence_invalid");
      if (row.providerTransferId && observation.providerTransferId && row.providerTransferId !== observation.providerTransferId) fail("marketplace_residual_receipt_changed");
      const request = row.request as unknown as MarketplaceResidualRequest;
      if (row.provider === "asaas" && request.version === 5 && observation.state === "confirmed" &&
          (!observation.asaasProof || observation.asaasProof.providerTransferId !== observation.providerTransferId ||
            observation.asaasProof.observedAt !== observation.observedAt ||
            !validAsaasResidualTransferProof(request as AsaasMarketplaceResidualRequest, observation.asaasProof, new Date()))) {
        fail("marketplace_asaas_residual_native_receipt_required");
      }
      if (row.provider === "asaas" && request.version === 7 && observation.state === "confirmed" &&
          (!observation.asaasProof || observation.asaasProof.providerTransferId !== observation.providerTransferId ||
            observation.asaasProof.observedAt !== observation.observedAt ||
            !validAsaasHostRetentionOutboundProof(request as AsaasMarketplaceHostRetentionOutboundRequest, observation.asaasProof, new Date()))) {
        fail("marketplace_asaas_residual_native_receipt_required");
      }
      await tx.marketplaceResidualOperation.update({ where: { id: row.id, version: row.version }, data: {
        status: observation.state, providerTransferId: observation.providerTransferId, reconciledAt: new Date(), version: { increment: 1 } } });
      if (!terminal) return true;
      let heldReason = row.residualPlan.heldReason;
      if (observation.reconciliationRequired) heldReason = heldReason ?? "marketplace_residual_provider_history_requires_reconciliation";
      if (observation.state === "failed") heldReason = "marketplace_residual_transfer_failed";
      // A receipt still matters if a return/dispute raced the already submitted transfer.
      try { await this.order(tx, operation.hostMerchantId, row.residualPlan.fundingPlanId); }
      catch { heldReason = heldReason ?? "marketplace_residual_financial_reconciliation_required"; }
      if (heldReason) await tx.marketplaceResidualPlan.update({ where: { id: row.residualPlanId }, data: { status: "held", heldReason } });
      else if (request.version !== 6 && request.version !== 7 &&
          await tx.marketplaceResidualOperation.count({ where: { residualPlanId: row.residualPlanId, status: { not: "confirmed" } } }) === 0) {
        await tx.marketplaceResidualPlan.update({ where: { id: row.residualPlanId }, data: { status: "completed" } });
      }
      await tx.outboxMessage.create({ data: { eventId: `marketplace_residual_${observation.state}_${row.id}`,
        eventType: `marketplace.residual.${observation.state}`, schemaVersion: 1, merchantId: operation.hostMerchantId,
        occurredAt: new Date(), correlationId: row.residualPlan.fundingPlanId, causationId: row.id, producer: "marketplace",
        payload: { residual_plan_id: row.residualPlanId, operation_id: row.id, payment_intent_id: row.residualPlan.fundingPlanId,
          beneficiary_merchant_id: row.beneficiaryMerchantId, amount_cents: row.amountCents,
          ...(request.version === 4 || request.version === 6 ? { source_id: row.sourceId } : {}),
          ...((request.version === 5 || request.version === 7) && observation.state === "confirmed" ? { asaas_proof: json(observation.asaasProof!) } : {}),
          provider_transfer_id: observation.providerTransferId, reconciliation_required: !!heldReason } } });
      return true;
    });
  }

  async listUnresolved(limit: number) {
    const rows = await this.prisma.marketplaceResidualOperation.findMany({ where: { status: { in: ["unknown", "pending"] } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, limit)),
      select: { id: true, residualPlan: { select: { hostMerchantId: true } } } });
    return rows.map(row => ({ operationId: row.id, hostMerchantId: row.residualPlan.hostMerchantId }));
  }

  async listDue(now: Date, limit: number) {
    const rows = await this.prisma.marketplaceResidualOperation.findMany({ where: { status: "planned",
      residualPlan: { status: "prepared", dueAt: { lte: now } } }, orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: Math.min(100, Math.max(1, limit)), select: { id: true, residualPlan: { select: { hostMerchantId: true } } } });
    return rows.map(row => ({ operationId: row.id, hostMerchantId: row.residualPlan.hostMerchantId }));
  }

  async deferPlanned(hostMerchantId: string, operationId: string): Promise<void> {
    await this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, hostMerchantId, operationId);
      if (!row || row.status !== "planned") return;
      await tx.marketplaceResidualOperation.updateMany({ where: { id: operationId, version: row.version, status: "planned" },
        data: { version: { increment: 1 } } });
    });
  }

  private async lock(tx: Prisma.TransactionClient, hostMerchantId: string, operationId: string) {
    const initial = await tx.marketplaceResidualOperation.findFirst({ where: { id: operationId, residualPlan: { hostMerchantId } },
      include: { residualPlan: { include: { fundingPlan: true } } } });
    if (!initial?.residualPlan.fundingPlan.providerPaymentId) return null;
    // Journals are deliberately not tenant-filtered by Prisma middleware. Read
    // the protected payment before returning any replay or admitting a receipt.
    if (!await tx.paymentIntent.findFirst({ where: { id: initial.residualPlan.fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) return null;
    await lockMarketplaceOrder(tx, hostMerchantId, initial.residualPlan.fundingPlan.providerPaymentId);
    return tx.marketplaceResidualOperation.findFirst({ where: { id: operationId, residualPlan: { hostMerchantId } }, include: { residualPlan: true } });
  }

  private async order(tx: Prisma.TransactionClient, hostMerchantId: string, paymentIntentId: string) {
    const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
    if (plan?.provider === "asaas") {
      const data = await readMarketplaceAsaasResidualProfileBasis(tx, hostMerchantId, paymentIntentId);
      return data.basis.version === 7 ? {...data, basis: data.basis as AsaasMarketplaceHostRetentionBasis,
        allocation: data.allocation as AsaasMarketplaceHostRetentionAllocation, profile: "asaas_host_retention" as const} :
        {...data, basis: data.basis as AsaasMarketplaceResidualBasis,
          allocation: data.allocation as AsaasMarketplaceResidualAllocation, profile: "asaas" as const};
    }
    if (plan?.provider === "stripe") {
      const initial = await tx.marketplaceResidualPlan.findFirst({where: {fundingPlanId: paymentIntentId, generation: 1}});
      if (initial && (initial.basis as {version?: number}).version === 4) {
        const confirmed = await tx.marketplaceRefundPlan.findMany({where: {fundingPlanId: paymentIntentId, status: "confirmed"}, include: {operation: true}});
        if (confirmed.some(r => !!(r.operation?.request as {stripeSourceFunding?: unknown} | undefined)?.stripeSourceFunding)) {
          return readStripeMarketplaceSuccessiveResidualBasis(tx, hostMerchantId, paymentIntentId);
        }
      }
    }
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
    if (!plan?.budget || !plan.providerPaymentId || plan.provider !== "stripe" || plan.status !== "held" || !payment ||
        !["approved", "refunded"].includes(payment.status) || payment.amountCents !== plan.amountCents || payment.approvedAmountCents !== plan.amountCents ||
        payment.providerPaymentId !== plan.providerPaymentId || payment.currency !== "BRL") fail("marketplace_residual_payment_unavailable");
    const instructions = plan.instructions as unknown as FrozenMarketplaceFunding, budget = plan.budget as unknown as FundingBudget;
    const frozen = (payment.creation as unknown as { input?: { marketplaceFunding?: unknown } })?.input?.marketplaceFunding;
    if (fundingHash(instructions) !== plan.instructionsHash || fundingHash(frozen) !== plan.instructionsHash ||
        instructions.hostMerchantId !== hostMerchantId || instructions.provider !== plan.provider || instructions.environment !== plan.environment ||
        instructions.accountFingerprint !== plan.accountFingerprint || instructions.amountCents !== plan.amountCents ||
        fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
        budget.capture.providerPaymentId !== plan.providerPaymentId || budget.capture.accountFingerprint !== plan.accountFingerprint ||
        plan.providerFeeCents !== budget.capture.providerFeeCents || plan.netAmountCents !== budget.capture.netAmountCents ||
        plan.platformRetainedCents !== budget.platformRetainedCents || plan.payoutTotalCents !== budget.payoutTotalCents) fail("marketplace_residual_budget_invalid");
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: plan.providerPaymentId } } });
    if (!ledger?.purchasedAt || ledger.chargebackAt) fail("marketplace_residual_dispute_unreconciled");
    const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: paymentIntentId }, include: { settlement: true } });
    const expected = fundingTransferAllocations(instructions, budget);
    if (!payouts.length || payouts.length !== expected.length || new Set(payouts.map(row => JSON.stringify([
      row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== payouts.length || payouts.some(row => {
      const allocation = expected.find(e => e.lineItemId === (row.settlement?.lineItemId ?? null) && e.merchantId === row.beneficiaryMerchantId);
      const unsubmitted = row.status === "planned" && !row.providerTransferId && !row.claimedAt;
      const confirmed = row.status === "confirmed" && !!row.providerTransferId?.startsWith("tr_") && !!row.claimedAt && !!row.reconciledAt &&
        (!row.settlement || ["transferred", "finalized"].includes(row.settlement.status) && row.settlement.providerTransferId === row.providerTransferId);
      return !allocation || !(unsubmitted || confirmed) || !row.dueAt ||
        row.kind !== allocation.kind || row.amountCents !== allocation.amountCents || row.currency !== "BRL" ||
        row.provider !== plan.provider || row.providerPaymentId !== plan.providerPaymentId || row.accountFingerprint !== plan.accountFingerprint ||
        row.destination !== instructions.destinations.find(d => d.merchantId === allocation.merchantId)?.destination ||
        (row.settlement && ["chargeback_cancelled", "chargeback_debt"].includes(row.settlement.status));
    })) fail("marketplace_residual_original_payout_unavailable");
    const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: paymentIntentId }, include: { operation: true },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    if (!refunds.length || refunds.some(row => row.hostMerchantId !== hostMerchantId || row.status !== "confirmed" ||
        row.operation?.status !== "confirmed" || !row.operation.providerOperationId || !row.operation.reconciledAt ||
        row.operation.provider !== plan.provider || row.operation.accountFingerprint !== plan.accountFingerprint ||
        fundingHash(row.allocation) !== row.allocationHash)) fail("marketplace_residual_refund_unconfirmed");
    // Cumulative captured money defines generation order. Imported dates or an
    // equal timestamp must never reorder immutable provider-history prefixes.
    refunds.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
      (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents || a.id.localeCompare(b.id));
    for (const [index, refund] of refunds.entries()) {
      const request = refund.operation!.request as Record<string, unknown>;
      const { requestHash, ...raw } = request;
      if (requestHash !== refund.operation!.requestHash || fundingHash(raw) !== requestHash || request.kind !== "refund" ||
          request.providerPaymentId !== plan.providerPaymentId || request.sourceId !== budget.capture.sourceId || request.amountCents !== refund.amountCents ||
          request.accountFingerprint !== plan.accountFingerprint || request.environment !== plan.environment || request.currency !== "BRL" ||
          request.paymentAmountCents !== plan.amountCents || request.reference !== refund.operation!.reference || request.provider !== plan.provider ||
          fundingHash(request.previousRefunds) !== fundingHash(refunds.slice(0, index).map(row => ({
            providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents })))) fail("marketplace_residual_refund_identity_invalid");
    }
    const completed = await tx.completedOrder.findMany({ where: { merchantId: hostMerchantId,
      externalOrderId: { in: [plan.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])] } }, select: { id: true } });
    const orderIds = [plan.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : []), ...completed.map(row => row.id)];
    const returns = await tx.return.findMany({ where: { merchantId: hostMerchantId, orderId: { in: orderIds } }, include: { refund: true, items: true } });
    if (returns.some(row => !["REJECTED", "CANCELLED"].includes(row.status) && !refunds.some(refund => refund.returnId === row.id)) ||
        returns.some(row => row.refund && !refunds.some(refund => refund.returnId === row.id))) fail("marketplace_residual_open_return");
    for (const refund of refunds) {
      const returned = returns.find(row => row.id === refund.returnId), allocation = refund.allocation as unknown as MarketplaceRefundAllocation;
      if (!returned || returned.status !== "REFUND_COMPLETED" || returned.refund?.status !== "COMPLETED" ||
          returned.refund.paymentIntentId !== paymentIntentId || returned.refund.amountInCents !== refund.amountCents ||
          returned.refund.providerRefundId !== refund.operation!.providerOperationId || allocation.amountCents !== refund.amountCents ||
          fundingHash(returned.items.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
          fundingHash(allocation.lines.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) {
        fail("marketplace_residual_return_receipt_changed");
      }
    }
    const generations = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: paymentIntentId }, include: { operations: true }, orderBy: { generation: "asc" } });
    const current = generations.filter(row => (row.basis as unknown as MarketplaceResidualBasis).refunds.length === refunds.length);
    const priorGenerations = generations.filter(row => (row.basis as unknown as MarketplaceResidualBasis).refunds.length < refunds.length);
    if (generations.length !== priorGenerations.length + current.length || current.length > 1 ||
        current.some(row => row.generation !== priorGenerations.length + 1)) fail("marketplace_residual_generation_changed");
    const contribution = await readMarketplaceResidualContributionBasis(tx, { funding: plan, instructions, budget, refunds });
    const history = await readMarketplaceResidualTransferHistory(tx, { funding: plan, instructions, budget, payouts, refunds, priorGenerations,
      contributionBasis: contribution?.basis, contributions: contribution?.funding });
    const basis = buildMarketplaceResidualBasis(plan, budget, refunds, history.transfers, history.previousGenerations, contribution?.funding);
    const allocation = buildMarketplaceResidualHistoryAllocation(budget, refunds, basis, contribution?.basis);
    if (basis.version !== 1) for (const beneficiary of budget.beneficiaries) {
      if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
          await tx.marketplaceHostDebt.count({ where: { hostMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
          await hasMarketplaceRecoveryExposure(tx, beneficiary.merchantId)) fail("marketplace_residual_beneficiary_exposure_unreconciled");
    }
    if (payment.status === "refunded" && (basis.version === 1 || allocation.refundedCents !== payment.amountCents ||
        allocation.payoutTotalCents !== 0 || allocation.platformRetainedCents !== 0 || allocation.version === 1 ||
        allocation.version !== 4 && allocation.alreadyTransferredCents !== 0)) {
      fail("marketplace_residual_payment_unavailable");
    }
    return { plan, instructions, budget, basis, allocation, profile: "stripe" as const,
      generation: priorGenerations.length + 1, dueAt: new Date(Math.max(...payouts.map(row => row.dueAt!.getTime()))) };
  }

  private request(data: Awaited<ReturnType<PrismaMarketplaceResidualRepository["order"]>>,
    beneficiary: { merchantId: string; destination: string; amountCents: number; sourceId?: string }, basisHash: string): MarketplaceResidualRequest {
    if (data.profile === "asaas") return buildMarketplaceAsaasResidualOperationRequest(data, beneficiary, basisHash);
    if (data.profile === "asaas_host_retention") return buildMarketplaceAsaasHostRetentionOperationRequest(data, beneficiary, basisHash);
    if (data.profile === "stripe_successive") return buildStripeMarketplaceSuccessiveResidualRequest(data.basis, beneficiary.sourceId!, beneficiary.merchantId);
    return buildMarketplaceResidualRequest(data, beneficiary, basisHash);
  }

  private verifyOperations(plan: { basis: unknown; basisHash: string; allocation: unknown; allocationHash: string; dueAt: Date;
    operations: Array<{ beneficiaryMerchantId: string; sourceId: string; request: unknown; requestHash: string; amountCents: number; reference: string; provider: string; accountFingerprint: string }> },
    data: Awaited<ReturnType<PrismaMarketplaceResidualRepository["order"]>>) {
    if (fundingHash(plan.basis) !== plan.basisHash || fundingHash(data.basis) !== plan.basisHash ||
        fundingHash(plan.allocation) !== plan.allocationHash || fundingHash(data.allocation) !== plan.allocationHash ||
        plan.dueAt.getTime() !== data.dueAt.getTime()) fail("marketplace_residual_generation_changed");
    const expected = this.operationAllocations(data);
    if (plan.operations.length !== expected.length || new Set(plan.operations.map(row => JSON.stringify([row.beneficiaryMerchantId, row.sourceId]))).size !== expected.length ||
        plan.operations.some(row => {
          this.verifyOperation(row);
          const beneficiary = expected.find(b => b.merchantId === row.beneficiaryMerchantId && (b.sourceId ?? "original") === row.sourceId);
          return !beneficiary || fundingHash(this.request(data, beneficiary, plan.basisHash)) !== fundingHash(row.request);
        })) fail("marketplace_residual_operation_missing");
  }
  private operationAllocations(data: Awaited<ReturnType<PrismaMarketplaceResidualRepository["order"]>>) {
    const allocation = data.allocation;
    return allocation.version === 4 || allocation.version === 6 ? allocation.sources.flatMap(source => source.beneficiaries
      .filter(row => row.amountCents > 0).map(row => ({ ...row, sourceId: source.sourceId }))) :
      allocation.beneficiaries.filter(row => row.amountCents > 0 && (data.profile !== "asaas_host_retention" ||
        row.destination !== data.basis.asaasFunding.host.walletId)).map(row => ({ ...row, sourceId: undefined }));
  }
  private verifyOperation(row: { request: unknown; requestHash: string; amountCents: number; reference: string; provider: string; accountFingerprint: string; sourceId?: string }) {
    const request = row.request as MarketplaceResidualRequest, { requestHash, ...raw } = request;
    if (requestHash !== row.requestHash || fundingHash(raw) !== requestHash || request.amountCents !== row.amountCents ||
        request.provider !== row.provider || request.accountFingerprint !== row.accountFingerprint || request.reference !== row.reference ||
        (request.sourceId ?? "original") !== (row.sourceId ?? "original")) fail("marketplace_residual_operation_changed");
  }
  private assertOwner(row: Parameters<PrismaMarketplaceResidualRepository["verifyOperation"]>[0] & { residualPlanId: string }, operation: MarketplaceResidualOperation) {
    this.verifyOperation(row);
    if (row.residualPlanId !== operation.residualPlanId || fundingHash(row.request) !== fundingHash(operation.request)) fail("marketplace_residual_claim_changed");
  }
  private map(row: { id: string; residualPlanId: string; residualPlan: { hostMerchantId: string }; version: number; status: string; request: unknown; providerTransferId: string | null }): MarketplaceResidualOperation {
    return { operationId: row.id, residualPlanId: row.residualPlanId, hostMerchantId: row.residualPlan.hostMerchantId,
      version: row.version, state: row.status as MarketplaceResidualOperation["state"], request: row.request as MarketplaceResidualRequest,
      providerTransferId: row.providerTransferId ?? undefined };
  }
}
