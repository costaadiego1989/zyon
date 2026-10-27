import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplaceRefundObservation, MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceRefundOperation, MarketplaceRefundRepository } from "../../domain/ports/marketplace-refund-repository.port.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { buildMarketplaceRefundAllocation, marketplaceReturnShipping, type MarketplaceRefundAllocation, type MarketplaceRefundComponents,
  type MarketplaceRefundLineIdentity } from "../../domain/services/marketplace-refund-allocation.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { inventorySaleFingerprint, validateInventorySale } from "../../../inventory/domain/events/inventory-sale.validation.js";
import type { SaleCompletedEvent } from "../../../inventory/domain/events/sale-completed.event.js";
import { assertMarketplaceReversalsRecovered } from "./prisma-marketplace-transfer-reversal.repository.js";
import { recordMarketplaceShipmentInterruption } from "./marketplace-shipment-interruption.js";
import { readMarketplaceResidualTransferHistory } from "./marketplace-residual-history.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";
import { marketplaceRefundPreparationHash } from "../../domain/services/marketplace-refund-preparation-hash.js";
import { readMarketplaceRefundFunding, assertMarketplaceRefundFunding } from "./marketplace-refund-funding.js";
import { readCertifiedAsaasMarketplaceWalletReturns } from "./prisma-asaas-marketplace-wallet-return.repository.js";
import { allocateMarketplaceTransferReversals } from "../../domain/services/marketplace-transfer-reversal-allocation.js";
import { readConfirmedAsaasMarketplaceRefundHistory } from "./asaas-marketplace-refund-history.js";
import { selectAsaasMarketplaceReturnedFunds } from "../../domain/services/asaas-marketplace-returned-funds.js";
import { readStripeMarketplaceSourceRefundContext } from "./stripe-marketplace-source-refund-history.js";
import { readAsaasMarketplaceCompletedResidualGenerationHistory, assertAsaasMarketplacePostResidualReturnedFunds }
  from "./prisma-asaas-marketplace-residual-wallet-return.repository.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
function fail(reason: string): never { throw new ConflictException(reason); }
const returnRefundId = (planId: string) => `mrefund_return_${fundingHash(planId)}`;
export interface PrepareMarketplaceRefundInput {
  hostMerchantId: string;
  paymentIntentId: string;
  returnId: string;
  components: MarketplaceRefundComponents;
  expectedPreparationHash?: string;
}

/** Internal only: never repurposes the immutable original payout instructions. */
@Injectable()
export class PrismaMarketplaceRefundRepository implements MarketplaceRefundRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Preparing a provider command spends nothing. Keep the original allocation
   * and every seller's fee ownership intact, alongside the new net-credit plan. */
  async activateFundedRefund(hostMerchantId: string, refundPlanId: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const refund = await this.lock(tx, hostMerchantId, refundPlanId);
      if (!refund || refund.blockReason !== "marketplace_refund_seller_contribution_required") return false;
      const order = await this.order(tx, hostMerchantId, refund.fundingPlanId);
      if (order.plan.provider !== "stripe") return false;
      await this.assertUnsubmittedContributionOrder(tx, order);
      const current = await readMarketplaceRefundFunding(tx, hostMerchantId, order.plan, order.instructions, order.budget, refund.id);
      if (!current.plan.fullyFunded) return false;
      if (refund.operation) {
        this.verifyOperation(refund);
        assertMarketplaceRefundFunding(refund.operation.request as unknown as MarketplaceRefundRequest, current);
        return !["blocked", "failed"].includes(refund.status);
      }
      if (refund.status !== "blocked") fail("marketplace_refund_contribution_state_changed");
      const request = await this.activationRequest(tx, refund, order);
      request.fundingContributions = { planHash: current.plan.planHash, contributedNetCents: current.plan.contributedNetCents,
        certificates: current.certificates };
      const { requestHash: _, ...raw } = request;
      request.requestHash = fundingHash(raw);
      await this.activate(tx, refund, request);
      return true;
    });
  }

  /** Wallet return credits are separate transfers. Extra returned principal
   * remains held; this never resolves a seller debt or authorizes a new payout. */
  async activateReturnedFundsRefund(hostMerchantId: string, refundPlanId: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const refund = await this.lock(tx, hostMerchantId, refundPlanId);
      if (!refund || refund.blockReason !== "marketplace_refund_asaas_transfer_recovery_unavailable") return false;
      const order = await this.order(tx, hostMerchantId, refund.fundingPlanId);
      if (order.plan.provider !== "asaas") return false;
      const returnedFunds = await this.returnedFunds(tx, refund, order);
      if (!returnedFunds) return false;
      if (refund.operation) {
        this.verifyOperation(refund);
        const existing = refund.operation.request as unknown as MarketplaceRefundRequest;
        if (returnedFunds.kind === "residual" ? existing.asaasWalletReturns !== undefined ||
            fundingHash(existing.asaasResidualWalletReturns) !== fundingHash(returnedFunds.credits) :
            existing.asaasResidualWalletReturns !== undefined || fundingHash(existing.asaasWalletReturns) !== fundingHash(returnedFunds.credits)) {
          fail("marketplace_refund_wallet_return_changed");
        }
        return !["blocked", "failed"].includes(refund.status);
      }
      if (refund.status !== "blocked") fail("marketplace_refund_wallet_return_state_changed");
      const request = await this.activationRequest(tx, refund, order);
      this.attachReturnedFunds(request, returnedFunds);
      const { requestHash: _, ...raw } = request;
      request.requestHash = fundingHash(raw);
      await this.activate(tx, refund, request);
      return true;
    });
  }

  private async activate(tx: Prisma.TransactionClient, refund: { id: string; fundingPlanId: string; hostMerchantId: string }, request: MarketplaceRefundRequest) {
    await tx.marketplaceRefundOperation.create({ data: { refundPlanId: refund.id, provider: request.provider,
      accountFingerprint: request.accountFingerprint, request: json(request), requestHash: request.requestHash, reference: request.reference } });
    await tx.marketplaceRefundPlan.update({ where: { id: refund.id }, data: { status: "prepared" } });
    await tx.outboxMessage.create({ data: { eventId: `marketplace_refund_funding_ready_${refund.id}`,
      eventType: "marketplace.refund.funding_ready", schemaVersion: 1, merchantId: refund.hostMerchantId,
      occurredAt: new Date(), correlationId: refund.fundingPlanId, causationId: refund.id, producer: "marketplace",
      payload: { refund_plan_id: refund.id, payment_intent_id: refund.fundingPlanId,
        funding_kind: request.fundingContributions ? "seller_fee_contribution" : "authorized_wallet_return",
        request_hash: request.requestHash } } });
  }

  private async activationRequest(tx: Prisma.TransactionClient,
    refund: { id: string; fundingPlanId: string; hostMerchantId: string; returnId: string; amountCents: number; allocation: unknown },
    order: Awaited<ReturnType<PrismaMarketplaceRefundRepository["order"]>>): Promise<MarketplaceRefundRequest> {
    const returned = await tx.return.findFirst({ where: { id: refund.returnId, merchantId: refund.hostMerchantId }, include: { refund: true, items: true } });
    const allocation = refund.allocation as MarketplaceRefundAllocation;
    if (!returned || returned.status !== "INSPECTED_PASS" || returned.refund ||
        fundingHash(returned.items.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
        fundingHash(allocation.lines.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) {
      fail("marketplace_refund_return_changed");
    }
    const prior = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: refund.fundingPlanId, id: { not: refund.id } }, include: { operation: true } });
    prior.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
      (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents);
    if (prior.some(row => row.status !== "confirmed" || row.operation?.status !== "confirmed" || !row.operation.providerOperationId)) fail("marketplace_refund_previous_unresolved");
    const raw = { kind: "refund" as const, provider: order.plan.provider as "stripe" | "asaas", environment: order.instructions.environment,
      accountFingerprint: order.plan.accountFingerprint, providerPaymentId: order.plan.providerPaymentId!, sourceId: order.budget.capture.sourceId,
      paymentAmountCents: order.plan.amountCents, amountCents: refund.amountCents, currency: "BRL" as const,
      ...(order.plan.provider === "asaas" ? { asaasCapture: order.budget.capture } : {}),
      previousRefunds: prior.map(row => ({ providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents })),
      reference: `mrefund_${fundingHash([refund.hostMerchantId, refund.returnId])}` };
    return { ...raw, requestHash: fundingHash(raw) };
  }

  private async assertUnsubmittedContributionOrder(tx: Prisma.TransactionClient,
    order: Awaited<ReturnType<PrismaMarketplaceRefundRepository["order"]>>) {
    if (order.payouts.some(row => row.status !== "planned" || row.providerTransferId || row.claimedAt) ||
        await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: order.plan.paymentIntentId } }) ||
        await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: order.plan.paymentIntentId } }) ||
        await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: order.plan.paymentIntentId } })) {
      fail("marketplace_refund_contribution_payout_history_unavailable");
    }
  }

  private async assertReturnedFunds(tx: Prisma.TransactionClient,
    refund: { id: string; fundingPlanId: string; hostMerchantId: string; allocation: unknown; allocationHash: string; amountCents: number },
    order: Awaited<ReturnType<PrismaMarketplaceRefundRepository["order"]>>) {
    const allocation = refund.allocation as MarketplaceRefundAllocation;
    if (fundingHash(allocation) !== refund.allocationHash || allocation.requiredContributions.length ||
        allocation.amountCents !== refund.amountCents || allocation.cumulativeRefundCents > order.budget.capture.netAmountCents ||
        await tx.marketplaceRefundPlan.count({ where: { fundingPlanId: refund.fundingPlanId, id: { not: refund.id }, status: { not: "confirmed" } } }) ||
        await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: refund.fundingPlanId } }) ||
        await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: refund.fundingPlanId } }) ||
        await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: refund.fundingPlanId } })) return null;
    const history = await readConfirmedAsaasMarketplaceRefundHistory(tx, refund.hostMerchantId, refund.fundingPlanId, order.budget.capture, refund.id);
    const credits = await readCertifiedAsaasMarketplaceWalletReturns(tx, refund.hostMerchantId, refund.fundingPlanId, [...history.rows.map(row => row.id), refund.id]);
    const selected = selectAsaasMarketplaceReturnedFunds({ netAmountCents: order.budget.capture.netAmountCents,
      allocation, previous: history.allocations, payouts: order.payouts, returns: credits.map(credit => ({ id: credit.id,
        payoutId: credit.payoutId, amountCents: credit.amountCents, sellerMerchantId: credit.request.seller.merchantId,
        originalProviderTransferId: credit.request.originalPayout.providerTransferId })) });
    if (!selected?.length) return null;
    for (const beneficiary of order.budget.beneficiaries) {
      if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: beneficiary.merchantId, status: { in: ["outstanding", "deducted"] } } }) ||
          await tx.marketplaceHostDebt.count({ where: { hostMerchantId: beneficiary.merchantId, status: { in: ["outstanding", "deducted"] } } }) ||
          await hasMarketplaceRecoveryExposure(tx, beneficiary.merchantId)) return null;
    }
    return credits.filter(credit => selected.includes(credit.id))
      .map(({ id, payoutId, certificateHash, request, proof }) => ({ id, payoutId, certificateHash, request, proof }));
  }

  private async returnedFunds(tx: Prisma.TransactionClient,
    refund: { id: string; fundingPlanId: string; hostMerchantId: string; allocation: unknown; allocationHash: string; amountCents: number },
    order: Awaited<ReturnType<PrismaMarketplaceRefundRepository["order"]>>) {
    // Any residual history must use its own complete certificate. Unsupported
    // histories cannot fall back to a previously consumed original payout.
    if (await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: refund.fundingPlanId } })) {
      const credits = await assertAsaasMarketplacePostResidualReturnedFunds(tx, refund.hostMerchantId, refund.fundingPlanId, refund.id);
      return credits ? { kind: "residual" as const, credits } : null;
    }
    const credits = await this.assertReturnedFunds(tx, refund, order);
    return credits ? { kind: "original" as const, credits } : null;
  }

  private attachReturnedFunds(request: MarketplaceRefundRequest,
    returnedFunds: NonNullable<Awaited<ReturnType<PrismaMarketplaceRefundRepository["returnedFunds"]>>>) {
    if (returnedFunds.kind === "residual") request.asaasResidualWalletReturns = returnedFunds.credits;
    else request.asaasWalletReturns = returnedFunds.credits;
  }

  async prepare(input: PrepareMarketplaceRefundInput) {
    // A UI precondition is not part of the immutable financial command. Existing
    // plans remain recoverable with their original components after a lost response.
    const { expectedPreparationHash, ...financialInput } = input;
    if (expectedPreparationHash !== undefined && !/^[a-f0-9]{64}$/.test(expectedPreparationHash)) fail("marketplace_refund_preparation_changed");
    return this.prisma.$transaction(async tx => {
      const initial = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: input.paymentIntentId, hostMerchantId: input.hostMerchantId } });
      if (!initial?.providerPaymentId) return fail("marketplace_refund_order_missing");
      // Journals do not inherit Prisma's tenant scope through a nested relation.
      // Check the scoped payment before returning even an existing intent.
      const owned = await tx.paymentIntent.findFirst({ where: { id: input.paymentIntentId, merchantId: input.hostMerchantId }, select: { merchantId: true } });
      if (owned?.merchantId !== input.hostMerchantId) fail("marketplace_refund_order_missing");
      await lockMarketplaceOrder(tx, input.hostMerchantId, initial.providerPaymentId);
      const existing = await tx.marketplaceRefundPlan.findFirst({ where: { returnId: input.returnId, hostMerchantId: input.hostMerchantId } });
      if (existing) {
        if (existing.inputHash !== fundingHash(financialInput)) fail("marketplace_refund_request_changed");
        return existing;
      }
      if ((await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: input.paymentIntentId } }) || await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: input.paymentIntentId } }))) fail("marketplace_refund_money_reserved_for_dispute");
      const { plan, payment, instructions, budget, payouts } = await this.order(tx, input.hostMerchantId, input.paymentIntentId);
      const residuals = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: input.paymentIntentId }, include: { operations: true }, orderBy: { generation: "asc" } });
      if (residuals.some(row => row.status !== "completed" || row.operations.some(operation => operation.status !== "confirmed"))) {
        fail("marketplace_refund_residual_reconciliation_required");
      }
      const paymentOrderIds = [plan.providerPaymentId!, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])];
      const completed = await tx.completedOrder.findMany({ where: { merchantId: input.hostMerchantId, externalOrderId: { in: paymentOrderIds } }, select: { id: true } });
      const orderIds = [...paymentOrderIds, ...completed.map(row => row.id)];
      const returned = await tx.return.findFirst({ where: { id: input.returnId, merchantId: input.hostMerchantId, orderId: { in: orderIds } }, include: { items: true, refund: true } });
      if (!returned || returned.status !== "INSPECTED_PASS" || returned.refund || !returned.items.length) fail("marketplace_refund_return_not_approved");
      const previousRows = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: plan.paymentIntentId }, include: { operation: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      previousRows.sort((a, b) => (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents -
        (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents);
      // Pending/unknown and failed/blocked attempts need explicit reconciliation, never a new reference.
      if (previousRows.some(row => row.status !== "confirmed")) fail("marketplace_refund_previous_unresolved");
      const previous = previousRows.map(row => {
        if (fundingHash(row.allocation) !== row.allocationHash || row.operation?.status !== "confirmed" || !row.operation.providerOperationId) fail("marketplace_refund_allocation_changed");
        if (plan.provider === "asaas") {
          this.verifyOperation(row);
          this.assertAsaasCapture(row.operation.request as unknown as MarketplaceRefundRequest, plan, budget);
          if (!/^asaas_refund_[a-f0-9]{64}$/.test(row.operation.providerOperationId) || !row.operation.claimedAt || !row.operation.reconciledAt) {
            fail("marketplace_refund_asaas_history_unproven");
          }
        }
        return row.allocation as unknown as MarketplaceRefundAllocation;
      });
      const sourceV4 = plan.provider === "stripe" && residuals.length === 1 &&
        (residuals[0]!.basis as {version?: number}).version === 4;
      const sourceAsaas = plan.provider === "asaas" && residuals.length === 1 &&
        [5, 7].includes((residuals[0]!.basis as {version?: number}).version ?? 0);
      if (residuals.length) {
        if (sourceAsaas) await readAsaasMarketplaceCompletedResidualGenerationHistory(tx, input.hostMerchantId, input.paymentIntentId);
        else if (!sourceV4) await readMarketplaceResidualTransferHistory(tx, { funding: plan, instructions, budget, payouts, refunds: previousRows, priorGenerations: residuals });
        for (const beneficiary of budget.beneficiaries) {
          if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
              await tx.marketplaceHostDebt.count({ where: { hostMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
              await hasMarketplaceRecoveryExposure(tx, beneficiary.merchantId)) fail("marketplace_refund_beneficiary_exposure_unreconciled");
        }
      }
      const foreignRefunds = await tx.returnRefund.count({ where: { return: { merchantId: input.hostMerchantId, orderId: { in: orderIds },
        id: { notIn: previousRows.map(row => row.returnId) } } } });
      if (foreignRefunds) fail("marketplace_refund_external_history_unreconciled");
      const cross = await tx.crossStoreLineItem.findMany({ where: { hostMerchantId: input.hostMerchantId, orderId: plan.providerPaymentId! } });
      const identities: MarketplaceRefundLineIdentity[] = [...cross.map(row => {
        const original = budget.lines.find(line => line.lineItemId === row.id);
        if (!row.sourceVariantId || !original || original.sellerMerchantId !== row.sellerMerchantId ||
            row.quantity * row.unitPriceCents !== original.grossAmountCents || row.commissionCents !== original.commissionCents) fail("marketplace_refund_line_identity_missing");
        return { lineItemId: row.id, variantId: row.sourceVariantId, quantity: row.quantity };
      }),
        ...(instructions.hostStockItems ?? []).map(row => ({ lineItemId: row.lineItemId, variantId: row.variantId, quantity: row.quantity }))];
      // Purchased receipt identities survive catalog/SKU edits. Current cross-store rows alone
      // are not enough to establish how many units of which variant were actually delivered.
      for (const merchantId of new Set(budget.lines.map(line => line.sellerMerchantId))) {
        const receipts = await tx.$queryRaw<Array<{ payload: unknown; payload_hash: string }>>`SELECT payload, payload_hash FROM inventory_sale_receipts
          WHERE merchant_id = ${merchantId} AND order_id = ${plan.providerPaymentId}`;
        if (receipts.length !== 1) fail("marketplace_refund_sale_receipt_required");
        const receipt = validateInventorySale(receipts[0]!.payload as SaleCompletedEvent);
        const purchased = identities.filter(identity => budget.lines.some(line => line.lineItemId === identity.lineItemId && line.sellerMerchantId === merchantId));
        if (receipt.merchantId !== merchantId || receipt.orderId !== plan.providerPaymentId ||
            inventorySaleFingerprint(receipt) !== receipts[0]!.payload_hash || purchased.length !== receipt.items.length ||
            receipt.totalCents !== budget.lines.filter(line => line.sellerMerchantId === merchantId).reduce((sum, line) => sum + line.grossAmountCents, 0) ||
            purchased.some(item => !receipt.items.some(row => row.variantId === item.variantId && row.quantity === item.quantity))) {
          fail("marketplace_refund_sale_identity_changed");
        }
      }
      if (expectedPreparationHash !== undefined && expectedPreparationHash !== marketplaceRefundPreparationHash({
        hostMerchantId: input.hostMerchantId, paymentIntentId: input.paymentIntentId, returnId: returned.id,
        orderId: returned.orderId, status: returned.status, items: returned.items, identities,
        instructionsHash: plan.instructionsHash, budgetHash: fundingHash(budget), previous: previousRows,
      })) fail("marketplace_refund_preparation_changed");
      const allocation = buildMarketplaceRefundAllocation({ instructions, budget, identities, items: returned.items,
        components: input.components, previous });
      const automaticShipping = marketplaceReturnShipping({ instructions, budget, identities, items: returned.items, previous });
      if (automaticShipping.some(row => row.amountCents !== (input.components.shipping.find(value => value.merchantId === row.merchantId)?.amountCents ?? 0))) {
        fail("marketplace_refund_shipping_must_match_returned_items");
      }
      const allUnitsReturned = identities.every(identity => identity.quantity ===
        previous.flatMap(row => row.lines).filter(row => row.variantId === identity.variantId).reduce((sum, row) => sum + row.quantity, 0) +
        returned.items.filter(row => row.variantId === identity.variantId).reduce((sum, row) => sum + row.quantity, 0));
      if (allUnitsReturned && input.components.buyerServiceFeeCents !== instructions.buyerServiceFeeCents -
        previous.reduce((sum, row) => sum + row.buyerServiceFeeCents, 0)) fail("marketplace_full_refund_buyer_fee_required");
      const sent = residuals.length > 0 || payouts.some(row => row.status !== "planned" || row.providerTransferId || row.claimedAt);
      const blockReason = !["stripe", "asaas"].includes(plan.provider) ? "marketplace_refund_provider_unavailable" :
        plan.provider === "asaas" && !["pix", "card"].includes(payment.method) ? "marketplace_refund_asaas_method_unavailable" :
        plan.provider === "asaas" && (budget.capture.sourceId !== plan.providerPaymentId || !/^[a-f0-9]{64}$/.test(plan.accountFingerprint) || budget.capture.balanceTransactionId !== undefined) ? "marketplace_refund_asaas_capture_unproven" :
        plan.provider === "asaas" && sent ? "marketplace_refund_asaas_transfer_recovery_unavailable" : sent ? "marketplace_refund_transfer_reversal_required" :
        allocation.requiredContributions.length ? "marketplace_refund_seller_contribution_required" : null;
      const refund = await tx.marketplaceRefundPlan.create({ data: { fundingPlanId: plan.paymentIntentId, hostMerchantId: input.hostMerchantId,
        returnId: returned.id, inputHash: fundingHash(financialInput), allocation: json(allocation), allocationHash: fundingHash(allocation),
        amountCents: allocation.amountCents, status: blockReason ? "blocked" : "prepared", blockReason } });
      // Same advisory lock as payout.claim: either an earlier payout is observed, or later payouts are held.
      await tx.marketplaceFundingPlan.update({ where: { paymentIntentId: plan.paymentIntentId }, data: { status: "held" } });
      await recordMarketplaceShipmentInterruption(tx, [plan.paymentIntentId], "return_after_carrier_submission");
      if (sourceV4) {
        try {
          await readStripeMarketplaceSourceRefundContext(tx, {hostMerchantId: input.hostMerchantId,
            paymentIntentId: plan.paymentIntentId, refundPlanId: refund.id});
        } catch (error) {
          if (error instanceof Error && error.message.includes("marketplace_stripe_source_refund_contribution_required")) {
            fail("marketplace_residual_contribution_history_requires_reconciliation");
          }
          throw error;
        }
      }
      if (!blockReason) {
        const raw = { kind: "refund" as const, provider: plan.provider as "stripe" | "asaas", environment: instructions.environment,
          accountFingerprint: plan.accountFingerprint, providerPaymentId: plan.providerPaymentId!, sourceId: budget.capture.sourceId,
          paymentAmountCents: plan.amountCents, amountCents: refund.amountCents, currency: "BRL" as const,
          ...(plan.provider === "asaas" ? { asaasCapture: budget.capture } : {}),
          previousRefunds: previousRows.map(row => ({ providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents })),
          reference: `mrefund_${fundingHash([input.hostMerchantId, input.returnId])}` };
        const request: MarketplaceRefundRequest = { ...raw, requestHash: fundingHash(raw) };
        await tx.marketplaceRefundOperation.create({ data: { refundPlanId: refund.id, provider: plan.provider,
          accountFingerprint: plan.accountFingerprint, request: json(request), requestHash: request.requestHash, reference: request.reference } });
      } else if (plan.provider === "asaas" && blockReason === "marketplace_refund_asaas_transfer_recovery_unavailable") {
        const returnedFunds = await this.returnedFunds(tx, refund, { plan, payment, instructions, budget, payouts });
        if (returnedFunds) {
          const request = await this.activationRequest(tx, refund, { plan, payment, instructions, budget, payouts });
          this.attachReturnedFunds(request, returnedFunds);
          const { requestHash: _, ...raw } = request;
          request.requestHash = fundingHash(raw);
          await this.activate(tx, refund, request);
          return { ...refund, status: "prepared" };
        }
      }
      return refund;
    });
  }

  async claim(hostMerchantId: string, refundPlanId: string, now: Date, options?: { reconcileOnly?: boolean }) {
    return this.prisma.$transaction(async tx => {
      const plan = await this.lock(tx, hostMerchantId, refundPlanId);
      if (!plan?.operation || ["blocked", "failed"].includes(plan.status)) return undefined;
      this.verifyOperation(plan);
      if (plan.operation.status !== "planned") return { operation: this.map(plan), submit: false };
      if (options?.reconcileOnly) return undefined;
      if ((await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: plan.fundingPlanId } }) || await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: plan.fundingPlanId } }))) fail("marketplace_refund_money_reserved_for_dispute");
      const order = await this.order(tx, hostMerchantId, plan.fundingPlanId);
      const { payouts, plan: funding, budget } = order;
      const request = plan.operation.request as unknown as MarketplaceRefundRequest;
      if (request.asaasResidualWalletReturns && (funding.provider !== "asaas" || request.asaasWalletReturns !== undefined ||
          request.fundingContributions !== undefined || request.stripeSourceFunding !== undefined)) fail("marketplace_refund_wallet_return_unproven");
      if (request.fundingContributions) {
        await this.assertUnsubmittedContributionOrder(tx, order);
        assertMarketplaceRefundFunding(request, await readMarketplaceRefundFunding(tx, hostMerchantId, funding, order.instructions, budget, plan.id));
      }
      if (funding.provider === "asaas") {
        this.assertAsaasCapture(request, funding, budget);
        if (request.asaasResidualWalletReturns) {
          const returnedFunds = await this.returnedFunds(tx, plan, order);
          if (!returnedFunds || returnedFunds.kind !== "residual" ||
              fundingHash(returnedFunds.credits) !== fundingHash(request.asaasResidualWalletReturns)) fail("marketplace_refund_wallet_return_unproven");
        } else if (request.asaasWalletReturns) {
          const credits = await this.assertReturnedFunds(tx, plan, order);
          if (!credits || fundingHash(credits) !== fundingHash(request.asaasWalletReturns)) fail("marketplace_refund_wallet_return_unproven");
        } else if (payouts.some(row => row.status !== "planned" || row.providerTransferId || row.claimedAt) ||
            await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: plan.fundingPlanId } })) fail("marketplace_refund_asaas_transfer_recovery_unavailable");
      }
      if (funding.provider === "stripe" && (plan.blockReason === "marketplace_refund_transfer_reversal_required" || payouts.some(row => row.status !== "planned" || row.providerTransferId || row.claimedAt))) {
        await assertMarketplaceReversalsRecovered(tx, hostMerchantId, plan.id);
      }
      const returned = await tx.return.findFirst({ where: { id: plan.returnId, merchantId: hostMerchantId, status: "INSPECTED_PASS" }, include: { items: true, refund: true } });
      const allocation = plan.allocation as unknown as MarketplaceRefundAllocation;
      if (!returned || (returned.refund && (returned.refund.id !== returnRefundId(plan.id) || returned.refund.paymentIntentId !== plan.fundingPlanId ||
          returned.refund.amountInCents !== plan.amountCents || returned.refund.status !== "PENDING" || returned.refund.providerRefundId)) ||
          allocation.requiredContributions.length && !request.fundingContributions && !request.stripeSourceFunding ||
          fundingHash(returned.items.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
          fundingHash(allocation.lines.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) {
        fail("marketplace_refund_return_changed");
      }
      // The legacy flow claims this same unique return_id before calling a PSP.
      // Reserving it here fences both financial entry points in one transaction.
      if (!returned.refund) await tx.returnRefund.create({ data: { id: returnRefundId(plan.id), returnId: plan.returnId,
        paymentIntentId: plan.fundingPlanId, amountInCents: plan.amountCents, status: "PENDING" } });
      const operation = await tx.marketplaceRefundOperation.update({ where: { id: plan.operation.id, version: plan.operation.version, status: "planned" },
        data: { status: "unknown", version: { increment: 1 }, claimedAt: now } });
      await tx.marketplaceRefundPlan.update({ where: { id: plan.id }, data: { status: "submitted" } });
      await tx.return.update({ where: { id: plan.returnId }, data: { status: "REFUND_PROCESSING" } });
      return { operation: this.map({ ...plan, operation }), submit: true };
    });
  }

  async releaseUnsubmittedClaim(operation: MarketplaceRefundOperation) {
    return this.prisma.$transaction(async tx => {
      const plan = await this.lock(tx, operation.hostMerchantId, operation.refundPlanId);
      if (!plan?.operation || plan.operation.version !== operation.version || plan.operation.status !== "unknown" || plan.operation.providerOperationId) return false;
      this.assertOwner(plan, operation);
      await tx.marketplaceRefundOperation.update({ where: { id: operation.operationId, version: operation.version },
        data: { status: "planned", claimedAt: null, version: { increment: 1 } } });
      await tx.marketplaceRefundPlan.update({ where: { id: plan.id }, data: { status: "prepared" } });
      await tx.return.update({ where: { id: plan.returnId }, data: { status: "INSPECTED_PASS" } });
      return true;
    });
  }

  async record(operation: MarketplaceRefundOperation, observation: MarketplaceRefundObservation) {
    return this.prisma.$transaction(async tx => {
      const plan = await this.lock(tx, operation.hostMerchantId, operation.refundPlanId);
      if (!plan?.operation || plan.operation.version !== operation.version || !["unknown", "pending"].includes(plan.operation.status)) return false;
      this.assertOwner(plan, operation);
      if (plan.operation.provider === "asaas") {
        const funding = await tx.marketplaceFundingPlan.findFirstOrThrow({ where: { paymentIntentId: plan.fundingPlanId, hostMerchantId: operation.hostMerchantId } });
        if (!funding.budget) fail("marketplace_refund_asaas_capture_unproven");
        this.assertAsaasCapture(plan.operation.request as unknown as MarketplaceRefundRequest, funding, funding.budget as unknown as FundingBudget);
        if (observation.providerOperationId !== undefined && !/^asaas_refund_[a-f0-9]{64}$/.test(observation.providerOperationId)) fail("marketplace_refund_evidence_invalid");
      }
      const terminal = observation.state === "confirmed" || observation.state === "failed";
      if (!["confirmed", "failed", "pending", "unknown"].includes(observation.state) ||
        (terminal && (!observation.providerOperationId || observation.amountCents !== plan.amountCents || !observation.observedAt ||
          !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) < Date.now() - 300_000 ||
          Date.parse(observation.observedAt) > Date.now() + 60_000))) fail("marketplace_refund_evidence_invalid");
      if (plan.operation.providerOperationId && observation.providerOperationId && plan.operation.providerOperationId !== observation.providerOperationId) fail("marketplace_refund_receipt_changed");
      await tx.marketplaceRefundOperation.update({ where: { id: operation.operationId, version: operation.version }, data: {
        status: observation.state, providerOperationId: observation.providerOperationId, reconciledAt: new Date(), version: { increment: 1 } } });
      if (observation.state === "failed") {
        await tx.marketplaceRefundPlan.update({ where: { id: plan.id }, data: { status: "failed" } });
        await tx.returnRefund.update({ where: { id: returnRefundId(plan.id) }, data: { status: "FAILED", providerRefundId: observation.providerOperationId, processedAt: new Date() } });
      }
      if (observation.state !== "confirmed") return true;
      const payment = await tx.paymentIntent.findFirst({ where: { id: plan.fundingPlanId, merchantId: operation.hostMerchantId } });
      if (!payment) fail("marketplace_refund_payment_missing");
      const returned = await tx.return.findFirst({ where: { id: plan.returnId, merchantId: operation.hostMerchantId }, include: { refund: true } });
      if (!returned || returned.refund?.id !== returnRefundId(plan.id) || returned.refund.paymentIntentId !== plan.fundingPlanId ||
          returned.refund.amountInCents !== plan.amountCents || returned.refund.status !== "PENDING" || returned.status !== "REFUND_PROCESSING") fail("marketplace_refund_return_changed");
      await tx.marketplaceRefundPlan.update({ where: { id: plan.id }, data: { status: "confirmed" } });
      await tx.returnRefund.update({ where: { id: returnRefundId(plan.id) }, data: {
        providerRefundId: observation.providerOperationId, status: "COMPLETED", processedAt: new Date() } });
      await tx.return.update({ where: { id: plan.returnId }, data: { status: "REFUND_COMPLETED" } });
      const allocation = plan.allocation as unknown as MarketplaceRefundAllocation;
      if (allocation.cumulativeRefundCents === payment.amountCents) await tx.paymentIntent.update({ where: { id: payment.id }, data: {
        status: "refunded", statusHistory: json([...(Array.isArray(payment.statusHistory) ? payment.statusHistory : []),
          { status: "refunded", at: new Date().toISOString(), reason: "marketplace_refund_confirmed" }]) } });
      await tx.outboxMessage.create({ data: { eventId: `marketplace_refund_${plan.id}`, eventType: "marketplace.refund.confirmed", schemaVersion: 1,
        merchantId: operation.hostMerchantId, occurredAt: new Date(), correlationId: payment.id, causationId: plan.returnId, producer: "marketplace",
        payload: { refund_plan_id: plan.id, return_id: plan.returnId, payment_intent_id: payment.id,
          order_id: payment.providerPaymentId, amount_cents: plan.amountCents, cumulative_refund_cents: allocation.cumulativeRefundCents,
          allocation_hash: plan.allocationHash, provider_refund_id: observation.providerOperationId } } });
      if (observation.reconciliationRequired) {
        await tx.marketplaceFundingPlan.update({ where: { paymentIntentId: payment.id }, data: { status: "held" } });
        await tx.outboxMessage.create({ data: { eventId: `marketplace_refund_financial_reconciliation_${plan.id}`,
          eventType: "marketplace.financial_reconciliation_required", schemaVersion: 1, merchantId: operation.hostMerchantId,
          occurredAt: new Date(), correlationId: payment.id, causationId: operation.operationId, producer: "marketplace",
          payload: { refund_plan_id: plan.id, operation_id: operation.operationId, payment_intent_id: payment.id,
            request_hash: plan.operation.requestHash, provider_operation_id: observation.providerOperationId,
            reason: "marketplace_refund_provider_history_requires_reconciliation" } } });
      }
      return true;
    });
  }

  async listUnresolved(limit: number) {
    const rows = await this.prisma.marketplaceRefundOperation.findMany({ where: { status: { in: ["unknown", "pending"] } },
      select: { refundPlan: { select: { id: true, hostMerchantId: true } } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Math.min(100, Math.max(1, limit)) });
    return rows.map(row => ({ hostMerchantId: row.refundPlan.hostMerchantId, refundPlanId: row.refundPlan.id }));
  }

  private async lock(tx: Prisma.TransactionClient, hostMerchantId: string, id: string) {
    const initial = await tx.marketplaceRefundPlan.findFirst({ where: { id, hostMerchantId }, include: { fundingPlan: true } });
    if (!initial?.fundingPlan.providerPaymentId || initial.fundingPlan.hostMerchantId !== hostMerchantId) return null;
    const owned = await tx.paymentIntent.findFirst({ where: { id: initial.fundingPlanId, merchantId: hostMerchantId }, select: { merchantId: true } });
    if (owned?.merchantId !== hostMerchantId) return null;
    await lockMarketplaceOrder(tx, hostMerchantId, initial.fundingPlan.providerPaymentId);
    return tx.marketplaceRefundPlan.findFirst({ where: { id, hostMerchantId }, include: { operation: true } });
  }

  private async order(tx: Prisma.TransactionClient, hostMerchantId: string, paymentIntentId: string) {
    const plan = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId, hostMerchantId } });
    const payment = await tx.paymentIntent.findFirst({ where: { id: paymentIntentId, merchantId: hostMerchantId } });
    if (!plan?.budget || !plan.providerPaymentId || !["funded", "held"].includes(plan.status) || !payment ||
        payment.providerPaymentId !== plan.providerPaymentId || payment.status !== "approved" || payment.approvedAmountCents !== plan.amountCents ||
        payment.currency !== "BRL" || payment.amountCents !== plan.amountCents) return fail("marketplace_refund_payment_unavailable");
    const instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
    const budget = plan.budget as unknown as FundingBudget;
    const frozen = (payment.creation as unknown as { input?: { marketplaceFunding?: unknown } })?.input?.marketplaceFunding;
    if (fundingHash(instructions) !== plan.instructionsHash || fundingHash(frozen) !== plan.instructionsHash ||
        instructions.hostMerchantId !== hostMerchantId || instructions.provider !== plan.provider || instructions.environment !== plan.environment ||
        instructions.accountFingerprint !== plan.accountFingerprint || instructions.amountCents !== plan.amountCents ||
        fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
        budget.capture.providerPaymentId !== plan.providerPaymentId || budget.capture.accountFingerprint !== plan.accountFingerprint ||
        plan.payoutTotalCents !== budget.payoutTotalCents || plan.netAmountCents !== budget.capture.netAmountCents ||
        plan.providerFeeCents !== budget.capture.providerFeeCents ||
        plan.platformRetainedCents !== budget.platformRetainedCents) fail("marketplace_refund_budget_invalid");
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: plan.providerPaymentId } } });
    if (!ledger?.purchasedAt || ledger.chargebackAt) fail("marketplace_refund_dispute_unreconciled");
    const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: plan.paymentIntentId }, include: { settlement: true } });
    const expected = fundingTransferAllocations(instructions, budget);
    if (payouts.length !== expected.length || new Set(payouts.map(row => JSON.stringify([row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== payouts.length ||
        payouts.reduce((sum, row) => sum + row.amountCents, 0) !== budget.payoutTotalCents || payouts.some(row => {
      const e = expected.find(a => a.lineItemId === (row.settlement?.lineItemId ?? null) && a.merchantId === row.beneficiaryMerchantId);
      return !e || e.amountCents !== row.amountCents || row.kind !== e.kind || row.currency !== "BRL" || row.provider !== plan.provider ||
        row.accountFingerprint !== plan.accountFingerprint || row.providerPaymentId !== plan.providerPaymentId ||
        row.destination !== instructions.destinations.find(d => d.merchantId === row.beneficiaryMerchantId)?.destination;
    })) fail("marketplace_refund_payout_identity_invalid");
    return { plan, payment, instructions, budget, payouts };
  }

  private verifyOperation(plan: { amountCents: number; allocation: unknown; allocationHash: string; operation: { request: unknown; requestHash: string; reference: string; provider: string; accountFingerprint: string } | null }) {
    if (!plan.operation || fundingHash(plan.allocation) !== plan.allocationHash) fail("marketplace_refund_allocation_changed");
    const request = plan.operation.request as MarketplaceRefundRequest;
    const { requestHash, ...raw } = request;
    if (requestHash !== plan.operation.requestHash || fundingHash(raw) !== requestHash || request.amountCents !== plan.amountCents ||
        request.reference !== plan.operation.reference || request.provider !== plan.operation.provider ||
        request.accountFingerprint !== plan.operation.accountFingerprint) fail("marketplace_refund_operation_changed");
  }
  private assertAsaasCapture(request: MarketplaceRefundRequest, funding: { provider: string; environment: string; accountFingerprint: string;
    providerPaymentId: string | null; amountCents: number }, budget: FundingBudget): void {
    const capture = request.asaasCapture;
    if (request.kind !== "refund" || request.transfer !== undefined || request.provider !== "asaas" || funding.provider !== "asaas" ||
        request.environment !== funding.environment || request.accountFingerprint !== funding.accountFingerprint ||
        request.providerPaymentId !== funding.providerPaymentId || request.sourceId !== funding.providerPaymentId ||
        request.paymentAmountCents !== funding.amountCents || !capture || fundingHash(capture) !== fundingHash(budget.capture) ||
        capture.provider !== "asaas" || capture.sourceId !== funding.providerPaymentId || capture.balanceTransactionId !== undefined ||
        request.previousRefunds.reduce((sum, row) => sum + row.amountCents, request.amountCents) > capture.netAmountCents) {
      fail("marketplace_refund_asaas_capture_unproven");
    }
  }
  private assertOwner(plan: Parameters<PrismaMarketplaceRefundRepository["verifyOperation"]>[0] & { operation: { id: string; request: unknown; requestHash: string; reference: string; provider: string; accountFingerprint: string } | null }, operation: MarketplaceRefundOperation) {
    this.verifyOperation(plan);
    if (plan.operation?.id !== operation.operationId || fundingHash(plan.operation.request) !== fundingHash(operation.request)) fail("marketplace_refund_claim_changed");
  }
  private map(plan: { id: string; hostMerchantId: string; operation: { id: string; version: number; status: string; request: unknown; providerOperationId: string | null } | null }): MarketplaceRefundOperation {
    const row = plan.operation!;
    return { operationId: row.id, refundPlanId: plan.id, hostMerchantId: plan.hostMerchantId, version: row.version,
      state: row.status as MarketplaceRefundOperation["state"], request: row.request as MarketplaceRefundRequest,
      providerOperationId: row.providerOperationId ?? undefined };
  }
}
