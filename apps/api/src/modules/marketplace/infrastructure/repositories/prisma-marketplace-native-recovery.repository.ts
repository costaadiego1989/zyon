import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import type { MarketplaceNativeRecoveryProof, MarketplaceNativeRecoveryRepository, MarketplaceNativeRecoveryRequest, MarketplaceNativeRecoveryRequestV2 } from "../../domain/ports/marketplace-native-recovery.port.js";
import { buildMarketplaceCumulativeRecoveryEvidence, buildMarketplaceNativeRecoveryCreditEvidence, nativeRecoveryHash, validNativeRecoveryProof, type MarketplaceNativeRecoveryCreditEvidence } from "../../domain/services/marketplace-native-recovery-evidence.js";
import { buildMarketplaceTransferRecoveryCreditEvidence } from "../../domain/services/marketplace-transfer-recovery-evidence.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { buildMarketplaceTransferReversalRequest, readMarketplaceReversalRecoveryForExposure, recordMarketplaceReversalRecoveryEvidence } from "./prisma-marketplace-transfer-reversal.repository.js";
import { readMarketplaceResidualTransferHistory } from "./marketplace-residual-history.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";

function fail(): never { throw new ConflictException("marketplace_native_recovery_unproven"); }
const json = (value: unknown) => value as Prisma.InputJsonValue;

/** A reversal fence is not a buyer submission. Only the exact application marker,
 * with every required reversal already certified V1, can establish that distinction. */
async function assertCanonicalReversalMarkers(tx: Prisma.TransactionClient, host: string, fundingId: string, orderIds: string[]) {
  const markers = await tx.returnRefund.findMany({ where: { OR: [{ paymentIntentId: fundingId },
    { return: { merchantId: host, orderId: { in: orderIds } } }] }, include: { return: true } });
  for (const marker of markers) {
    const plan = await tx.marketplaceRefundPlan.findUnique({ where: { returnId: marker.returnId }, include: { operation: true } });
    if (!plan || plan.fundingPlanId !== fundingId || plan.hostMerchantId !== host || !["blocked", "prepared"].includes(plan.status) ||
      marker.id !== `mrefund_return_${fundingHash(plan.id)}` || marker.paymentIntentId !== fundingId || marker.amountInCents !== plan.amountCents ||
      marker.status !== "PENDING" || marker.providerRefundId || marker.processedAt || marker.return.status !== "INSPECTED_PASS" ||
      marker.return.merchantId !== host || !orderIds.includes(marker.return.orderId) ||
      plan.operation && (plan.operation.status !== "planned" || plan.operation.claimedAt || plan.operation.providerOperationId)) fail();
    const context = await readMarketplaceReversalRecoveryForExposure(tx, host, plan.id);
    const rows = await tx.marketplaceTransferReversal.findMany({ where: { refundPlanId: plan.id }, include: { payout: true, recoveryCredit: true } });
    if (!rows.length || rows.length !== context.required.length) fail();
    for (const row of rows) {
      const payout = row.payout, credit = row.recoveryCredit, amount = context.required.find(value => value.payoutId === row.payoutId)?.amountCents;
      if (!payout || row.residualOperationId || !payout.providerTransferId || !payout.beneficiaryMerchantId || !amount || amount !== row.amountCents ||
        !credit || credit.reversalId !== row.id || credit.providerOperationId !== row.providerOperationId || credit.amountCents !== amount ||
        credit.payoutId !== payout.id || credit.fundingPlanId !== fundingId || credit.hostMerchantId !== host ||
        credit.beneficiaryMerchantId !== payout.beneficiaryMerchantId || credit.provider !== "stripe" || credit.providerTransferId !== payout.providerTransferId ||
        credit.accountFingerprint !== payout.accountFingerprint ||
        row.hostMerchantId !== host || row.provider !== "stripe" || row.accountFingerprint !== payout.accountFingerprint) fail();
      const expectedRequest = buildMarketplaceTransferReversalRequest(context, payout.id, amount);
      if (row.requestHash !== expectedRequest.requestHash || row.reference !== expectedRequest.reference ||
        fundingHash(expectedRequest) !== fundingHash(row.request)) fail();
      const expected = buildMarketplaceTransferRecoveryCreditEvidence({ fundingPlanId: fundingId, hostMerchantId: host,
        instructionsHash: context.funding.instructionsHash, budgetHash: fundingHash(context.budget), chargebackAt: context.ledger.chargebackAt!.toISOString(),
        target: { kind: "original", id: payout.id, beneficiaryMerchantId: payout.beneficiaryMerchantId, provider: "stripe", accountFingerprint: payout.accountFingerprint,
          providerPaymentId: payout.providerPaymentId, providerTransferId: payout.providerTransferId, reference: payout.reference, destination: payout.destination, amountCents: payout.amountCents },
        reversals: [{ reversalId: row.id, refundPlanId: row.refundPlanId, requestHash: row.requestHash, providerOperationId: row.providerOperationId!, amountCents: row.amountCents,
          status: row.status, claimedAt: row.claimedAt, reconciledAt: row.reconciledAt, buyerStatus: plan.status, buyerOperationStatus: plan.operation?.status ?? null,
          buyerClaimedAt: plan.operation?.claimedAt ?? null, buyerReceipt: plan.operation?.providerOperationId ?? null }] });
      if (!expected || fundingHash(expected) !== credit.evidenceHash || fundingHash(credit.evidence) !== credit.evidenceHash) fail();
    }
  }
}

/** Shared read-only reconstruction; takes the same order lock as refunds and credits. */
export async function readMarketplaceNativeRecoveryRequest(tx: Prisma.TransactionClient, host: string, payoutId: string): Promise<MarketplaceNativeRecoveryRequest> {
  const initial = await tx.marketplacePayout.findFirst({ where: { id: payoutId, fundingPlan: { hostMerchantId: host } } });
  if (!initial?.fundingPlanId || !await tx.paymentIntent.findFirst({ where: { id: initial.fundingPlanId, merchantId: host }, select: { id: true } })) fail();
  await lockMarketplaceOrder(tx, host, initial.providerPaymentId);
  const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: initial.fundingPlanId, hostMerchantId: host } });
  const payment = await tx.paymentIntent.findFirst({ where: { id: initial.fundingPlanId, merchantId: host } });
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: host, orderId: initial.providerPaymentId } } });
  if (!funding || funding.provider !== "stripe" || funding.status !== "held" || !funding.budget || !funding.providerPaymentId ||
    !payment || !(payment.status === "approved" || payment.status.startsWith("chargeback_")) || payment.providerPaymentId !== funding.providerPaymentId ||
    payment.currency !== "BRL" || payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents || !ledger?.purchasedAt || !ledger.chargebackAt) fail();
  const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
  if (instructions.provider !== "stripe" || instructions.hostMerchantId !== host || instructions.environment !== funding.environment ||
    instructions.accountFingerprint !== funding.accountFingerprint || fundingHash(instructions) !== funding.instructionsHash ||
    fundingHash((payment.creation as any)?.input?.marketplaceFunding) !== funding.instructionsHash ||
    fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
    budget.capture.providerPaymentId !== funding.providerPaymentId || budget.capture.amountCents !== funding.amountCents ||
    budget.capture.providerFeeCents !== funding.providerFeeCents || budget.capture.netAmountCents !== funding.netAmountCents ||
    budget.payoutTotalCents !== funding.payoutTotalCents || budget.platformRetainedCents !== funding.platformRetainedCents) fail();
  if (await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: funding.paymentIntentId } })) fail();
  const completed = await tx.completedOrder.findMany({ where: { merchantId: host, OR: [
    { externalOrderId: { in: [funding.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])] } },
    { sessionId: payment.sessionId }], }, select: { id: true, externalOrderId: true } });
  const orderIds = [funding.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : []),
    ...completed.flatMap(row => [row.id, ...(row.externalOrderId ? [row.externalOrderId] : [])])];
  const refunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operation: true } });
  if (refunds.some(row => !["blocked", "prepared"].includes(row.status) || row.operation &&
    (row.operation.status !== "planned" || row.operation.claimedAt || row.operation.providerOperationId)) ||
    await tx.return.count({ where: { merchantId: host, orderId: { in: orderIds }, status: { in: ["REFUND_PROCESSING", "REFUND_COMPLETED"] } } })) fail();
  await assertCanonicalReversalMarkers(tx, host, funding.paymentIntentId, orderIds);
  const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { settlement: true } });
  const expected = fundingTransferAllocations(instructions, budget);
  if (expected.length !== payouts.length || payouts.reduce((sum, row) => sum + row.amountCents, 0) !== budget.payoutTotalCents || payouts.some(row => {
    const match = expected.find(value => value.lineItemId === (row.settlement?.lineItemId ?? null) && value.merchantId === row.beneficiaryMerchantId);
    return !match || row.kind !== match.kind || row.amountCents !== match.amountCents || row.provider !== "stripe" ||
      row.accountFingerprint !== funding.accountFingerprint || row.providerPaymentId !== funding.providerPaymentId || row.currency !== "BRL" ||
      row.destination !== instructions.destinations.find(value => value.merchantId === row.beneficiaryMerchantId)?.destination;
  })) fail();
  const target = payouts.find(row => row.id === payoutId);
  if (!target || target.status !== "confirmed" || !target.providerTransferId || !target.beneficiaryMerchantId || !target.claimedAt || !target.reconciledAt ||
    target.settlement && (!['transferred', 'finalized', 'chargeback_debt'].includes(target.settlement.status) || target.settlement.providerTransferId !== target.providerTransferId)) fail();
  const reversals = await tx.marketplaceTransferReversal.findMany({ where: { payoutId }, orderBy: { id: "asc" } });
  const knownReversals: MarketplaceNativeRecoveryRequest["knownReversals"] = [];
  for (const row of reversals) {
    if (row.status !== "confirmed" || !row.providerOperationId || !row.claimedAt || !row.reconciledAt) fail();
    const context = await readMarketplaceReversalRecoveryForExposure(tx, host, row.refundPlanId);
    const amount = context.required.find(value => value.payoutId === payoutId)?.amountCents;
    if (!amount || amount !== row.amountCents || context.funding.paymentIntentId !== funding.paymentIntentId ||
      fundingHash(buildMarketplaceTransferReversalRequest(context, payoutId, amount)) !== fundingHash(row.request)) fail();
    knownReversals.push({ providerOperationId: row.providerOperationId, amountCents: row.amountCents, reference: row.reference, requestHash: row.requestHash });
  }
  const raw = { version: 1 as const, fundingPlanId: funding.paymentIntentId, hostMerchantId: host, instructionsHash: funding.instructionsHash,
    budgetHash: fundingHash(budget), chargebackAt: ledger.chargebackAt.toISOString(), environment: instructions.environment,
    sourceId: budget.capture.sourceId, paymentAmountCents: funding.amountCents, target: { kind: "original" as const, id: target.id,
      beneficiaryMerchantId: target.beneficiaryMerchantId, provider: "stripe" as const, accountFingerprint: funding.accountFingerprint,
      providerPaymentId: funding.providerPaymentId, providerTransferId: target.providerTransferId, reference: target.reference,
      destination: target.destination, amountCents: target.amountCents }, knownReversals };
  return { ...raw, requestHash: nativeRecoveryHash(raw) };
}

/** The old zero-refund request remains unchanged. Residuals need their complete
 * immutable generation and buyer-refund history, never a guessed net balance. */
export async function readMarketplaceResidualNativeRecoveryRequest(tx: Prisma.TransactionClient, host: string, operationId: string): Promise<MarketplaceNativeRecoveryRequestV2> {
  const initial = await tx.marketplaceResidualOperation.findFirst({ where: { id: operationId, residualPlan: { hostMerchantId: host } }, include: { residualPlan: true } });
  if (!initial) fail();
  const before = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: initial.residualPlan.fundingPlanId, hostMerchantId: host } });
  if (!before?.providerPaymentId) fail();
  await lockMarketplaceOrder(tx, host, before.providerPaymentId);
  const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: before.paymentIntentId, hostMerchantId: host } });
  const payment = await tx.paymentIntent.findFirst({ where: { id: before.paymentIntentId, merchantId: host } });
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: host, orderId: before.providerPaymentId } } });
  if (!funding || funding.provider !== "stripe" || funding.status !== "held" || !funding.budget || !funding.providerPaymentId || funding.providerPaymentId !== before.providerPaymentId ||
    !payment || !(payment.status === "approved" || payment.status.startsWith("chargeback_")) || payment.providerPaymentId !== funding.providerPaymentId ||
    payment.currency !== "BRL" || payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents || !ledger?.purchasedAt || !ledger.chargebackAt) fail();
  const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
  if (instructions.provider !== "stripe" || instructions.hostMerchantId !== host || instructions.environment !== funding.environment ||
    instructions.accountFingerprint !== funding.accountFingerprint || fundingHash(instructions) !== funding.instructionsHash ||
    fundingHash((payment.creation as any)?.input?.marketplaceFunding) !== funding.instructionsHash ||
    fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) || budget.capture.providerPaymentId !== funding.providerPaymentId ||
    budget.capture.accountFingerprint !== funding.accountFingerprint || budget.capture.amountCents !== funding.amountCents ||
    budget.capture.providerFeeCents !== funding.providerFeeCents || budget.capture.netAmountCents !== funding.netAmountCents ||
    budget.payoutTotalCents !== funding.payoutTotalCents || budget.platformRetainedCents !== funding.platformRetainedCents) fail();
  const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { settlement: true }, take: 2001 });
  const expected = fundingTransferAllocations(instructions, budget);
  if (payouts.length > 2000 || expected.length !== payouts.length || new Set(payouts.map(row => JSON.stringify([row.settlement?.lineItemId ?? null, row.beneficiaryMerchantId]))).size !== payouts.length ||
    payouts.some(row => { const allocation = expected.find(value => value.lineItemId === (row.settlement?.lineItemId ?? null) && value.merchantId === row.beneficiaryMerchantId);
      return !allocation || row.kind !== allocation.kind || row.amountCents !== allocation.amountCents || row.provider !== "stripe" ||
        row.accountFingerprint !== funding.accountFingerprint || row.providerPaymentId !== funding.providerPaymentId || row.currency !== "BRL" ||
        row.destination !== instructions.destinations.find(value => value.merchantId === row.beneficiaryMerchantId)?.destination ||
        row.status === "confirmed" && row.settlement && (!['transferred', 'finalized', 'chargeback_debt'].includes(row.settlement.status) || row.settlement.providerTransferId !== row.providerTransferId);
    })) fail();
  const allRefunds = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operation: true }, take: 2001 });
  if (allRefunds.length > 2000 || allRefunds.some(row => row.hostMerchantId !== host || !["confirmed", "blocked", "prepared"].includes(row.status) ||
    row.status !== "confirmed" && row.operation && (row.operation.status !== "planned" || row.operation.claimedAt || row.operation.providerOperationId))) fail();
  const confirmed = allRefunds.filter(row => row.status === "confirmed").sort((a, b) =>
    (a.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents - (b.allocation as unknown as MarketplaceRefundAllocation).cumulativeRefundCents ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (!confirmed.length) fail();
  const plans = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId: funding.paymentIntentId }, include: { operations: true }, orderBy: { generation: "asc" }, take: 2001 });
  if (!plans.length || plans.length > 2000 || plans.reduce((sum, row) => sum + row.operations.length, 0) > 2000) fail();
  const allReversals = await tx.marketplaceTransferReversal.findMany({ where: { OR: [{ refundPlan: { fundingPlanId: funding.paymentIntentId } },
    { payout: { fundingPlanId: funding.paymentIntentId } }, { residualOperation: { residualPlan: { fundingPlanId: funding.paymentIntentId } } }] },
    include: { refundPlan: { include: { operation: true } } }, orderBy: { id: "asc" }, take: 2001 });
  if (allReversals.length > 2000 || allReversals.some(row => row.hostMerchantId !== host || row.provider !== "stripe" || row.accountFingerprint !== funding.accountFingerprint ||
    row.status !== "confirmed" || !row.claimedAt || !row.reconciledAt || !row.providerOperationId)) fail();
  const history = await readMarketplaceResidualTransferHistory(tx, { funding, instructions, budget, payouts, refunds: confirmed, priorGenerations: plans, allowDisputeHeld: true });
  const plan = plans.find(row => row.operations.some(operation => operation.id === operationId)), target = plan?.operations.find(row => row.id === operationId);
  const transfer = history.transfers.find(row => row.kind === "residual" && row.payoutId === operationId);
  if (!plan || !target || !transfer || plan.status !== "held" || plan.heldReason !== "marketplace_residual_dispute_requires_reconciliation" ||
    target.status !== "confirmed" || !target.claimedAt || !target.reconciledAt || !target.providerTransferId || !target.beneficiaryMerchantId ||
    target.requestHash !== transfer.requestHash) fail();
  // These cents have already left for the buyer. They cannot be reserved again
  // even when the provider's gross amount_reversed reaches the whole transfer.
  const rows = allReversals.filter(row => row.residualOperationId === operationId);
  if (rows.some(row => row.refundPlan.status === "confirmed" || row.refundPlan.operation &&
    (row.refundPlan.operation.status !== "planned" || row.refundPlan.operation.claimedAt || row.refundPlan.operation.providerOperationId))) fail();
  const completed = await tx.completedOrder.findMany({ where: { merchantId: host, OR: [
    { externalOrderId: { in: [funding.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : [])] } },
    { sessionId: payment.sessionId }] }, select: { id: true, externalOrderId: true }, take: 2001 });
  if (completed.length > 2000) fail();
  const orderIds = [funding.providerPaymentId, ...(payment.commerceOrderId ? [payment.commerceOrderId] : []),
    ...completed.flatMap(row => [row.id, ...(row.externalOrderId ? [row.externalOrderId] : [])])];
  const returns = await tx.return.findMany({ where: { merchantId: host, orderId: { in: orderIds } }, select: { id: true, status: true }, take: 2001 });
  if (returns.length > 2000 || returns.some(row => !["REJECTED", "CANCELLED"].includes(row.status) && !allRefunds.some(refund => refund.returnId === row.id))) fail();
  await assertResidualReversalMarkers(tx, host, funding.paymentIntentId, orderIds, confirmed.map(row => row.id), allRefunds.filter(row => row.status !== "confirmed").map(row => row.id));
  const knownReversals: MarketplaceNativeRecoveryRequest["knownReversals"] = [];
  for (const row of rows) {
    const context = await readMarketplaceReversalRecoveryForExposure(tx, host, row.refundPlanId);
    const amount = context.required.find(value => value.payoutId === operationId)?.amountCents;
    if (!amount || row.payoutId || amount !== row.amountCents || context.funding.paymentIntentId !== funding.paymentIntentId ||
      row.reference !== buildMarketplaceTransferReversalRequest(context, operationId, amount).reference ||
      row.requestHash !== buildMarketplaceTransferReversalRequest(context, operationId, amount).requestHash ||
      fundingHash(buildMarketplaceTransferReversalRequest(context, operationId, amount)) !== fundingHash(row.request)) fail();
    knownReversals.push({ providerOperationId: row.providerOperationId!, amountCents: row.amountCents, reference: row.reference, requestHash: row.requestHash });
  }
  const refunds = confirmed.map(row => ({ refundPlanId: row.id, returnId: row.returnId, allocationHash: row.allocationHash,
    requestHash: row.operation!.requestHash, reference: row.operation!.reference, providerOperationId: row.operation!.providerOperationId!, amountCents: row.amountCents }));
  const generations = plans.map(row => ({ residualPlanId: row.id, generation: row.generation, basisHash: row.basisHash, allocationHash: row.allocationHash }));
  const raw = { version: 2 as const, fundingPlanId: funding.paymentIntentId, hostMerchantId: host, instructionsHash: funding.instructionsHash,
    budgetHash: fundingHash(budget), chargebackAt: ledger.chargebackAt.toISOString(), environment: instructions.environment, sourceId: budget.capture.sourceId,
    paymentAmountCents: funding.amountCents, target: { kind: "residual" as const, id: target.id, beneficiaryMerchantId: target.beneficiaryMerchantId,
      provider: "stripe" as const, accountFingerprint: funding.accountFingerprint, providerPaymentId: funding.providerPaymentId,
      providerTransferId: target.providerTransferId, reference: target.reference, destination: transfer.destination, amountCents: target.amountCents, requestHash: target.requestHash },
    residualPlan: { id: plan.id, generation: plan.generation, basisHash: plan.basisHash, allocationHash: plan.allocationHash },
    refunds, generations, historyHash: nativeRecoveryHash({ refunds, generations }), knownReversals };
  return { ...raw, requestHash: nativeRecoveryHash(raw) };
}

async function assertResidualReversalMarkers(tx: Prisma.TransactionClient, host: string, fundingId: string, orderIds: string[], confirmedIds: string[], unsubmittedIds: string[]) {
  const markers = await tx.returnRefund.findMany({ where: { OR: [{ paymentIntentId: fundingId }, { return: { merchantId: host, orderId: { in: orderIds } } }] }, include: { return: true }, take: 2001 });
  if (markers.length > 2000) fail();
  const provenPlans = new Set<string>();
  for (const marker of markers) {
    const plan = await tx.marketplaceRefundPlan.findUnique({ where: { returnId: marker.returnId }, include: { operation: true } });
    if (!plan || plan.fundingPlanId !== fundingId || plan.hostMerchantId !== host || marker.return.merchantId !== host || !orderIds.includes(marker.return.orderId) ||
      marker.id !== `mrefund_return_${fundingHash(plan.id)}` || marker.paymentIntentId !== fundingId || marker.amountInCents !== plan.amountCents) fail();
    if (plan.status === "confirmed") {
      if (!confirmedIds.includes(plan.id) || marker.status !== "COMPLETED" || marker.return.status !== "REFUND_COMPLETED" ||
        !plan.operation?.providerOperationId || marker.providerRefundId !== plan.operation.providerOperationId) fail();
      continue;
    }
    if (!["blocked", "prepared"].includes(plan.status) || marker.status !== "PENDING" || marker.providerRefundId || marker.processedAt || marker.return.status !== "INSPECTED_PASS" ||
      plan.operation && (plan.operation.status !== "planned" || plan.operation.claimedAt || plan.operation.providerOperationId)) fail();
    const context = await readMarketplaceReversalRecoveryForExposure(tx, host, plan.id);
    const rows = await tx.marketplaceTransferReversal.findMany({ where: { refundPlanId: plan.id }, include: { payout: true, residualOperation: true, recoveryCredit: true } });
    if (!rows.length || rows.length !== context.required.length) fail();
    for (const row of rows) {
      const target = row.payout ?? row.residualOperation, credit = row.recoveryCredit, binding = context.payouts.find(value => value.id === target?.id);
      const amount = context.required.find(value => value.payoutId === target?.id)?.amountCents;
      if (!target || !binding || !credit || !amount || !target.beneficiaryMerchantId || !target.providerTransferId ||
        Boolean(row.payoutId) === Boolean(row.residualOperationId) || credit.reversalId !== row.id || credit.providerOperationId !== row.providerOperationId ||
        credit.amountCents !== amount || credit.payoutId !== row.payoutId || credit.residualOperationId !== row.residualOperationId ||
        credit.fundingPlanId !== fundingId || credit.hostMerchantId !== host || credit.beneficiaryMerchantId !== target.beneficiaryMerchantId ||
        credit.provider !== "stripe" || credit.accountFingerprint !== target.accountFingerprint || credit.providerTransferId !== target.providerTransferId ||
        row.hostMerchantId !== host || row.provider !== "stripe" || row.accountFingerprint !== target.accountFingerprint) fail();
      const request = buildMarketplaceTransferReversalRequest(context, target.id, amount);
      if (row.amountCents !== amount || row.requestHash !== request.requestHash || row.reference !== request.reference || fundingHash(row.request) !== fundingHash(request)) fail();
      const expected = buildMarketplaceTransferRecoveryCreditEvidence({ fundingPlanId: fundingId, hostMerchantId: host,
        instructionsHash: context.funding.instructionsHash, budgetHash: fundingHash(context.budget), chargebackAt: context.ledger.chargebackAt!.toISOString(),
        target: { kind: row.payout ? "original" : "residual", id: target.id, beneficiaryMerchantId: target.beneficiaryMerchantId, provider: "stripe",
          accountFingerprint: target.accountFingerprint, providerPaymentId: context.funding.providerPaymentId!, providerTransferId: target.providerTransferId,
          reference: binding.reference, destination: binding.destination, amountCents: target.amountCents,
          ...(row.residualOperation ? { requestHash: row.residualOperation.requestHash } : {}) },
        reversals: [{ reversalId: row.id, refundPlanId: row.refundPlanId, requestHash: row.requestHash, providerOperationId: row.providerOperationId!, amountCents: row.amountCents,
          status: row.status, claimedAt: row.claimedAt, reconciledAt: row.reconciledAt, buyerStatus: plan.status, buyerOperationStatus: plan.operation?.status ?? null,
          buyerClaimedAt: plan.operation?.claimedAt ?? null, buyerReceipt: plan.operation?.providerOperationId ?? null }] });
      if (!expected || fundingHash(expected) !== credit.evidenceHash || fundingHash(credit.evidence) !== credit.evidenceHash) fail();
    }
    provenPlans.add(plan.id);
  }
  if (unsubmittedIds.some(id => !provenPlans.has(id))) fail();
}

/** Reconstruct a persisted native or legacy credit; no provider/network access. */
export async function validateMarketplaceNativeRecoveryCredits(tx: Prisma.TransactionClient, request: MarketplaceNativeRecoveryRequest) {
  const credits = await tx.marketplaceTransferRecoveryCredit.findMany({ where: request.version === 1 ? { payoutId: request.target.id } : { residualOperationId: request.target.id }, orderBy: { id: "asc" } });
  for (const credit of credits) {
    if (credit.fundingPlanId !== request.fundingPlanId || credit.hostMerchantId !== request.hostMerchantId || credit.beneficiaryMerchantId !== request.target.beneficiaryMerchantId ||
      (request.version === 1 ? credit.payoutId !== request.target.id || !!credit.residualOperationId : credit.residualOperationId !== request.target.id || !!credit.payoutId) ||
      credit.provider !== "stripe" || credit.accountFingerprint !== request.target.accountFingerprint ||
      credit.providerTransferId !== request.target.providerTransferId || fundingHash(credit.evidence) !== credit.evidenceHash) fail();
    if (credit.reversalId) {
      const row = await tx.marketplaceTransferReversal.findUniqueOrThrow({ where: { id: credit.reversalId }, include: { refundPlan: { include: { operation: true } } } });
      if (!request.knownReversals.some(known => known.providerOperationId === credit.providerOperationId && known.amountCents === credit.amountCents) ||
        (request.version === 1 ? row.payoutId !== request.target.id || !!row.residualOperationId : row.residualOperationId !== request.target.id || !!row.payoutId) ||
        row.providerOperationId !== credit.providerOperationId) fail();
      const expected = buildMarketplaceTransferRecoveryCreditEvidence({ fundingPlanId: request.fundingPlanId, hostMerchantId: request.hostMerchantId,
        instructionsHash: request.instructionsHash, budgetHash: request.budgetHash, chargebackAt: request.chargebackAt, target: request.target,
        reversals: [{ reversalId: row.id, refundPlanId: row.refundPlanId, requestHash: row.requestHash, providerOperationId: row.providerOperationId!, amountCents: row.amountCents,
          status: row.status, claimedAt: row.claimedAt, reconciledAt: row.reconciledAt, buyerStatus: row.refundPlan.status,
          buyerOperationStatus: row.refundPlan.operation?.status ?? null, buyerClaimedAt: row.refundPlan.operation?.claimedAt ?? null, buyerReceipt: row.refundPlan.operation?.providerOperationId ?? null }] });
      if (!expected || fundingHash(expected) !== credit.evidenceHash) fail();
    } else {
      const evidence = credit.evidence as unknown as MarketplaceNativeRecoveryCreditEvidence;
      const expected = evidence.proof && buildMarketplaceNativeRecoveryCreditEvidence(evidence.proof, credit.providerOperationId);
      if (!expected || expected.receipt.amountCents !== credit.amountCents || nativeRecoveryHash(expected) !== credit.evidenceHash ||
        nativeRecoveryHash(evidence.proof.request) !== nativeRecoveryHash(request)) fail();
    }
  }
  if (credits.reduce((sum, row) => sum + row.amountCents, 0) > request.target.amountCents) fail();
  return credits;
}

@Injectable()
export class PrismaMarketplaceNativeRecoveryRepository implements MarketplaceNativeRecoveryRepository {
  constructor(private readonly prisma: PrismaClient) {}
  async prepare(host: string, payoutId: string) {
    try { return await this.prisma.$transaction(tx => readMarketplaceNativeRecoveryRequest(tx, host, payoutId)); }
    catch (error) { if (error instanceof ConflictException) return undefined; throw error; }
  }
  async prepareResidual(host: string, residualOperationId: string) {
    try { return await this.prisma.$transaction(tx => readMarketplaceResidualNativeRecoveryRequest(tx, host, residualOperationId)); }
    catch (error) { if (error instanceof ConflictException) return undefined; throw error; }
  }
  async record(request: MarketplaceNativeRecoveryRequest, proof: MarketplaceNativeRecoveryProof): Promise<"partial" | "confirmed" | "blocked"> {
    if (!validNativeRecoveryProof(request, proof) || Math.abs(Date.now() - Date.parse(proof.observedAt)) > 300_000) return "blocked";
    return this.prisma.$transaction(async tx => {
      const current = request.version === 1 ? await readMarketplaceNativeRecoveryRequest(tx, request.hostMerchantId, request.target.id) :
        await readMarketplaceResidualNativeRecoveryRequest(tx, request.hostMerchantId, request.target.id);
      if (nativeRecoveryHash(current) !== nativeRecoveryHash(request) || Math.abs(Date.now() - Date.parse(proof.observedAt)) > 300_000) return "blocked";
      if (request.version === 1) await recordMarketplaceReversalRecoveryEvidence(tx, request.hostMerchantId, request.fundingPlanId);
      const before = await validateMarketplaceNativeRecoveryCredits(tx, current);
      if (before.some(credit => !proof.receipts.some(receipt => receipt.providerOperationId === credit.providerOperationId && receipt.amountCents === credit.amountCents))) return "blocked";
      for (const receipt of proof.receipts) {
        if (before.some(credit => credit.providerOperationId === receipt.providerOperationId)) continue;
        const evidence = buildMarketplaceNativeRecoveryCreditEvidence(proof, receipt.providerOperationId);
        if (!evidence) fail();
        const evidenceHash = nativeRecoveryHash(evidence);
        const credit = await tx.marketplaceTransferRecoveryCredit.create({ data: { fundingPlanId: request.fundingPlanId, hostMerchantId: request.hostMerchantId,
          beneficiaryMerchantId: request.target.beneficiaryMerchantId, ...(request.version === 1 ? { payoutId: request.target.id } : { residualOperationId: request.target.id }),
          provider: "stripe", accountFingerprint: request.target.accountFingerprint,
          providerTransferId: request.target.providerTransferId, providerOperationId: receipt.providerOperationId, amountCents: receipt.amountCents, evidence: json(evidence), evidenceHash } });
        await tx.outboxMessage.create({ data: { eventId: `marketplace_transfer_recovery_credit_${credit.id}`, eventType: "marketplace.transfer_recovery_credit.confirmed", schemaVersion: 1,
          merchantId: request.hostMerchantId, occurredAt: credit.createdAt, correlationId: request.fundingPlanId, causationId: receipt.providerOperationId, producer: "marketplace",
          payload: { recovery_credit_id: credit.id, funding_plan_id: request.fundingPlanId, beneficiary_merchant_id: request.target.beneficiaryMerchantId,
            target_kind: request.target.kind, target_id: request.target.id, reversal_id: null, source: "provider_reconciliation", amount_cents: receipt.amountCents, evidence_hash: evidenceHash } } });
      }
      const credits = await validateMarketplaceNativeRecoveryCredits(tx, current);
      const evidence = buildMarketplaceCumulativeRecoveryEvidence(current, credits.map(row => ({ creditId: row.id, evidenceHash: row.evidenceHash, providerOperationId: row.providerOperationId, amountCents: row.amountCents })));
      if (!evidence) return "partial";
      const existing = await tx.marketplaceTransferRecovery.findUnique({ where: request.version === 1 ? { payoutId: request.target.id } : { residualOperationId: request.target.id } });
      const recovery = existing ?? await tx.marketplaceTransferRecovery.create({ data: { fundingPlanId: request.fundingPlanId, hostMerchantId: request.hostMerchantId,
        beneficiaryMerchantId: request.target.beneficiaryMerchantId, ...(request.version === 1 ? { payoutId: request.target.id } : { residualOperationId: request.target.id }),
        provider: "stripe", accountFingerprint: request.target.accountFingerprint,
        providerTransferId: request.target.providerTransferId, amountCents: request.target.amountCents, evidence: json(evidence), evidenceHash: nativeRecoveryHash(evidence) } });
      if (existing && (existing.evidence as any)?.version !== 1 && existing.evidenceHash !== nativeRecoveryHash(evidence)) fail();
      if (request.version === 1) {
        const payout = await tx.marketplacePayout.findUniqueOrThrow({ where: { id: request.target.id } });
        if (payout.settlementId) await tx.marketplaceSellerDebt.updateMany({ where: { settlementId: payout.settlementId, sellerMerchantId: request.target.beneficiaryMerchantId,
          amountCents: request.target.amountCents, status: "outstanding" }, data: { status: "resolved", resolvedAt: new Date(), recoveryId: recovery.id } });
        else await tx.marketplaceHostDebt.updateMany({ where: { payoutId: payout.id, hostMerchantId: request.target.beneficiaryMerchantId,
          amountCents: request.target.amountCents, status: "outstanding" }, data: { status: "resolved", resolvedAt: new Date(), recoveryId: recovery.id } });
      }
      await tx.outboxMessage.upsert({ where: { eventId: `marketplace_transfer_recovery_${recovery.id}` }, update: {}, create: {
        eventId: `marketplace_transfer_recovery_${recovery.id}`, eventType: "marketplace.transfer_recovery.confirmed", schemaVersion: 1, merchantId: request.hostMerchantId,
        occurredAt: recovery.createdAt, correlationId: request.fundingPlanId, causationId: request.target.id, producer: "marketplace", payload: {
          recovery_id: recovery.id, funding_plan_id: request.fundingPlanId, beneficiary_merchant_id: request.target.beneficiaryMerchantId,
          target_kind: request.target.kind, target_id: request.target.id, amount_cents: request.target.amountCents, evidence_hash: recovery.evidenceHash } } });
      return "confirmed";
    });
  }
}
