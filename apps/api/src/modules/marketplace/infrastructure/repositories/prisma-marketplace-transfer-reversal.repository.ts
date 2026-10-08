import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplaceRefundObservation, MarketplaceRefundRequest } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceTransferReversalOperation, MarketplaceTransferReversalRepository } from "../../domain/ports/marketplace-transfer-reversal-repository.port.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { allocateMarketplaceTransferReversals, allocateMarketplaceTransferReversalsAfterResidual } from "../../domain/services/marketplace-transfer-reversal-allocation.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { readMarketplaceResidualTransferHistory } from "./marketplace-residual-history.js";
import type { MarketplaceResidualBasis } from "../../domain/services/marketplace-residual-allocation.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";
import { recordMarketplaceTransferRecoveries } from "./marketplace-transfer-recovery.js";
import { readStripeMarketplaceSourceRefundContext } from "./stripe-marketplace-source-refund-history.js";

const json = (value: unknown) => value as Prisma.InputJsonValue;
function fail(reason: string): never { throw new ConflictException(reason); }
const returnRefundId = (planId: string) => `mrefund_return_${fundingHash(planId)}`;
const targetId = (row: { payoutId: string | null; residualOperationId: string | null }): string => row.payoutId ?? row.residualOperationId!;

async function readRecovery(tx: Prisma.TransactionClient, hostMerchantId: string, refundPlanId: string, options?: { disputeEvidenceOnly?: boolean }) {
  const initial = await tx.marketplaceRefundPlan.findFirst({ where: { id: refundPlanId, hostMerchantId }, include: { fundingPlan: true } });
  if (!initial?.fundingPlan.providerPaymentId) return fail("marketplace_reversal_order_missing");
  if (!await tx.paymentIntent.findFirst({ where: { id: initial.fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) fail("marketplace_reversal_order_missing");
  await lockMarketplaceOrder(tx, hostMerchantId, initial.fundingPlan.providerPaymentId);
  const refund = await tx.marketplaceRefundPlan.findFirstOrThrow({ where: { id: refundPlanId, hostMerchantId } });
  const funding = await tx.marketplaceFundingPlan.findFirstOrThrow({ where: { paymentIntentId: refund.fundingPlanId, hostMerchantId } });
  if (!options?.disputeEvidenceOnly && refund.status !== "confirmed" && (await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: funding.paymentIntentId } }) || await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: funding.paymentIntentId } }))) {
    fail("marketplace_reversal_money_reserved_for_dispute");
  }
  const payment = await tx.paymentIntent.findFirst({ where: { id: funding.paymentIntentId, merchantId: hostMerchantId } });
  if (refund.blockReason !== "marketplace_refund_transfer_reversal_required" || !["blocked", "prepared", "submitted", "confirmed"].includes(refund.status) ||
      funding.provider !== "stripe" || funding.status !== "held" || !funding.providerPaymentId || !funding.budget ||
      !payment || !(payment.status === "approved" || payment.status === "refunded" && refund.status === "confirmed" ||
        options?.disputeEvidenceOnly && payment.status.startsWith("chargeback_")) || payment.providerPaymentId !== funding.providerPaymentId || payment.amountCents !== funding.amountCents ||
      payment.approvedAmountCents !== funding.amountCents || payment.currency !== "BRL") fail("marketplace_reversal_order_unavailable");
  const history = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operation: true, return: { include: { refund: true } } } });
  history.sort((a, b) => Number((a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents) - Number((b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents));
  const generation = history.findIndex(row => row.id === refundPlanId);
  if (generation < 0 || history.slice(0, generation).some(row => row.status !== "confirmed") ||
      refund.status !== "confirmed" && generation !== history.length - 1) fail("marketplace_reversal_previous_refunds_unreconciled");
  const prefix = history.slice(0, generation + 1);
  const residuals = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operations: true }, orderBy: { generation: "asc" } });
  const previousResiduals = residuals.filter(row => (row.basis as unknown as MarketplaceResidualBasis).refunds.length <= generation);
  if (refund.status !== "confirmed" && previousResiduals.length !== residuals.length) fail("marketplace_reversal_residual_unreconciled");
  const instructions = funding.instructions as unknown as FrozenMarketplaceFunding;
  const budget = funding.budget as unknown as FundingBudget;
  const frozen = (payment.creation as unknown as { input?: { marketplaceFunding?: unknown } })?.input?.marketplaceFunding;
  if (fundingHash(instructions) !== funding.instructionsHash || fundingHash(frozen) !== funding.instructionsHash ||
      fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
      instructions.hostMerchantId !== hostMerchantId || instructions.provider !== funding.provider || instructions.environment !== funding.environment ||
      instructions.accountFingerprint !== funding.accountFingerprint || budget.capture.providerPaymentId !== funding.providerPaymentId ||
      budget.capture.accountFingerprint !== funding.accountFingerprint || budget.capture.amountCents !== funding.amountCents ||
      budget.capture.netAmountCents !== funding.netAmountCents || budget.capture.providerFeeCents !== funding.providerFeeCents ||
      budget.payoutTotalCents !== funding.payoutTotalCents || budget.platformRetainedCents !== funding.platformRetainedCents) fail("marketplace_reversal_budget_invalid");
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: funding.providerPaymentId } } });
  if (!ledger?.purchasedAt || (options?.disputeEvidenceOnly ? !ledger.chargebackAt : ledger.chargebackAt)) fail("marketplace_reversal_dispute_unreconciled");
  const allocation = refund.allocation as unknown as MarketplaceRefundAllocation;
  const paymentOrderIds = [funding.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])];
  const completed = await tx.completedOrder.findMany({ where: { merchantId: hostMerchantId, externalOrderId: { in: paymentOrderIds } }, select: { id: true } });
  const orderIds = [...paymentOrderIds, ...completed.map(row => row.id)];
  const returned = await tx.return.findFirst({ where: { id: refund.returnId, merchantId: hostMerchantId, orderId: { in: orderIds } }, include: { items: true, refund: true } });
  const expectedReturnStatus = refund.status === "confirmed" ? "REFUND_COMPLETED" : refund.status === "submitted" ? "REFUND_PROCESSING" : "INSPECTED_PASS";
  if (!returned || returned.status !== expectedReturnStatus ||
      returned.refund && (returned.refund.id !== returnRefundId(refund.id) || returned.refund.status !== "PENDING" ||
        returned.refund.providerRefundId || returned.refund.amountInCents !== refund.amountCents || returned.refund.paymentIntentId !== funding.paymentIntentId) && refund.status !== "confirmed" ||
      fundingHash(returned.items.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
      fundingHash(allocation.lines.map(row => ({ variantId: row.variantId, quantity: row.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) {
    fail("marketplace_reversal_return_changed");
  }
  if (await tx.returnRefund.count({ where: { return: { merchantId: hostMerchantId, orderId: { in: orderIds }, id: { notIn: history.map(row => row.returnId) } } } })) {
    fail("marketplace_reversal_external_refund_unreconciled");
  }
  const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { settlement: true }, orderBy: { id: "asc" } });
  const expected = fundingTransferAllocations(instructions, budget);
  if (payouts.length !== expected.length || new Set(payouts.map(row => JSON.stringify([row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== payouts.length ||
      payouts.reduce((sum, row) => sum + row.amountCents, 0) !== budget.payoutTotalCents || payouts.some(row => {
        const match = expected.find(value => value.lineItemId === (row.settlement?.lineItemId ?? null) && value.merchantId === row.beneficiaryMerchantId);
        return !match || match.amountCents !== row.amountCents || row.kind !== match.kind || row.provider !== "stripe" || row.currency !== "BRL" ||
          row.accountFingerprint !== funding.accountFingerprint || row.providerPaymentId !== funding.providerPaymentId ||
          row.destination !== instructions.destinations.find(destination => destination.merchantId === row.beneficiaryMerchantId)?.destination ||
          row.status === "confirmed" && (!row.reconciledAt || !row.claimedAt || !row.providerTransferId?.startsWith("tr_") ||
            row.settlement && (!(options?.disputeEvidenceOnly ? ["transferred", "finalized", "chargeback_debt"] : ["transferred", "finalized"]).includes(row.settlement.status) || row.settlement.providerTransferId !== row.providerTransferId));
      })) fail("marketplace_reversal_payout_identity_invalid");
  const allRows = await tx.marketplaceTransferReversal.findMany({ where: { OR: [{ payoutId: { in: payouts.map(row => row.id) } },
    { residualOperation: { residualPlan: { fundingPlanId: funding.paymentIntentId } } },
    { refundPlanId: { in: prefix.map(row => row.id) } }] }, orderBy: { id: "asc" } });
  if (allRows.some(row => !history.some(plan => plan.id === row.refundPlanId))) fail("marketplace_reversal_external_history_unreconciled");
  const previousRefunds: MarketplaceRefundRequest["previousRefunds"] = [];
  const previousReversals: Array<{ payoutId: string; providerOperationId: string; amountCents: number; reference: string; requestHash: string }> = [];
  const merchantDebits = new Map(budget.beneficiaries.map(row => [row.merchantId, 0]));
  let refunded = 0, platformDebit = 0;
  let required: ReturnType<typeof allocateMarketplaceTransferReversals> = [];
  let targetPayouts: RecoveryRequestContext["payouts"] = payouts;
  if (previousResiduals.length && !options?.disputeEvidenceOnly) for (const beneficiary of budget.beneficiaries) {
    if (await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
        await tx.marketplaceHostDebt.count({ where: { hostMerchantId: beneficiary.merchantId, status: "outstanding" } }) ||
        await hasMarketplaceRecoveryExposure(tx, beneficiary.merchantId)) fail("marketplace_reversal_beneficiary_exposure_unreconciled");
  }
  if (previousResiduals.length === 1 && (previousResiduals[0]!.basis as {version?: number}).version === 4) {
    if (options?.disputeEvidenceOnly) fail("marketplace_reversal_source_dispute_history_unavailable");
    const sourceReplay = await readStripeMarketplaceSourceRefundContext(tx, {hostMerchantId,
      paymentIntentId: funding.paymentIntentId, refundPlanId, admission: true});
    const sourcePayouts = sourceReplay.context.residual.operations.map(operation => ({
      id: operation.operationId, kind: "residual" as const, requestHash: operation.request.requestHash,
      providerTransferId: operation.providerTransferId, destination: operation.request.destination,
      amountCents: operation.request.amountCents, reference: operation.request.reference,
    }));
    return {refund, funding, instructions, budget, allocation, payouts: sourcePayouts,
      required: sourceReplay.plan.requiredReversals.map(({payoutId, amountCents}) => ({payoutId, amountCents})), returned,
      previousRefunds: sourceReplay.refundRequest.previousRefunds,
      previousReversals: sourceReplay.context.history.flatMap(row => row.reversals), ledger, sourceReplay};
  }
  for (const current of prefix) {
    const currentAllocation = current.allocation as unknown as MarketplaceRefundAllocation;
    const previousDebits = [...merchantDebits].map(([merchantId, amountCents]) => ({ merchantId, amountCents }));
    refunded += current.amountCents; platformDebit += currentAllocation.platformDebitCents;
    if (fundingHash(currentAllocation) !== current.allocationHash || currentAllocation.version !== 1 || currentAllocation.amountCents !== current.amountCents ||
        currentAllocation.cumulativeRefundCents !== refunded || currentAllocation.requiredContributions.length ||
        currentAllocation.merchantDebits.length !== budget.beneficiaries.length ||
        new Set(currentAllocation.merchantDebits.map(row => row.merchantId)).size !== budget.beneficiaries.length ||
        currentAllocation.merchantDebits.some(row => !merchantDebits.has(row.merchantId) || !Number.isSafeInteger(row.amountCents)) ||
        currentAllocation.merchantDebits.reduce((sum, row) => sum + row.amountCents, currentAllocation.platformDebitCents) !== current.amountCents) fail("marketplace_reversal_allocation_invalid");
    for (const debit of currentAllocation.merchantDebits) merchantDebits.set(debit.merchantId, merchantDebits.get(debit.merchantId)! + debit.amountCents);
    if (currentAllocation.remainingBeneficiaries.length !== budget.beneficiaries.length || budget.beneficiaries.some(row => {
      const remaining = currentAllocation.remainingBeneficiaries.find(value => value.merchantId === row.merchantId);
      return !remaining || remaining.providerFeeCents !== row.providerFeeCents || remaining.amountCents !== row.amountCents - merchantDebits.get(row.merchantId)! || remaining.amountCents < 0;
    }) || currentAllocation.platformRemainingCents !== budget.platformRetainedCents - platformDebit || currentAllocation.platformRemainingCents < 0) fail("marketplace_reversal_allocation_invalid");
    const byPayout = new Map<string, number>();
    for (const prior of previousReversals) byPayout.set(prior.payoutId, (byPayout.get(prior.payoutId) ?? 0) + prior.amountCents);
    const currentIndex = history.findIndex(row => row.id === current.id);
    const priorGenerations = previousResiduals.filter(row => (row.basis as unknown as MarketplaceResidualBasis).refunds.length <= currentIndex);
    if (priorGenerations.length) {
      const proven = await readMarketplaceResidualTransferHistory(tx, { funding, instructions, budget, payouts,
        refunds: history.slice(0, currentIndex), priorGenerations, allowDisputeHeld: options?.disputeEvidenceOnly });
      required = allocateMarketplaceTransferReversalsAfterResidual({ merchantDebits: currentAllocation.merchantDebits,
        remainingBeneficiaries: budget.beneficiaries.map(row => ({ merchantId: row.merchantId,
          amountCents: row.amountCents - previousDebits.find(d => d.merchantId === row.merchantId)!.amountCents })), transfers: proven.transfers });
      targetPayouts = proven.transfers.map(row => ({ ...row, id: row.payoutId }));
    } else {
      required = allocateMarketplaceTransferReversals({ merchantDebits: currentAllocation.merchantDebits, previousMerchantDebits: previousDebits,
        previousReversals: [...byPayout].map(([payoutId, amountCents]) => ({ payoutId, amountCents })),
        payouts: payouts.map(row => ({ ...row, status: options?.disputeEvidenceOnly && row.status === "cancelled" && !row.claimedAt && !row.providerTransferId ? "planned" : row.status,
          beneficiaryMerchantId: row.beneficiaryMerchantId! })) });
      targetPayouts = payouts;
    }
    const context = { refund: current, funding, instructions, budget, payouts: targetPayouts, previousRefunds, previousReversals };
    if (current.id === refund.id && current.status !== "confirmed") break;
    const rows = allRows.filter(row => row.refundPlanId === current.id);
    // Previous pre-payout refunds are valid too: their held-cash debit leaves no reversal rows.
    if (rows.length !== required.length || rows.some(row => {
      const amount = required.find(expected => expected.payoutId === targetId(row))?.amountCents;
      return !amount || !matchesTarget(row, context) || !matchesReversal(row, requestFor(context, targetId(row), amount), hostMerchantId) || row.status !== "confirmed" ||
        !row.providerOperationId?.startsWith("trr_") || !row.claimedAt || !row.reconciledAt;
    })) fail("marketplace_reversal_previous_refunds_unreconciled");
    const request = refundRequestFor(context);
    const operation = current.operation, receipt = current.return.refund;
    if (current.status !== "confirmed" || current.hostMerchantId !== hostMerchantId || current.return.merchantId !== hostMerchantId ||
        !orderIds.includes(current.return.orderId) || current.return.status !== "REFUND_COMPLETED" ||
        !operation || operation.status !== "confirmed" || !operation.providerOperationId?.startsWith("re_") || !operation.claimedAt || !operation.reconciledAt ||
        operation.provider !== request.provider || operation.accountFingerprint !== request.accountFingerprint || operation.reference !== request.reference ||
        operation.requestHash !== request.requestHash || fundingHash(operation.request) !== fundingHash(request) ||
        !receipt || receipt.id !== returnRefundId(current.id) || receipt.status !== "COMPLETED" || receipt.paymentIntentId !== funding.paymentIntentId ||
        receipt.amountInCents !== current.amountCents || receipt.providerRefundId !== operation.providerOperationId) fail("marketplace_reversal_previous_refunds_unreconciled");
    if (current.id === refund.id) break; // An old generation keeps its original prefix even after later refunds exist.
    previousRefunds.push({ providerOperationId: operation.providerOperationId, amountCents: current.amountCents });
    previousReversals.push(...rows.map(row => ({ payoutId: targetId(row), providerOperationId: row.providerOperationId!, amountCents: row.amountCents,
      reference: row.reference, requestHash: row.requestHash })));
  }
  return { refund, funding, instructions, budget, allocation, payouts: targetPayouts, required, returned, previousRefunds, previousReversals, ledger };
}

type RecoveryRequestContext = {
  refund: { id: string; hostMerchantId: string; returnId: string; amountCents: number };
  funding: { accountFingerprint: string; providerPaymentId: string | null; amountCents: number };
  instructions: FrozenMarketplaceFunding; budget: FundingBudget;
  payouts: Array<{ id: string; providerTransferId: string | null; destination: string; amountCents: number; reference: string; kind?: string; requestHash?: string }>;
  previousRefunds: MarketplaceRefundRequest["previousRefunds"];
  previousReversals: Array<{ payoutId: string; providerOperationId: string; amountCents: number; reference: string; requestHash: string }>;
  sourceReplay?: Awaited<ReturnType<typeof readStripeMarketplaceSourceRefundContext>>;
};
function requestFor(order: RecoveryRequestContext, payoutId: string, amountCents: number): MarketplaceRefundRequest {
  if (order.sourceReplay) {
    const reversal = order.sourceReplay.reversalRequests.find(row => row.payoutId === payoutId && row.amountCents === amountCents);
    if (!reversal) fail("marketplace_stripe_source_refund_reversal_changed");
    return reversal.request;
  }
  const payout = order.payouts.find(row => row.id === payoutId)!;
  const raw = { kind: "transfer_reversal" as const, provider: "stripe" as const, environment: order.instructions.environment,
    accountFingerprint: order.funding.accountFingerprint, providerPaymentId: order.funding.providerPaymentId!, sourceId: order.budget.capture.sourceId,
    paymentAmountCents: order.funding.amountCents, amountCents, currency: "BRL" as const,
    previousRefunds: [...order.previousRefunds], reference: `mreverse_${fundingHash([order.refund.hostMerchantId, order.refund.id, payoutId])}`,
    transfer: { providerTransferId: payout.providerTransferId!, destination: payout.destination, amountCents: payout.amountCents, reference: payout.reference,
      ...(payout.kind === "residual" ? { kind: "residual" as const, requestHash: payout.requestHash } : {}),
      ...(order.previousReversals.some(row => row.payoutId === payoutId) ? { previousReversals: order.previousReversals.filter(row => row.payoutId === payoutId)
        .map(({ providerOperationId, amountCents, reference, requestHash }) => ({ providerOperationId, amountCents, reference, requestHash })) } : {}) } };
  return { ...raw, requestHash: fundingHash(raw) };
}

function refundRequestFor(order: Omit<RecoveryRequestContext, "payouts" | "previousReversals">): MarketplaceRefundRequest {
  if (order.sourceReplay) return order.sourceReplay.refundRequest;
  const raw = { kind: "refund" as const, provider: "stripe" as const, environment: order.instructions.environment,
    accountFingerprint: order.funding.accountFingerprint, providerPaymentId: order.funding.providerPaymentId!, sourceId: order.budget.capture.sourceId,
    paymentAmountCents: order.funding.amountCents, amountCents: order.refund.amountCents, currency: "BRL" as const,
    previousRefunds: [...order.previousRefunds], reference: `mrefund_${fundingHash([order.refund.hostMerchantId, order.refund.returnId])}` };
  return { ...raw, requestHash: fundingHash(raw) };
}
function matchesReversal(row: { hostMerchantId: string; amountCents: number; provider: string; accountFingerprint: string; reference: string; requestHash: string; request: unknown }, request: MarketplaceRefundRequest, hostMerchantId: string) {
  return row.hostMerchantId === hostMerchantId && row.amountCents === request.amountCents && row.provider === request.provider &&
    row.accountFingerprint === request.accountFingerprint && row.reference === request.reference && row.requestHash === request.requestHash && fundingHash(row.request) === fundingHash(request);
}
function matchesTarget(row: { payoutId: string | null; residualOperationId: string | null }, context: RecoveryRequestContext) {
  const target = context.payouts.find(p => p.id === targetId(row));
  return !!target && !!row.payoutId !== !!row.residualOperationId && (target.kind === "residual") === !!row.residualOperationId;
}

async function verifyRows(tx: Prisma.TransactionClient, order: Awaited<ReturnType<typeof readRecovery>>, confirmed: boolean) {
  const rows = await tx.marketplaceTransferReversal.findMany({ where: { refundPlanId: order.refund.id }, orderBy: { id: "asc" } });
  if (rows.length !== order.required.length || rows.some(row => {
    const expected = order.required.find(value => value.payoutId === targetId(row));
    const request = expected && requestFor(order, targetId(row), expected.amountCents);
    return !expected || !request || !matchesTarget(row, order) || row.hostMerchantId !== order.refund.hostMerchantId || row.amountCents !== expected.amountCents ||
      row.provider !== request.provider || row.accountFingerprint !== request.accountFingerprint || row.reference !== request.reference ||
      row.requestHash !== request.requestHash || fundingHash(row.request) !== fundingHash(request) ||
      confirmed && (row.status !== "confirmed" || !row.providerOperationId?.startsWith("trr_") || !row.claimedAt || !row.reconciledAt);
  })) fail(confirmed ? "marketplace_reversal_recovery_incomplete" : "marketplace_reversal_request_changed");
  return rows;
}

/** Call in the same transaction and order lock immediately before authorizing a refund POST. */
export async function assertMarketplaceReversalsRecovered(tx: Prisma.TransactionClient, hostMerchantId: string, refundPlanId: string) {
  const order = await readRecovery(tx, hostMerchantId, refundPlanId);
  await verifyRows(tx, order, true);
  return order;
}

/** Rebuilds immutable requests under a dispute for receipt certification only.
 * It deliberately does not release a refund or admit a provider mutation. */
export async function readMarketplaceReversalRecoveryForExposure(tx: Prisma.TransactionClient, hostMerchantId: string, refundPlanId: string) {
  return readRecovery(tx, hostMerchantId, refundPlanId, { disputeEvidenceOnly: true });
}
export { requestFor as buildMarketplaceTransferReversalRequest };

/** Integrated by receipt confirmation and chargeback delivery/replay. */
export async function recordMarketplaceReversalRecoveryEvidence(tx: Prisma.TransactionClient, hostMerchantId: string, fundingPlanId: string) {
  return recordMarketplaceTransferRecoveries(tx, hostMerchantId, fundingPlanId, async refundPlanId => {
    const order = await readMarketplaceReversalRecoveryForExposure(tx, hostMerchantId, refundPlanId);
    return { instructionsHash: order.funding.instructionsHash, budget: order.budget, chargebackAt: order.ledger.chargebackAt!,
      required: order.required.map(row => ({ targetId: row.payoutId, request: requestFor(order, row.payoutId, row.amountCents) })) };
  });
}

@Injectable()
export class PrismaMarketplaceTransferReversalRepository implements MarketplaceTransferReversalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async prepare(hostMerchantId: string, refundPlanId: string) {
    return this.prisma.$transaction(async tx => {
      const order = await readRecovery(tx, hostMerchantId, refundPlanId);
      const current = await tx.marketplaceTransferReversal.count({ where: { refundPlanId } });
      if (current || order.refund.status === "confirmed") return verifyRows(tx, order, order.refund.status === "confirmed");
      if (order.refund.status !== "blocked") fail("marketplace_reversal_already_released");
      for (const expected of order.required) {
        const request = requestFor(order, expected.payoutId, expected.amountCents);
        const target = order.payouts.find(row => row.id === expected.payoutId)!;
        await tx.marketplaceTransferReversal.create({ data: { refundPlanId,
          ...(target.kind === "residual" ? { residualOperationId: expected.payoutId } : { payoutId: expected.payoutId }), hostMerchantId,
          provider: request.provider, accountFingerprint: request.accountFingerprint, amountCents: expected.amountCents,
          request: json(request), requestHash: request.requestHash, reference: request.reference } });
      }
      return verifyRows(tx, order, false);
    });
  }

  async releaseRefund(hostMerchantId: string, refundPlanId: string): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const order = await assertMarketplaceReversalsRecovered(tx, hostMerchantId, refundPlanId);
      const existing = await tx.marketplaceRefundOperation.findUnique({ where: { refundPlanId } });
      const request = refundRequestFor(order);
      if (existing) {
        if (fundingHash(existing.request) !== fundingHash(request)) fail("marketplace_reversal_refund_changed");
        return ["prepared", "submitted", "confirmed"].includes(order.refund.status);
      }
      await tx.marketplaceRefundOperation.create({ data: { refundPlanId, provider: request.provider, accountFingerprint: request.accountFingerprint,
        request: json(request), requestHash: request.requestHash, reference: request.reference } });
      await tx.marketplaceRefundPlan.update({ where: { id: refundPlanId, status: "blocked" }, data: { status: "prepared" } });
      return true;
    });
  }

  async claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, hostMerchantId, operationId);
      if (!row) return undefined;
      this.verify(row);
      if (row.status !== "planned") return { operation: this.map(row), submit: false };
      if (options?.reconcileOnly) return undefined;
      const order = await readRecovery(tx, hostMerchantId, row.refundPlanId);
      if (order.refund.status !== "blocked") fail("marketplace_reversal_already_released");
      await verifyRows(tx, order, false);
      // Fence the generic Return refund before touching seller funds. Refund claim recognizes this same identity.
      if (!order.returned.refund) await tx.returnRefund.create({ data: { id: returnRefundId(order.refund.id), returnId: order.refund.returnId,
        paymentIntentId: order.funding.paymentIntentId, amountInCents: order.refund.amountCents, status: "PENDING" } });
      const claimed = await tx.marketplaceTransferReversal.update({ where: { id: operationId, version: row.version, status: "planned" },
        data: { status: "unknown", claimedAt: now, version: { increment: 1 } } });
      return { operation: this.map(claimed), submit: true };
    });
  }

  async releaseUnsubmittedClaim(operation: MarketplaceTransferReversalOperation) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, operation.hostMerchantId, operation.operationId);
      if (!row || row.version !== operation.version || row.status !== "unknown" || row.providerOperationId) return false;
      this.assertOwner(row, operation);
      await tx.marketplaceTransferReversal.update({ where: { id: row.id, version: row.version }, data: { status: "planned", claimedAt: null, version: { increment: 1 } } });
      return true;
    });
  }

  async record(operation: MarketplaceTransferReversalOperation, observation: MarketplaceRefundObservation) {
    return this.prisma.$transaction(async tx => {
      const row = await this.lock(tx, operation.hostMerchantId, operation.operationId);
      if (!row || row.version !== operation.version || !["unknown", "pending"].includes(row.status)) return false;
      this.assertOwner(row, operation);
      const terminal = ["confirmed", "failed"].includes(observation.state);
      if (!["unknown", "pending", "confirmed", "failed"].includes(observation.state) || terminal &&
          (!observation.providerOperationId?.startsWith("trr_") || observation.amountCents !== row.amountCents || !observation.observedAt ||
            !Number.isFinite(Date.parse(observation.observedAt)) || Date.parse(observation.observedAt) < Date.now() - 300_000 ||
            Date.parse(observation.observedAt) > Date.now() + 60_000)) fail("marketplace_reversal_evidence_invalid");
      if (row.providerOperationId && observation.providerOperationId && row.providerOperationId !== observation.providerOperationId) fail("marketplace_reversal_receipt_changed");
      await tx.marketplaceTransferReversal.update({ where: { id: row.id, version: row.version }, data: { status: observation.state,
        providerOperationId: observation.providerOperationId, reconciledAt: new Date(), version: { increment: 1 } } });
      if (observation.state === "confirmed") await tx.outboxMessage.create({ data: { eventId: `marketplace_reversal_${row.id}`,
        eventType: "marketplace.transfer_reversal.confirmed", schemaVersion: 1, merchantId: row.hostMerchantId, occurredAt: new Date(),
        correlationId: row.refundPlanId, causationId: targetId(row), producer: "marketplace", payload: {
          reversal_operation_id: row.id, refund_plan_id: row.refundPlanId, payout_id: row.payoutId,
          ...(row.residualOperationId ? { residual_operation_id: row.residualOperationId } : {}),
          amount_cents: row.amountCents, provider_reversal_id: observation.providerOperationId!, request_hash: row.requestHash } } });
      if (observation.state === "confirmed") {
        const refund = await tx.marketplaceRefundPlan.findUniqueOrThrow({ where: { id: row.refundPlanId }, select: { fundingPlanId: true } });
        if (observation.reconciliationRequired) {
          await tx.marketplaceFundingPlan.update({ where: { paymentIntentId: refund.fundingPlanId }, data: { status: "held" } });
          await tx.outboxMessage.create({ data: { eventId: `marketplace_reversal_financial_reconciliation_${row.id}`,
            eventType: "marketplace.financial_reconciliation_required", schemaVersion: 1, merchantId: row.hostMerchantId,
            occurredAt: new Date(), correlationId: refund.fundingPlanId, causationId: row.id, producer: "marketplace",
            payload: { refund_plan_id: row.refundPlanId, operation_id: row.id, payment_intent_id: refund.fundingPlanId,
              request_hash: row.requestHash, provider_operation_id: observation.providerOperationId,
              reason: "marketplace_reversal_provider_history_requires_reconciliation" } } });
        }
        await recordMarketplaceReversalRecoveryEvidence(tx, row.hostMerchantId, refund.fundingPlanId);
      }
      return true;
    });
  }

  async listUnresolved(limit: number) {
    const rows = await this.prisma.marketplaceTransferReversal.findMany({ where: { status: { in: ["unknown", "pending"] } },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20,
      select: { id: true, hostMerchantId: true } });
    return rows.map(row => ({ hostMerchantId: row.hostMerchantId, operationId: row.id }));
  }

  private async lock(tx: Prisma.TransactionClient, hostMerchantId: string, id: string) {
    const initial = await tx.marketplaceTransferReversal.findFirst({ where: { id, hostMerchantId }, include: { refundPlan: { include: { fundingPlan: true } } } });
    if (!initial?.refundPlan.fundingPlan.providerPaymentId || initial.refundPlan.hostMerchantId !== hostMerchantId || initial.refundPlan.fundingPlan.hostMerchantId !== hostMerchantId) return null;
    if (!await tx.paymentIntent.findFirst({ where: { id: initial.refundPlan.fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) return null;
    await lockMarketplaceOrder(tx, hostMerchantId, initial.refundPlan.fundingPlan.providerPaymentId);
    return tx.marketplaceTransferReversal.findFirst({ where: { id, hostMerchantId } });
  }

  private verify(row: { amountCents: number; provider: string; accountFingerprint: string; request: unknown; requestHash: string; reference: string }) {
    const request = row.request as MarketplaceRefundRequest;
    const { requestHash, ...raw } = request;
    if (request.kind !== "transfer_reversal" || request.provider !== row.provider || request.accountFingerprint !== row.accountFingerprint ||
        request.reference !== row.reference || requestHash !== row.requestHash || fundingHash(raw) !== requestHash || request.amountCents !== row.amountCents) {
      fail("marketplace_reversal_request_changed");
    }
  }
  private assertOwner(row: Parameters<PrismaMarketplaceTransferReversalRepository["verify"]>[0] & { id: string; refundPlanId: string; payoutId: string | null; residualOperationId: string | null }, operation: MarketplaceTransferReversalOperation) {
    this.verify(row);
    if (row.id !== operation.operationId || row.refundPlanId !== operation.refundPlanId || targetId(row) !== operation.payoutId ||
        (row.residualOperationId ?? undefined) !== operation.residualOperationId ||
        fundingHash(row.request) !== fundingHash(operation.request)) fail("marketplace_reversal_claim_changed");
  }
  private map(row: { id: string; refundPlanId: string; payoutId: string | null; residualOperationId: string | null; hostMerchantId: string; status: string; version: number; request: unknown; providerOperationId: string | null }): MarketplaceTransferReversalOperation {
    return { operationId: row.id, refundPlanId: row.refundPlanId, payoutId: targetId(row), residualOperationId: row.residualOperationId ?? undefined, hostMerchantId: row.hostMerchantId,
      state: row.status as MarketplaceTransferReversalOperation["state"], version: row.version, request: row.request as MarketplaceRefundRequest,
      providerOperationId: row.providerOperationId ?? undefined };
  }
}
