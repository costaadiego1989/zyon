import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { AsaasMarketplaceWalletReturnAuthorizationReader, AsaasMarketplaceWalletReturnObservation,
  AsaasMarketplaceWalletReturnRequest } from "../../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import type { AsaasMarketplaceResidualBasis, AsaasMarketplaceResidualAllocation } from "../../domain/services/asaas-marketplace-residual.js";
import type { AsaasMarketplaceHostRetentionAllocation } from "../../domain/ports/asaas-marketplace-host-retention.port.js";
import { allocateAsaasMarketplacePostResidualRefund } from "../../domain/services/asaas-marketplace-residual-wallet-return.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import { buildMarketplaceResidualAllocation } from "../../domain/services/marketplace-residual-allocation.js";
import { fundingHash, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { readConfirmedAsaasMarketplaceRefundHistory } from "./asaas-marketplace-refund-history.js";
import { hasMarketplaceRecoveryExposure } from "./marketplace-recovery-exposure.js";
import { validAsaasMarketplaceWalletReturnRequest } from "../asaas-marketplace-transfer-recovery.adapter.js";
import { validAsaasMarketplaceWalletReturnProof, type AsaasWalletReturnActor,
  type AsaasWalletReturnJournal } from "./prisma-asaas-marketplace-wallet-return.repository.js";
import { decryptPaymentSecret } from "../../../payment/infrastructure/payment-secret-cipher.js";
import { marketplaceCaptureAccount } from "../marketplace-capture-account.js";

const fail = (): never => { throw new ConflictException("marketplace_asaas_residual_wallet_return_unavailable"); };
const id = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v);
export interface AsaasResidualWalletReturnJournal extends Omit<AsaasWalletReturnJournal, "payout_id"> {
  residual_plan_id: string; residual_operation_id: string;
}
export interface CertifiedAsaasResidualWalletReturn {
  id: string; residualPlanId: string; residualOperationId: string; certificateHash: string;
  request: AsaasMarketplaceWalletReturnRequest; proof: NonNullable<AsaasWalletReturnJournal["proof"]>;
}
export const asaasResidualWalletReturnEventId = (journalId: string) => `marketplace_asaas_residual_wallet_return_${journalId}`;
export const asaasResidualWalletReturnPayload = (row: AsaasResidualWalletReturnJournal) => ({ journal_id: row.id,
  funding_plan_id: row.funding_plan_id, refund_plan_id: row.refund_plan_id, residual_plan_id: row.residual_plan_id,
  residual_operation_id: row.residual_operation_id, amount_cents: row.amount_cents, certificate_hash: row.certificate_hash });
export function validateAsaasResidualWalletReturnJournal(row: AsaasResidualWalletReturnJournal): void {
  const r = row.request;
  if (!validAsaasMarketplaceWalletReturnRequest(r) || r.version !== 2 || !r.residual ||
      row.id !== `awresreturn_${fundingHash([r.refundPlanId, r.residual.operationId])}` ||
      r.requestHash !== row.request_hash || r.reference !== row.reference || r.host.merchantId !== row.host_merchant_id ||
      r.seller.merchantId !== row.seller_merchant_id || r.authorization.actorId !== row.actor_id ||
      r.refundPlanId !== row.refund_plan_id || r.fundingPlanId !== row.funding_plan_id ||
      r.residual.planId !== row.residual_plan_id || r.residual.operationId !== row.residual_operation_id || r.amountCents !== row.amount_cents ||
      row.status === "returned" && (!row.proof || !validAsaasMarketplaceWalletReturnProof(r, row.proof) ||
        row.provider_return_transfer_id !== row.proof.providerTransferId || row.certificate_hash !== fundingHash({ request: r, proof: row.proof }))) fail();
}

/** Read-only certificate used before creating the successor refund. The
 * existing native evidence function proves ONLY its immutable basis prefix;
 * this helper separately requires the complete current prefix to be exact. */
export async function readAsaasMarketplaceCompletedResidualGenerationHistory(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string) {
  const funding = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: fundingPlanId, hostMerchantId } });
  if (!funding?.providerPaymentId || funding.provider !== "asaas" || funding.status !== "held" || !funding.budget) fail();
  await lockMarketplaceOrder(tx, hostMerchantId, funding!.providerPaymentId!);
  const payment = await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId } });
  const instructions = funding!.instructions as unknown as FrozenMarketplaceFunding, budget = funding!.budget as unknown as FundingBudget;
  if (!payment || payment.status !== "approved" || !["pix", "card"].includes(payment.method) ||
      fundingHash(instructions) !== funding!.instructionsHash ||
      fundingHash((payment.creation as { input?: { marketplaceFunding?: unknown } } | null)?.input?.marketplaceFunding) !== funding!.instructionsHash ||
      fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget)) fail();
  const generations = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId }, include: { operations: true } });
  if (generations.length !== 1) fail();
  const plan = generations[0]!, basis = plan.basis as unknown as Omit<AsaasMarketplaceResidualBasis, "version"> & { version: 5 | 7 },
    previous = plan.allocation as unknown as AsaasMarketplaceResidualAllocation | AsaasMarketplaceHostRetentionAllocation;
  if (plan.hostMerchantId !== hostMerchantId || plan.generation !== 1 || plan.status !== "completed" || plan.heldReason ||
      ![5, 7].includes(basis.version) || basis.version !== previous.version || fundingHash(basis) !== plan.basisHash ||
      fundingHash(previous) !== plan.allocationHash || basis.instructionsHash !== funding!.instructionsHash ||
      basis.budgetHash !== fundingHash(budget) || basis.fundingPlanId !== fundingPlanId ||
      !plan.operations.length || plan.operations.some(op => op.provider !== "asaas" || op.status !== "confirmed" || !op.claimedAt || !op.reconciledAt || !op.providerTransferId)) fail();
  const certified = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT marketplace_asaas_residual_evidence_valid(${plan.id}) AS valid`;
  if (certified.length !== 1 || certified[0].valid !== true) fail();
  const history = await readConfirmedAsaasMarketplaceRefundHistory(tx, hostMerchantId, fundingPlanId, budget.capture);
  const all = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId } });
  if (all.length !== history.rows.length || all.some(r => r.hostMerchantId !== hostMerchantId || r.status !== "confirmed") ||
      fundingHash(history.rows.map(r => ({ refundPlanId: r.id, returnId: r.returnId, allocationHash: r.allocationHash,
        requestHash: r.operation!.requestHash, providerOperationId: r.operation!.providerOperationId!, amountCents: r.amountCents }))) !== fundingHash(basis.refunds)) fail();
  const replayed = buildMarketplaceResidualAllocation(budget, history.allocations);
  if (replayed.refundedCents !== previous.refundedCents || replayed.platformRetainedCents !== previous.platformRetainedCents ||
      replayed.payoutTotalCents !== previous.payoutTotalCents || fundingHash(replayed.beneficiaries) !== fundingHash(previous.beneficiaries)) fail();
  return { funding: funding!, payment: payment!, instructions, budget, plan, basis, previous, history };
}

/** Caller owns the original host tenant and marketplace order lock. Completed
 * V5/V7 is reconstructed from its frozen prefix; historical original returns
 * cannot provide liquidity a second time. Exactly one later refund is admitted. */
export async function readAsaasMarketplacePostResidualRefundBasis(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string, refundPlanId: string) {
  const f = await tx.marketplaceFundingPlan.findFirst({ where: { paymentIntentId: fundingPlanId, hostMerchantId } });
  if (!f?.providerPaymentId || f.provider !== "asaas" || f.status !== "held" || !f.budget) fail();
  const funding = f!;
  await lockMarketplaceOrder(tx, hostMerchantId, funding.providerPaymentId!);
  const payment = await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId } });
  const budget = funding.budget as unknown as FundingBudget, instructions = funding.instructions as unknown as FrozenMarketplaceFunding;
  if (!payment || payment.status !== "approved" || !["pix", "card"].includes(payment.method) || payment.currency !== "BRL" ||
      payment.amountCents !== funding.amountCents || payment.approvedAmountCents !== funding.amountCents ||
      payment.providerPaymentId !== funding.providerPaymentId || fundingHash(instructions) !== funding.instructionsHash ||
      fundingHash((payment.creation as { input?: { marketplaceFunding?: unknown } } | null)?.input?.marketplaceFunding) !== funding.instructionsHash ||
      fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
      budget.capture.provider !== "asaas" || budget.capture.providerPaymentId !== funding.providerPaymentId ||
      budget.capture.accountFingerprint !== funding.accountFingerprint || budget.capture.environment !== funding.environment ||
      funding.providerFeeCents !== budget.capture.providerFeeCents || funding.netAmountCents !== budget.capture.netAmountCents ||
      funding.payoutTotalCents !== budget.payoutTotalCents || funding.platformRetainedCents !== budget.platformRetainedCents) fail();
  const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId, orderId: funding.providerPaymentId! } } });
  if (!ledger?.purchasedAt || ledger.chargebackAt) fail();
  const generations = await tx.marketplaceResidualPlan.findMany({ where: { fundingPlanId }, include: { operations: true } });
  if (generations.length !== 1) fail();
  const plan = generations[0]!, basis = plan.basis as unknown as Omit<AsaasMarketplaceResidualBasis, "version"> & { version: 5 | 7 },
    previous = plan.allocation as unknown as AsaasMarketplaceResidualAllocation | AsaasMarketplaceHostRetentionAllocation;
  if (plan.hostMerchantId !== hostMerchantId || plan.generation !== 1 || plan.status !== "completed" || plan.heldReason ||
      ![5, 7].includes(basis.version) || previous.version !== basis.version || basis.fundingPlanId !== fundingPlanId ||
      basis.instructionsHash !== funding.instructionsHash || basis.budgetHash !== fundingHash(budget) ||
      fundingHash(basis) !== plan.basisHash || fundingHash(previous) !== plan.allocationHash ||
      !plan.operations.length || plan.operations.some(op => op.provider !== "asaas" || op.status !== "confirmed" ||
        !op.claimedAt || !op.reconciledAt || !id(op.providerTransferId) || op.sourceId !== "original" ||
        op.accountFingerprint !== funding.accountFingerprint || op.requestHash !== fundingHash(Object.fromEntries(
          Object.entries(op.request as object).filter(([key]) => key !== "requestHash"))))) fail();
  const nativeEvidence = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT marketplace_asaas_residual_evidence_valid(${plan.id}) AS valid`;
  if (nativeEvidence.length !== 1 || nativeEvidence[0].valid !== true) fail();
  const refund = await tx.marketplaceRefundPlan.findFirst({ where: { id: refundPlanId, hostMerchantId, fundingPlanId },
    include: { operation: true, return: { include: { items: true, refund: true } } } });
  if (!refund || !["blocked", "prepared", "submitted", "confirmed"].includes(refund.status) ||
      refund.blockReason !== "marketplace_refund_asaas_transfer_recovery_unavailable" ||
      refund.return.merchantId !== hostMerchantId ||
      !(refund.status === "confirmed" ? refund.return.status === "REFUND_COMPLETED" && refund.return.refund?.status === "COMPLETED" :
        refund.status === "submitted" ? refund.return.status === "REFUND_PROCESSING" && refund.return.refund?.status === "PENDING" :
        refund.return.status === "INSPECTED_PASS" && (!refund.return.refund || refund.return.refund.status === "PENDING")) ||
      refund.return.refund && (refund.return.refund.id !== `mrefund_return_${fundingHash(refund.id)}` ||
        refund.return.refund.paymentIntentId !== fundingPlanId || refund.return.refund.amountInCents !== refund.amountCents)) fail();
  const current = refund!, allocation = current.allocation as unknown as MarketplaceRefundAllocation;
  if (fundingHash(allocation) !== current.allocationHash || allocation.amountCents !== current.amountCents ||
      fundingHash(current.return.items.map(item => ({ variantId: item.variantId, quantity: item.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId))) !==
      fundingHash(allocation.lines.map(item => ({ variantId: item.variantId, quantity: item.quantity })).sort((a, b) => a.variantId.localeCompare(b.variantId)))) fail();
  const history = await readConfirmedAsaasMarketplaceRefundHistory(tx, hostMerchantId, fundingPlanId, budget.capture, refundPlanId);
  const all = await tx.marketplaceRefundPlan.findMany({ where: { fundingPlanId } });
  if (all.length !== history.rows.length + 1 || all.some(r => r.hostMerchantId !== hostMerchantId ||
      r.id !== refundPlanId && r.status !== "confirmed") ||
      fundingHash(history.rows.map(r => ({ refundPlanId: r.id, returnId: r.returnId, allocationHash: r.allocationHash,
        requestHash: r.operation!.requestHash, providerOperationId: r.operation!.providerOperationId!, amountCents: r.amountCents }))) !== fundingHash(basis.refunds)) fail();
  const before = buildMarketplaceResidualAllocation(budget, history.allocations);
  if (before.refundedCents !== previous.refundedCents || before.platformRetainedCents !== previous.platformRetainedCents ||
      before.payoutTotalCents !== previous.payoutTotalCents || fundingHash(before.beneficiaries) !== fundingHash(previous.beneficiaries)) fail();
  buildMarketplaceResidualAllocation(budget, [...history.allocations, allocation]);
  if (await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId } }) ||
      await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId } }) ||
      await tx.marketplaceTransferReversal.count({ where: { refundPlan: { fundingPlanId } } }) ||
      await tx.$queryRaw<Array<{ found: boolean }>>`SELECT EXISTS(SELECT 1 FROM marketplace_refund_contribution_journals WHERE funding_plan_id=${fundingPlanId}) AS found`
        .then(rows => rows[0]?.found === true)) fail();
  for (const b of budget.beneficiaries) if (
    await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: b.merchantId, status: { in: ["outstanding", "deducted"] } } }) ||
    await tx.marketplaceHostDebt.count({ where: { hostMerchantId: b.merchantId, status: { in: ["outstanding", "deducted"] } } }) ||
    await hasMarketplaceRecoveryExposure(tx, b.merchantId)) fail();
  const completed = await tx.completedOrder.findMany({ where: { merchantId: hostMerchantId,
    externalOrderId: { in: [funding.providerPaymentId!, ...(payment!.commerceOrderId ? [payment!.commerceOrderId] : [])] } }, select: { id: true } });
  const returns = await tx.return.findMany({ where: { merchantId: hostMerchantId,
    orderId: { in: [funding.providerPaymentId!, ...(payment!.commerceOrderId ? [payment!.commerceOrderId] : []), ...completed.map(c => c.id)] } } });
  if (returns.some(r => !["REJECTED", "CANCELLED"].includes(r.status) && !all.some(rf => rf.returnId === r.id))) fail();
  const operations = plan.operations.map(op => ({ id: op.id, merchantId: op.beneficiaryMerchantId,
    destination: (op.request as { destination: string }).destination, amountCents: op.amountCents, providerTransferId: op.providerTransferId! }));
  const conservation = allocateAsaasMarketplacePostResidualRefund({ host: basis.asaasFunding.host, previous, allocation, operations });
  const operation = plan.operations.find(op => op.id === conservation.requiredOperationId)!;
  const outbound = operation.request as unknown as { requestHash: string; version: number; providerPaymentId: string;
    destination: string; amountCents: number; reference: string; beneficiaryMerchantId: string };
  const sellerAccount = basis.asaasFunding.destinationAccounts.find(a => a.merchantId === operation.beneficiaryMerchantId);
  if (!sellerAccount || operation.beneficiaryMerchantId === hostMerchantId || outbound.version !== basis.version ||
      outbound.requestHash !== operation.requestHash || outbound.providerPaymentId !== funding.providerPaymentId ||
      outbound.destination !== sellerAccount.walletId || outbound.amountCents !== operation.amountCents ||
      outbound.reference !== operation.reference || outbound.beneficiaryMerchantId !== operation.beneficiaryMerchantId ||
      sellerAccount.walletId === basis.asaasFunding.host.walletId || sellerAccount.accountFingerprint === funding.accountFingerprint) fail();
  return { funding, payment: payment!, instructions, budget, plan, basis, previous, refund: current, allocation,
    history, operation, sellerAccount: sellerAccount!, conservation };
}

export async function readCertifiedAsaasMarketplaceResidualWalletReturns(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string, refundPlanId: string): Promise<CertifiedAsaasResidualWalletReturn[]> {
  if (!await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) return [];
  const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns
    WHERE host_merchant_id=${hostMerchantId} AND funding_plan_id=${fundingPlanId} AND refund_plan_id=${refundPlanId} AND status='returned' ORDER BY id`;
  const result: CertifiedAsaasResidualWalletReturn[] = [];
  for (const row of rows) {
    validateAsaasResidualWalletReturnJournal(row);
    const valid = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT marketplace_asaas_residual_wallet_return_certificate_valid(${row.id}) AS valid`;
    if (valid.length !== 1 || valid[0].valid !== true) fail();
    result.push({ id: row.id, residualPlanId: row.residual_plan_id, residualOperationId: row.residual_operation_id,
      certificateHash: row.certificate_hash!, request: row.request, proof: row.proof! });
  }
  return result;
}

export async function assertAsaasMarketplacePostResidualReturnedFunds(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string, refundPlanId: string): Promise<CertifiedAsaasResidualWalletReturn[] | null> {
  const data = await readAsaasMarketplacePostResidualRefundBasis(tx, hostMerchantId, fundingPlanId, refundPlanId);
  const credits = await readCertifiedAsaasMarketplaceResidualWalletReturns(tx, hostMerchantId, fundingPlanId, refundPlanId);
  if (credits.length !== 1 || credits[0].residualOperationId !== data.operation.id) return null;
  const r = credits[0].request, source = r.residual!;
  if (r.allocationHash !== data.refund.allocationHash || r.instructionsHash !== data.funding.instructionsHash ||
      source.planId !== data.plan.id || source.basisHash !== data.plan.basisHash || source.allocationHash !== data.plan.allocationHash ||
      source.outboundRequestHash !== data.operation.requestHash || fundingHash(source.previousRefunds) !== fundingHash(data.history.receipts) ||
      r.amountCents !== data.operation.amountCents || r.originalPayout.providerTransferId !== data.operation.providerTransferId ||
      fundingHash(r.capture) !== fundingHash(data.budget.capture) || fundingHash(r.host) !== fundingHash(data.basis.asaasFunding.host) ||
      r.seller.merchantId !== data.operation.beneficiaryMerchantId || r.seller.walletId !== data.sellerAccount.walletId ||
      r.seller.accountFingerprint !== data.sellerAccount.accountFingerprint) fail();
  return credits;
}

export function asaasResidualWalletReturnSource(data: Awaited<ReturnType<typeof readAsaasMarketplacePostResidualRefundBasis>>) {
  return { planId: data.plan.id, operationId: data.operation.id, generation: 1 as const, version: data.basis.version,
    basisHash: data.plan.basisHash, allocationHash: data.plan.allocationHash, outboundRequestHash: data.operation.requestHash,
    previousRefunds: data.history.receipts, hostRetainedCents: data.previous.version === 7 ? data.previous.hostRetainedCents : 0,
    platformRetainedCents: data.previous.platformRetainedCents, refundedCents: data.previous.refundedCents };
}

type Cursor = { version: 2; seller: string; createdAt: string; refundId: string; operationId: string };
export function decodeAsaasResidualWalletReturnCursor(value: string | undefined, seller: string): Cursor | undefined {
  if (value === undefined) return;
  try {
    if (!/^[A-Za-z0-9_-]{1,1000}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) throw Error();
    const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (Object.keys(c).sort().join(",") !== "createdAt,operationId,refundId,seller,version" || c.version !== 2 || c.seller !== seller ||
        ![c.seller, c.refundId, c.operationId].every(id) || new Date(c.createdAt).toISOString() !== c.createdAt) throw Error();
    return c;
  } catch { throw new BadRequestException("invalid_marketplace_wallet_return_cursor"); }
}

@Injectable()
export class PrismaAsaasMarketplaceResidualWalletReturnRepository implements AsaasMarketplaceWalletReturnAuthorizationReader {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Optional() @Inject(TenantContextService) private readonly tenants?: TenantContextService) {}
  private async actor(tx: Prisma.TransactionClient, actor: AsaasWalletReturnActor) {
    const current = this.tenants?.get();
    if (current && (current.merchantId !== actor.sellerMerchantId || current.userId !== actor.userId || !["owner", "admin"].includes(current.role)) ||
        !id(actor.sellerMerchantId) || !id(actor.userId) || !await tx.merchantUser.findFirst({ where: {
          id: actor.userId, merchantId: actor.sellerMerchantId, role: { in: ["owner", "admin"] }, disabledAt: null }, select: { id: true } })) {
      throw new NotFoundException("marketplace_wallet_return_not_found");
    }
  }
  private hostScope<T>(hostMerchantId: string, work: () => Promise<T>, verifiedSeller?: string): Promise<T> {
    const current = this.tenants?.get();
    if (current && current.merchantId !== hostMerchantId && current.merchantId !== verifiedSeller) fail();
    if (!this.tenants || current?.merchantId === hostMerchantId) return work();
    return this.tenants.run({ merchantId: hostMerchantId, userId: "marketplace-residual-wallet-return", role: "system" }, work);
  }
  async sourceKindForActor(actor: AsaasWalletReturnActor, refundId: string, sourceId: string): Promise<"initial" | "residual" | null> {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      if (!id(refundId) || !id(sourceId)) return null;
      const initial = await tx.marketplacePayout.findFirst({ where: { id: sourceId, beneficiaryMerchantId: actor.sellerMerchantId,
        fundingPlan: { refunds: { some: { id: refundId } } } }, select: { id: true } });
      const residual = await tx.marketplaceResidualOperation.findFirst({ where: { id: sourceId, beneficiaryMerchantId: actor.sellerMerchantId,
        residualPlan: { fundingPlan: { refunds: { some: { id: refundId } } } } }, select: { id: true } });
      if (initial && residual) fail();
      return initial ? "initial" : residual ? "residual" : null;
    });
  }
  async candidate(actor: AsaasWalletReturnActor, refundId: string, operationId: string) {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const source = await tx.marketplaceResidualOperation.findFirst({ where: { id: operationId, beneficiaryMerchantId: actor.sellerMerchantId }, include: { residualPlan: true } });
      if (!source || source.residualPlan.hostMerchantId === actor.sellerMerchantId) throw new NotFoundException();
      return this.hostScope(source.residualPlan.hostMerchantId, async () => {
        const data = await readAsaasMarketplacePostResidualRefundBasis(tx, source.residualPlan.hostMerchantId, source.residualPlan.fundingPlanId, refundId);
        if (data.operation.id !== operationId || data.refund.status !== "blocked" || data.refund.operation) fail();
        return data;
      }, actor.sellerMerchantId);
    }, { maxWait: 10000, timeout: 15000 });
  }
  async existing(actor: AsaasWalletReturnActor, refundId: string, operationId: string) {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns
        WHERE residual_operation_id=${operationId} AND seller_merchant_id=${actor.sellerMerchantId}`;
      if (!rows.length) return;
      validateAsaasResidualWalletReturnJournal(rows[0]);
      if (rows[0].refund_plan_id !== refundId) fail();
      return rows[0];
    });
  }
  async requireForActor(actor: AsaasWalletReturnActor, journalId: string) {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns
        WHERE id=${journalId} AND seller_merchant_id=${actor.sellerMerchantId}`;
      if (rows.length !== 1) throw new NotFoundException();
      validateAsaasResidualWalletReturnJournal(rows[0]); return rows[0];
    });
  }
  async sellerConnection(seller: string, environment: "test" | "live", walletId: string, expectedFingerprint: string) {
    const rows = await this.prisma.$queryRaw<Array<{ secret_cipher: string | null; wallet_id: string; environment: string; status: string; payouts_enabled: boolean }>>`
      SELECT secret_cipher,wallet_id,environment,status,payouts_enabled FROM merchant_payment_connections WHERE merchant_id=${seller} AND provider='asaas'`;
    const c = rows[0], origin = `https://api${environment === "test" ? "-sandbox" : ""}.asaas.com/v3`;
    if (rows.length !== 1 || !c.secret_cipher || c.wallet_id !== walletId || c.environment !== environment || c.status !== "active" || !c.payouts_enabled) fail();
    const key = decryptPaymentSecret(c.secret_cipher!);
    const frozenOrigin = [origin, origin.replace(/\/v3$/, ""), origin.replace(/\/v3$/, "/"), `${origin}/`]
      .find(o => marketplaceCaptureAccount("asaas", environment, key, o).accountFingerprint === expectedFingerprint);
    if (!frozenOrigin) fail();
    return { asaasKey: key, asaasOrigin: frozenOrigin! };
  }
  async authorize(actor: AsaasWalletReturnActor, request: AsaasMarketplaceWalletReturnRequest) {
    if (!validAsaasMarketplaceWalletReturnRequest(request) || request.version !== 2 || request.authorization.actorId !== actor.userId ||
        request.seller.merchantId !== actor.sellerMerchantId) fail();
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      return this.hostScope(request.host.merchantId, async () => {
        const data = await readAsaasMarketplacePostResidualRefundBasis(tx, request.host.merchantId, request.fundingPlanId, request.refundPlanId);
        if (data.refund.status !== "blocked" || data.refund.operation || data.operation.id !== request.originalPayout.id ||
            request.originalPayout.providerTransferId !== data.operation.providerTransferId || request.originalPayout.reference !== data.operation.reference ||
            request.amountCents !== data.operation.amountCents || request.instructionsHash !== data.funding.instructionsHash ||
            request.allocationHash !== data.refund.allocationHash || request.returnId !== data.refund.returnId ||
            fundingHash(request.capture) !== fundingHash(data.budget.capture) || fundingHash(request.host) !== fundingHash(data.basis.asaasFunding.host) ||
            request.seller.accountFingerprint !== data.sellerAccount.accountFingerprint || request.seller.walletId !== data.sellerAccount.walletId ||
            request.residual!.planId !== data.plan.id || request.residual!.basisHash !== data.plan.basisHash ||
            request.residual!.allocationHash !== data.plan.allocationHash || request.residual!.outboundRequestHash !== data.operation.requestHash ||
            fundingHash(request.residual) !== fundingHash(asaasResidualWalletReturnSource(data))) fail();
        await this.sellerConnection(request.seller.merchantId, request.environment, request.seller.walletId, request.seller.accountFingerprint);
        const prior = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns
          WHERE residual_operation_id=${data.operation.id} FOR UPDATE`;
        if (prior.length) { validateAsaasResidualWalletReturnJournal(prior[0]); if (fundingHash(prior[0].request) !== fundingHash(request)) fail(); return prior[0]; }
        const journalId = `awresreturn_${fundingHash([request.refundPlanId, data.operation.id])}`;
        await tx.$executeRaw`INSERT INTO marketplace_asaas_residual_wallet_returns
          (id,host_merchant_id,seller_merchant_id,actor_id,funding_plan_id,refund_plan_id,residual_plan_id,residual_operation_id,
            environment,host_account_fingerprint,seller_account_fingerprint,original_provider_transfer_id,amount_cents,request,request_hash,reference)
          VALUES (${journalId},${request.host.merchantId},${actor.sellerMerchantId},${actor.userId},${request.fundingPlanId},${request.refundPlanId},
            ${data.plan.id},${data.operation.id},${request.environment},${request.host.accountFingerprint},${request.seller.accountFingerprint},
            ${request.originalPayout.providerTransferId},${request.amountCents},${JSON.stringify(request)}::jsonb,${request.requestHash},${request.reference})`;
        const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE id=${journalId}`;
        return rows[0];
      }, actor.sellerMerchantId);
    }, { maxWait: 10000, timeout: 15000 });
  }
  async read(requestHash: string) {
    const rows = await this.prisma.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE request_hash=${requestHash}`;
    if (rows.length !== 1) return;
    const row = rows[0]; validateAsaasResidualWalletReturnJournal(row);
    return this.hostScope(row.host_merchant_id, async () => {
      const history = await this.prisma.$transaction(tx => readConfirmedAsaasMarketplaceRefundHistory(tx, row.host_merchant_id, row.funding_plan_id,
        row.request.capture, row.status === "returned" ? undefined : row.refund_plan_id));
      return { requestHash, authorizationId: row.request.authorization.id,
        state: row.status === "claimed" ? "claimed" as const : row.status === "returned" ? "returned" as const : "submitted" as const,
        ...(row.provider_return_transfer_id ? { providerTransferId: row.provider_return_transfer_id } : {}), confirmedRefunds: history.receipts };
    }, row.seller_merchant_id);
  }
  async consumeSubmissionAuthorization(requestHash: string) {
    const initial = await this.prisma.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE request_hash=${requestHash}`;
    if (initial.length !== 1) return;
    const bound = initial[0]; validateAsaasResidualWalletReturnJournal(bound);
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, { sellerMerchantId: bound.seller_merchant_id, userId: bound.actor_id });
      return this.hostScope(bound.host_merchant_id, async () => {
        await lockMarketplaceOrder(tx, bound.host_merchant_id, bound.request.capture.providerPaymentId);
        const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE id=${bound.id} FOR UPDATE`;
        const row = rows[0];
        if (!row || row.status !== "claimed" || row.submitted_at || row.provider_return_transfer_id) return;
        validateAsaasResidualWalletReturnJournal(row);
        const fresh = await readAsaasMarketplacePostResidualRefundBasis(tx, row.host_merchant_id, row.funding_plan_id, row.refund_plan_id);
        if (fresh.refund.status !== "blocked" || fresh.refund.operation || fresh.operation.id !== row.residual_operation_id ||
            fresh.operation.requestHash !== row.request.residual!.outboundRequestHash || fresh.refund.allocationHash !== row.request.allocationHash) fail();
        await tx.$executeRaw`UPDATE marketplace_asaas_residual_wallet_returns SET status='unknown',submitted_at=now(),version=version+1 WHERE id=${row.id} AND status='claimed'`;
        return { requestHash, authorizationId: row.request.authorization.id, state: "submission_authorized" as const };
      }, bound.seller_merchant_id);
    }, { maxWait: 10000, timeout: 15000 });
  }
  async record(journalId: string, observation: AsaasMarketplaceWalletReturnObservation) {
    const initial = await this.prisma.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE id=${journalId}`;
    if (initial.length !== 1) return false;
    const bound = initial[0]; validateAsaasResidualWalletReturnJournal(bound);
    return this.hostScope(bound.host_merchant_id, () => this.prisma.$transaction(async tx => {
      await lockMarketplaceOrder(tx, bound.host_merchant_id, bound.request.capture.providerPaymentId);
      const rows = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE id=${journalId} FOR UPDATE`;
      const row = rows[0];
      if (!row || !row.submitted_at || ["claimed", "returned", "failed"].includes(row.status)) return false;
      validateAsaasResidualWalletReturnJournal(row);
      if (observation.state === "unknown") {
        if (row.status !== "unknown") await tx.$executeRaw`UPDATE marketplace_asaas_residual_wallet_returns SET status='unknown',version=version+1 WHERE id=${journalId}`;
        return true;
      }
      if (!id(observation.providerTransferId) || observation.providerTransferId === row.request.originalPayout.providerTransferId ||
          row.provider_return_transfer_id && row.provider_return_transfer_id !== observation.providerTransferId ||
          observation.amountCents !== row.amount_cents || !Number.isFinite(Date.parse(observation.observedAt))) fail();
      const proof = observation.state === "returned" ? observation.proof : null;
      if (proof && (!validAsaasMarketplaceWalletReturnProof(row.request, proof) || proof.providerTransferId !== observation.providerTransferId ||
          proof.observedAt !== observation.observedAt)) fail();
      const certificate = proof ? fundingHash({ request: row.request, proof }) : null;
      await tx.$executeRaw`UPDATE marketplace_asaas_residual_wallet_returns SET status=${observation.state},provider_return_transfer_id=${observation.providerTransferId},
        observed_at=${new Date(observation.observedAt)},proof=${proof ? JSON.stringify(proof) : null}::jsonb,certificate_hash=${certificate},version=version+1 WHERE id=${journalId}`;
      if (proof) {
        for (const [kind, entry, fingerprint] of [
          ["original_host_debit", proof.originalHostDebit, proof.hostAccountFingerprint], ["original_seller_credit", proof.originalSellerCredit, proof.sellerAccountFingerprint],
          ["seller_return_debit", proof.sellerReturnDebit, proof.sellerAccountFingerprint], ["host_return_credit", proof.hostReturnCredit, proof.hostAccountFingerprint]] as const) {
          await tx.$executeRaw`INSERT INTO marketplace_asaas_residual_wallet_return_receipts(receipt_id,journal_id,kind,account_fingerprint,transfer_id,amount_cents,date)
            VALUES(${entry.id},${journalId},${kind},${fingerprint},${entry.transferId},${entry.amountCents},${entry.date}::date)`;
        }
        await tx.outboxMessage.create({ data: { eventId: asaasResidualWalletReturnEventId(journalId), eventType: "marketplace.asaas_residual_wallet_return.returned",
          schemaVersion: 1, merchantId: row.host_merchant_id, occurredAt: new Date(observation.observedAt), correlationId: row.funding_plan_id,
          causationId: row.id, producer: "marketplace", payload: asaasResidualWalletReturnPayload({ ...row, certificate_hash: certificate }) } });
      }
      return true;
    }, { maxWait: 10000, timeout: 15000 }), bound.seller_merchant_id);
  }
  async certifiedForRequest(request: AsaasMarketplaceWalletReturnRequest) {
    const rows = await this.prisma.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE request_hash=${request.requestHash}`;
    if (rows.length !== 1) return;
    const row = rows[0]; validateAsaasResidualWalletReturnJournal(row);
    if (row.status !== "returned" || fundingHash(row.request) !== fundingHash(request)) return;
    return this.hostScope(row.host_merchant_id, () => this.prisma.$transaction(async tx => {
      await lockMarketplaceOrder(tx, row.host_merchant_id, row.request.capture.providerPaymentId);
      const credits = await assertAsaasMarketplacePostResidualReturnedFunds(tx, row.host_merchant_id, row.funding_plan_id, row.refund_plan_id);
      return credits?.find(c => c.id === row.id);
    }), row.seller_merchant_id);
  }
  async listUnresolved(limit = 20) {
    const take = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const rows = await this.prisma.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT wr.* FROM marketplace_asaas_residual_wallet_returns wr
      WHERE wr.status IN ('unknown','pending') OR (wr.status='returned' AND EXISTS(SELECT 1 FROM marketplace_refund_plans rf
        WHERE rf.id=wr.refund_plan_id AND rf.status='blocked' AND rf.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable'))
      ORDER BY wr.created_at,wr.id LIMIT ${take}`;
    rows.forEach(validateAsaasResidualWalletReturnJournal); return rows;
  }
  async listForActor(actor: AsaasWalletReturnActor, limit = 20, cursor?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new BadRequestException();
    const c = decodeAsaasResidualWalletReturnCursor(cursor, actor.sellerMerchantId);
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      type Row = { refund_id: string; operation_id: string; residual_plan_id: string; return_id: string; created_at: Date;
        host_name: string; amount_cents: number; environment: "test" | "live"; payment_method: "pix" | "card"; journal_id: string | null };
      const rows = await tx.$queryRaw<Row[]>`SELECT rf.id AS refund_id,o.id AS operation_id,p.id AS residual_plan_id,rf.return_id,rf.created_at,
        h.name AS host_name,o.amount_cents,f.environment,pi.method AS payment_method,w.id AS journal_id
        FROM marketplace_residual_operations o JOIN marketplace_residual_plans p ON p.id=o.residual_plan_id
        JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id AND f.host_merchant_id=p.host_merchant_id
        JOIN payment_intents pi ON pi.id=f.payment_intent_id AND pi.merchant_id=f.host_merchant_id JOIN merchants h ON h.id=f.host_merchant_id
        JOIN marketplace_refund_plans rf ON rf.funding_plan_id=f.payment_intent_id AND rf.host_merchant_id=f.host_merchant_id
        LEFT JOIN marketplace_asaas_residual_wallet_returns w ON w.residual_operation_id=o.id
        WHERE o.beneficiary_merchant_id=${actor.sellerMerchantId} AND f.host_merchant_id<>${actor.sellerMerchantId} AND f.provider='asaas'
          AND ((w.id IS NOT NULL AND w.seller_merchant_id=${actor.sellerMerchantId} AND w.refund_plan_id=rf.id)
            OR (w.id IS NULL AND p.generation=1 AND p.status='completed' AND p.basis->>'version' IN ('5','7')
              AND o.status='confirmed' AND o.provider_transfer_id IS NOT NULL AND rf.status='blocked'
              AND rf.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable'))
          AND (${c?.createdAt ?? null}::timestamp IS NULL OR rf.created_at<${c?.createdAt ?? null}::timestamp
            OR (rf.created_at=${c?.createdAt ?? null}::timestamp AND (rf.id,o.id)>(${c?.refundId ?? ""},${c?.operationId ?? ""})))
        ORDER BY rf.created_at DESC,rf.id,o.id LIMIT ${limit + 1}`;
      const entries: Array<Omit<Row, "operation_id" | "journal_id" | "created_at"> & { payout_id: string; created_at: string;
        currency: "BRL"; source_kind: "residual"; residual_generation: 1; journal: AsaasResidualWalletReturnJournal | null }> = [];
      for (const r of rows.slice(0, limit)) {
        let journal: AsaasResidualWalletReturnJournal | null = null;
        if (r.journal_id) {
          const found = await tx.$queryRaw<AsaasResidualWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_residual_wallet_returns WHERE id=${r.journal_id}
            AND seller_merchant_id=${actor.sellerMerchantId} AND refund_plan_id=${r.refund_id}`;
          if (found.length !== 1) fail(); validateAsaasResidualWalletReturnJournal(found[0]); journal = found[0];
        } else {
          try {
            const data = await this.hostScope((await tx.marketplaceResidualPlan.findUniqueOrThrow({ where: { id: r.residual_plan_id } })).hostMerchantId,
              async () => {
                const plan = await tx.marketplaceResidualPlan.findUniqueOrThrow({ where: { id: r.residual_plan_id } });
                return readAsaasMarketplacePostResidualRefundBasis(tx, plan.hostMerchantId, plan.fundingPlanId, r.refund_id);
              }, actor.sellerMerchantId);
            if (data.operation.id !== r.operation_id) continue;
          } catch (error) { if (error instanceof ConflictException || error instanceof NotFoundException) continue; throw error; }
        }
        const { operation_id, journal_id: _, created_at, ...rest } = r;
        entries.push({ ...rest, payout_id: operation_id, created_at: created_at.toISOString(), currency: "BRL", source_kind: "residual", residual_generation: 1, journal });
      }
      const last = rows[Math.min(limit, rows.length) - 1];
      return { entries, next_cursor: rows.length > limit && last ? Buffer.from(JSON.stringify({ version: 2, seller: actor.sellerMerchantId,
        createdAt: last.created_at.toISOString(), refundId: last.refund_id, operationId: last.operation_id } satisfies Cursor)).toString("base64url") : null };
    }, { maxWait: 10000, timeout: 15000 });
  }
}
