import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TenantContextService } from "../../../../shared/tenant/tenant-context.service.js";
import type { AsaasMarketplaceWalletReturnAuthorizationReader, AsaasMarketplaceWalletReturnLedgerReceipt,
  AsaasMarketplaceWalletReturnObservation, AsaasMarketplaceWalletReturnProof, AsaasMarketplaceWalletReturnRequest } from "../../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { freezeAsaasMarketplaceWalletReturnRequest, validAsaasMarketplaceWalletReturnRequest } from "../asaas-marketplace-transfer-recovery.adapter.js";
import { buildMarketplaceFundingBudget } from "../../domain/services/marketplace-funding-budget.js";
import type { MarketplaceRefundAllocation } from "../../domain/services/marketplace-refund-allocation.js";
import { fundingHash, fundingTransferAllocations, lockMarketplaceOrder, type FrozenMarketplaceFunding, type FundingBudget } from "./prisma-marketplace-funding.repository.js";
import { decryptPaymentSecret } from "../../../payment/infrastructure/payment-secret-cipher.js";
import { marketplaceCaptureAccount } from "../marketplace-capture-account.js";
import { allocateMarketplaceTransferReversals } from "../../domain/services/marketplace-transfer-reversal-allocation.js";
import { readConfirmedAsaasMarketplaceRefundHistory } from "./asaas-marketplace-refund-history.js";
import { selectAsaasMarketplaceReturnedFunds } from "../../domain/services/asaas-marketplace-returned-funds.js";

type OriginalWalletReturnRequest = AsaasMarketplaceWalletReturnRequest & {
  previousRefunds?: Array<{ providerOperationId: string; amountCents: number }>;
};

export interface AsaasWalletReturnActor { sellerMerchantId: string; userId: string }
export interface AsaasWalletReturnJournal {
  id: string; host_merchant_id: string; seller_merchant_id: string; actor_id: string;
  funding_plan_id: string; refund_plan_id: string; payout_id: string; amount_cents: number;
  request: AsaasMarketplaceWalletReturnRequest; request_hash: string; reference: string;
  status: "claimed" | "unknown" | "pending" | "returned" | "failed";
  version: number; provider_return_transfer_id: string | null; submitted_at: Date | null;
  proof: AsaasMarketplaceWalletReturnProof | null; certificate_hash: string | null;
}
export interface CertifiedAsaasMarketplaceWalletReturn {
  id: string; payoutId: string; amountCents: number; certificateHash: string; requestHash: string;
  providerTransferId: string; request: AsaasMarketplaceWalletReturnRequest; proof: AsaasMarketplaceWalletReturnProof;
}
export interface AsaasWalletReturnQueueEntry {
  refund_id: string; payout_id: string; return_id: string; created_at: string;
  host_name: string; amount_cents: number; currency: "BRL"; environment: "test" | "live"; payment_method: "pix" | "card";
  journal: AsaasWalletReturnJournal | null;
}
type QueueCursor = { version: 1; seller: string; createdAt: string; refundId: string; payoutId: string };
export function decodeAsaasWalletReturnCursor(value: string | undefined, seller: string): QueueCursor | undefined {
  if (value === undefined) return;
  try {
    if (!/^[A-Za-z0-9_-]{1,1000}$/.test(value) || Buffer.from(value, "base64url").toString("base64url") !== value) throw Error();
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as QueueCursor;
    if (!decoded || Object.keys(decoded).sort().join(",") !== "createdAt,payoutId,refundId,seller,version" || decoded.version !== 1 ||
      decoded.seller !== seller || !identifier(decoded.seller) || !identifier(decoded.refundId) || !identifier(decoded.payoutId) ||
      typeof decoded.createdAt !== "string" || new Date(decoded.createdAt).toISOString() !== decoded.createdAt) throw Error();
    return decoded;
  } catch { throw new BadRequestException("invalid_marketplace_wallet_return_cursor"); }
}
const fail = (code: string): never => { throw new ConflictException(code); };
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const proofEntries = (proof: AsaasMarketplaceWalletReturnProof) => [
  ["original_host_debit", proof.originalHostDebit, proof.hostAccountFingerprint],
  ["original_seller_credit", proof.originalSellerCredit, proof.sellerAccountFingerprint],
  ["seller_return_debit", proof.sellerReturnDebit, proof.sellerAccountFingerprint],
  ["host_return_credit", proof.hostReturnCredit, proof.hostAccountFingerprint],
] as const;

export function validAsaasMarketplaceWalletReturnProof(request: AsaasMarketplaceWalletReturnRequest,
  proof: AsaasMarketplaceWalletReturnProof): boolean {
  try {
    if (!validAsaasMarketplaceWalletReturnRequest(request) || !proof || proof.version !== 1 || proof.kind !== "authorized_wallet_return" ||
      proof.association !== "local_immutable_authorization" || proof.requestHash !== request.requestHash ||
      proof.authorizationId !== request.authorization.id || proof.reference !== request.reference ||
      proof.originalProviderTransferId !== request.originalPayout.providerTransferId || !identifier(proof.providerTransferId) ||
      proof.providerTransferId === proof.originalProviderTransferId || proof.hostAccountFingerprint !== request.host.accountFingerprint ||
      proof.sellerAccountFingerprint !== request.seller.accountFingerprint || proof.hostWalletId !== request.host.walletId ||
      proof.sellerWalletId !== request.seller.walletId || proof.amountCents !== request.amountCents ||
      typeof proof.observedAt !== "string" || !Number.isFinite(Date.parse(proof.observedAt))) return false;
    const expected = [
      [proof.originalHostDebit, proof.originalProviderTransferId, "INTERNAL_TRANSFER_DEBIT", -request.amountCents],
      [proof.originalSellerCredit, proof.originalProviderTransferId, "INTERNAL_TRANSFER_CREDIT", request.amountCents],
      [proof.sellerReturnDebit, proof.providerTransferId, "INTERNAL_TRANSFER_DEBIT", -request.amountCents],
      [proof.hostReturnCredit, proof.providerTransferId, "INTERNAL_TRANSFER_CREDIT", request.amountCents],
    ] as const;
    return new Set(expected.map(([row]) => row?.id)).size === 4 && expected.every(([row, transferId, type, amount]) =>
      row && identifier(row.id) && row.transferId === transferId && row.type === type && row.amountCents === amount &&
      /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(Date.parse(row.date)));
  } catch { return false; }
}

function validateJournal(row: AsaasWalletReturnJournal): void {
  const request = row.request;
  if (!validAsaasMarketplaceWalletReturnRequest(request) || request.requestHash !== row.request_hash || request.reference !== row.reference ||
    request.host.merchantId !== row.host_merchant_id || request.seller.merchantId !== row.seller_merchant_id ||
    request.authorization.actorId !== row.actor_id || request.refundPlanId !== row.refund_plan_id ||
    request.fundingPlanId !== row.funding_plan_id || request.originalPayout.id !== row.payout_id || request.amountCents !== row.amount_cents) {
    fail("marketplace_asaas_wallet_return_journal_changed");
  }
  if (row.status === "returned" && (!row.proof || !validAsaasMarketplaceWalletReturnProof(request, row.proof) ||
    row.provider_return_transfer_id !== row.proof.providerTransferId || row.certificate_hash !== fundingHash({ request, proof: row.proof }))) {
    fail("marketplace_asaas_wallet_return_certificate_changed");
  }
}

/** Caller holds the marketplace order lock. Certified principal remains held;
 * this helper never refunds, nets a debt, releases a fee or changes a payout. */
export async function readCertifiedAsaasMarketplaceWalletReturns(tx: Prisma.TransactionClient,
  hostMerchantId: string, fundingPlanId: string, refundPlanId: string | string[]): Promise<CertifiedAsaasMarketplaceWalletReturn[]> {
  if (!await tx.paymentIntent.findFirst({ where: { id: fundingPlanId, merchantId: hostMerchantId }, select: { id: true } })) return [];
  const refundIds = Array.isArray(refundPlanId) ? refundPlanId : [refundPlanId];
  if (!refundIds.length || refundIds.length > 2000 || new Set(refundIds).size !== refundIds.length || refundIds.some(id => !identifier(id))) {
    fail("marketplace_asaas_wallet_return_scope_invalid");
  }
  const rows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT wr.* FROM marketplace_asaas_wallet_returns wr
    JOIN marketplace_refund_plans rf ON rf.id=wr.refund_plan_id AND rf.funding_plan_id=wr.funding_plan_id AND rf.host_merchant_id=wr.host_merchant_id
    JOIN marketplace_payouts p ON p.id=wr.payout_id AND p.funding_plan_id=wr.funding_plan_id AND p.beneficiary_merchant_id=wr.seller_merchant_id
    WHERE wr.host_merchant_id=${hostMerchantId} AND wr.funding_plan_id=${fundingPlanId} AND wr.refund_plan_id = ANY(${refundIds}::text[])
      AND wr.status='returned' ORDER BY wr.id`;
  const certified: CertifiedAsaasMarketplaceWalletReturn[] = [];
  for (const row of rows) {
    validateJournal(row);
    const request = row.request, proof = row.proof!;
    const receipts = await tx.$queryRaw<Array<{ receipt_id: string; kind: string; account_fingerprint: string; transfer_id: string; amount_cents: number; date: string }>>`
      SELECT receipt_id,kind,account_fingerprint,transfer_id,amount_cents,date::text FROM marketplace_asaas_wallet_return_receipts WHERE journal_id=${row.id}`;
    if (receipts.length !== 4 || proofEntries(proof).some(([kind, entry, fingerprint]) => !receipts.some(receipt =>
      receipt.kind === kind && receipt.receipt_id === entry.id && receipt.account_fingerprint === fingerprint &&
      receipt.transfer_id === entry.transferId && receipt.amount_cents === entry.amountCents && receipt.date === entry.date))) {
      fail("marketplace_asaas_wallet_return_receipts_missing");
    }
    const event = await tx.outboxMessage.findUnique({ where: { eventId: `marketplace_asaas_wallet_return_${row.id}` } });
    if (!event || event.eventType !== "marketplace.asaas_wallet_return.returned" || event.merchantId !== hostMerchantId ||
      fundingHash(event.payload) !== fundingHash(walletReturnPayload(row))) fail("marketplace_asaas_wallet_return_outbox_missing");
    certified.push({ id: row.id, payoutId: row.payout_id, amountCents: row.amount_cents, certificateHash: row.certificate_hash!,
      requestHash: row.request_hash, providerTransferId: row.provider_return_transfer_id!, request, proof });
  }
  return certified;
}
const walletReturnPayload = (row: AsaasWalletReturnJournal) => ({ journal_id: row.id, funding_plan_id: row.funding_plan_id,
  refund_plan_id: row.refund_plan_id, payout_id: row.payout_id, amount_cents: row.amount_cents, certificate_hash: row.certificate_hash });

@Injectable()
export class PrismaAsaasMarketplaceWalletReturnRepository implements AsaasMarketplaceWalletReturnAuthorizationReader {
  constructor(@Inject(PrismaClient) private readonly prisma: PrismaClient,
    @Optional() @Inject(TenantContextService) private readonly tenants?: TenantContextService) {}

  private hostScope<T>(hostMerchantId: string, work: () => Promise<T>): Promise<T> {
    // PrismaPromise executes when awaited. Start and await it inside the host
    // context so a seller caller cannot stamp the host's financial outbox.
    return this.tenants ? this.tenants.run({ merchantId: hostMerchantId, userId: "marketplace-wallet-return", role: "system" },
      async () => await work()) : work();
  }

  private async actor(tx: Prisma.TransactionClient, actor: AsaasWalletReturnActor): Promise<void> {
    if (!identifier(actor.sellerMerchantId) || !identifier(actor.userId) ||
      !await tx.merchant.findFirst({ where: { id: actor.sellerMerchantId }, select: { id: true } }) ||
      !await tx.merchantUser.findFirst({ where: { id: actor.userId, merchantId: actor.sellerMerchantId,
        role: { in: ["owner", "admin"] }, disabledAt: null }, select: { id: true } })) throw new NotFoundException("marketplace_wallet_return_not_found");
  }

  async candidate(actor: AsaasWalletReturnActor, refundPlanId: string, payoutId: string) {
    return this.prisma.$transaction(async tx => { await this.actor(tx, actor); return this.candidateTx(tx, actor, refundPlanId, payoutId); });
  }

  /** Discovery uses local state only. Existing journals remain visible after
   * activation, while unapproved rows must pass the original financial fences. */
  async listForActor(actor: AsaasWalletReturnActor, limit = 20, encodedCursor?: string) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new BadRequestException("invalid_marketplace_wallet_return_limit");
    const cursor = decodeAsaasWalletReturnCursor(encodedCursor, actor.sellerMerchantId);
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      type Row = { refund_id: string; payout_id: string; return_id: string; created_at: Date; host_name: string;
        amount_cents: number; environment: "test" | "live"; payment_method: "pix" | "card"; journal_id: string | null };
      const rows = await tx.$queryRaw<Row[]>`SELECT rf.id AS refund_id,p.id AS payout_id,rf.return_id,rf.created_at,
        h.name AS host_name,p.amount_cents,f.environment,pi.method AS payment_method,wr.id AS journal_id
        FROM marketplace_payouts p JOIN marketplace_funding_plans f ON f.payment_intent_id=p.funding_plan_id
        JOIN marketplace_refund_plans rf ON rf.funding_plan_id=f.payment_intent_id AND rf.host_merchant_id=f.host_merchant_id
        JOIN payment_intents pi ON pi.id=f.payment_intent_id AND pi.merchant_id=f.host_merchant_id
        JOIN merchants h ON h.id=f.host_merchant_id
        LEFT JOIN marketplace_asaas_wallet_returns wr ON wr.payout_id=p.id
        WHERE p.beneficiary_merchant_id=${actor.sellerMerchantId} AND f.host_merchant_id<>${actor.sellerMerchantId}
          AND f.provider='asaas' AND f.environment IN ('test','live') AND pi.method IN ('pix','card') AND p.currency='BRL'
          AND ((wr.id IS NOT NULL AND wr.seller_merchant_id=${actor.sellerMerchantId} AND wr.refund_plan_id=rf.id)
            OR (wr.id IS NULL AND p.status='confirmed' AND p.provider='asaas' AND p.kind='seller_settlement'
              AND p.claimed_at IS NOT NULL AND p.reconciled_at IS NOT NULL AND p.amount_cents>0
              AND f.status IN ('funded','held') AND rf.status='blocked'
              AND rf.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable'))
          AND (${cursor?.createdAt ?? null}::timestamp IS NULL OR rf.created_at<${cursor?.createdAt ?? null}::timestamp
            OR (rf.created_at=${cursor?.createdAt ?? null}::timestamp AND (rf.id,p.id)>(${cursor?.refundId ?? ""},${cursor?.payoutId ?? ""})))
        ORDER BY rf.created_at DESC,rf.id,p.id LIMIT ${limit + 1}`;
      const entries: AsaasWalletReturnQueueEntry[] = [];
      for (const row of rows.slice(0, limit)) {
        let journal: AsaasWalletReturnJournal | null = null;
        if (row.journal_id) {
          const stored = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns
            WHERE id=${row.journal_id} AND seller_merchant_id=${actor.sellerMerchantId} AND refund_plan_id=${row.refund_id} AND payout_id=${row.payout_id}`;
          if (!stored.length) continue;
          validateJournal(stored[0]); journal = stored[0];
        } else {
          try {
            const candidate = await this.candidateTx(tx, actor, row.refund_id, row.payout_id);
            if (candidate.refund.amountCents > candidate.budget.capture.netAmountCents) continue;
            const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: candidate.funding.paymentIntentId } });
            const required = allocateMarketplaceTransferReversals({ merchantDebits: candidate.allocation.merchantDebits,
              payouts: payouts.map(payout => ({ ...payout, beneficiaryMerchantId: payout.beneficiaryMerchantId! })) });
            if (!required.some(target => target.payoutId === row.payout_id)) continue;
          }
          catch (error) { if (error instanceof ConflictException || error instanceof NotFoundException) continue; throw error; }
        }
        entries.push({ refund_id: row.refund_id, payout_id: row.payout_id, return_id: row.return_id, created_at: row.created_at.toISOString(),
          host_name: row.host_name, amount_cents: row.amount_cents, currency: "BRL", environment: row.environment,
          payment_method: row.payment_method, journal });
      }
      const last = rows[Math.min(limit, rows.length) - 1];
      const next_cursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ version: 1, seller: actor.sellerMerchantId,
        createdAt: last.created_at.toISOString(), refundId: last.refund_id, payoutId: last.payout_id } satisfies QueueCursor)).toString("base64url") : null;
      return { entries, next_cursor };
    }, { maxWait: 10000, timeout: 15000 });
  }

  private async candidateTx(tx: Prisma.TransactionClient, actor: AsaasWalletReturnActor, refundPlanId: string, payoutId: string) {
    // Explicit seller parent predicate permits only this marketplace order's
    // cross-tenant funding. Host/buyer IDs are never supplied by the HTTP caller.
    const initial = await tx.marketplacePayout.findFirst({ where: { id: payoutId, beneficiaryMerchantId: actor.sellerMerchantId },
      include: { settlement: true, fundingPlan: { include: { payment: true } } } });
    if (!initial?.fundingPlan?.providerPaymentId || initial.fundingPlan.hostMerchantId === actor.sellerMerchantId) throw new NotFoundException("marketplace_wallet_return_not_found");
    await lockMarketplaceOrder(tx, initial.fundingPlan.hostMerchantId, initial.fundingPlan.providerPaymentId);
    const payout = await tx.marketplacePayout.findFirst({ where: { id: payoutId, beneficiaryMerchantId: actor.sellerMerchantId },
      include: { settlement: true, fundingPlan: { include: { payment: true } } } });
    const funding = payout?.fundingPlan, payment = funding?.payment;
    if (!payout || !funding?.providerPaymentId || !payment || funding.hostMerchantId === actor.sellerMerchantId) throw new NotFoundException("marketplace_wallet_return_not_found");
    await lockMarketplaceOrder(tx, funding.hostMerchantId, funding.providerPaymentId);
    const refund = await tx.marketplaceRefundPlan.findFirst({ where: { id: refundPlanId, fundingPlanId: funding.paymentIntentId,
      hostMerchantId: funding.hostMerchantId }, include: { operation: true, return: { include: { refund: true } } } });
    if (!refund || refund.return.merchantId !== funding.hostMerchantId) throw new NotFoundException("marketplace_wallet_return_not_found");
    const ledger = await tx.marketplaceOrderLedger.findUnique({ where: { hostMerchantId_orderId: { hostMerchantId: funding.hostMerchantId, orderId: funding.providerPaymentId } } });
    const instructions = funding.instructions as unknown as FrozenMarketplaceFunding, budget = funding.budget as unknown as FundingBudget;
    const allocation = refund.allocation as unknown as MarketplaceRefundAllocation;
    if (funding.provider !== "asaas" || !["test", "live"].includes(funding.environment) || !["funded", "held"].includes(funding.status) ||
      !budget || fundingHash(instructions) !== funding.instructionsHash ||
      fundingHash((payment.creation as { input?: { marketplaceFunding?: unknown } } | null)?.input?.marketplaceFunding) !== funding.instructionsHash ||
      fundingHash(buildMarketplaceFundingBudget(instructions, budget.capture)) !== fundingHash(budget) ||
      funding.providerPaymentId !== payment.providerPaymentId || payment.merchantId !== funding.hostMerchantId || payment.status !== "approved" ||
      !["pix", "card"].includes(payment.method) || payment.currency !== "BRL" || payment.amountCents !== funding.amountCents ||
      payment.approvedAmountCents !== funding.amountCents || funding.netAmountCents !== budget.capture.netAmountCents ||
      funding.payoutTotalCents !== budget.payoutTotalCents || funding.platformRetainedCents !== budget.platformRetainedCents ||
      !ledger?.purchasedAt || ledger.chargebackAt || refund.status !== "blocked" || refund.operation ||
      refund.blockReason !== "marketplace_refund_asaas_transfer_recovery_unavailable" || refund.return.status !== "INSPECTED_PASS" || refund.return.refund ||
      !allocation || fundingHash(allocation) !== refund.allocationHash || allocation.amountCents !== refund.amountCents ||
      !allocation.merchantDebits.some(row => row.merchantId === actor.sellerMerchantId && row.amountCents > 0) ||
      payout.provider !== "asaas" || payout.currency !== "BRL" || payout.accountFingerprint !== funding.accountFingerprint ||
      payout.providerPaymentId !== funding.providerPaymentId || payout.status !== "confirmed" || !payout.providerTransferId ||
      !payout.claimedAt || !payout.reconciledAt || payout.kind !== "seller_settlement" || !payout.settlement ||
      payout.settlement.sellerMerchantId !== actor.sellerMerchantId || payout.settlement.hostMerchantId !== funding.hostMerchantId) fail("marketplace_wallet_return_unavailable");
    const expected = fundingTransferAllocations(instructions, budget).find(row => row.merchantId === actor.sellerMerchantId && row.lineItemId === payout.settlement!.lineItemId);
    if (!expected || expected.amountCents !== payout.amountCents || expected.kind !== payout.kind ||
      payout.destination !== instructions.destinations.find(row => row.merchantId === actor.sellerMerchantId)?.destination) fail("marketplace_wallet_return_payout_changed");
    if (await tx.marketplaceRefundPlan.count({ where: { fundingPlanId: funding.paymentIntentId, id: { not: refund.id }, status: { not: "confirmed" } } }) ||
      await tx.marketplaceResidualPlan.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferRecovery.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferRecoveryCredit.count({ where: { fundingPlanId: funding.paymentIntentId } }) ||
      await tx.marketplaceTransferReversal.count({ where: { payoutId: payout.id } }) ||
      await tx.marketplaceSellerDebt.count({ where: { sellerMerchantId: actor.sellerMerchantId, status: { in: ["outstanding", "deducted"] } } }) ||
      await tx.marketplaceHostDebt.count({ where: { hostMerchantId: funding.hostMerchantId, status: { in: ["outstanding", "deducted"] } } })) fail("marketplace_wallet_return_history_unreconciled");
    // The immutable refund allocation freezes the cumulative amount. Every
    // earlier refund must have its native receipt, completed return and outbox;
    // another seller's returned principal never finances this seller's debit.
    const history = await readConfirmedAsaasMarketplaceRefundHistory(tx, funding.hostMerchantId, funding.paymentIntentId, budget.capture, refund.id);
    if (await tx.marketplaceRefundPlan.count({ where: { fundingPlanId: funding.paymentIntentId, id: { not: refund.id } } }) !== history.rows.length ||
      allocation.requiredContributions.length || allocation.cumulativeRefundCents !==
        history.receipts.reduce((sum, row) => sum + row.amountCents, 0) + allocation.amountCents ||
      allocation.cumulativeRefundCents > budget.capture.netAmountCents) fail("marketplace_wallet_return_history_unreconciled");
    if (history.rows.length) {
      const payouts = await tx.marketplacePayout.findMany({ where: { fundingPlanId: funding.paymentIntentId } });
      const credits = await readCertifiedAsaasMarketplaceWalletReturns(tx, funding.hostMerchantId, funding.paymentIntentId, history.rows.map(row => row.id));
      const prior = history.allocations.at(-1)!;
      if (selectAsaasMarketplaceReturnedFunds({ netAmountCents: budget.capture.netAmountCents, allocation: prior,
        previous: history.allocations.slice(0, -1), payouts,
        returns: credits.map(credit => ({ id: credit.id, payoutId: credit.payoutId, amountCents: credit.amountCents,
          sellerMerchantId: credit.request.seller.merchantId, originalProviderTransferId: credit.request.originalPayout.providerTransferId })) }) === null) {
        fail("marketplace_wallet_return_history_unreconciled");
      }
      const previousMerchantDebits = allocation.merchantDebits.map(debit => ({ merchantId: debit.merchantId,
        amountCents: history.allocations.reduce((sum, previous) => sum + (previous.merchantDebits.find(row => row.merchantId === debit.merchantId)?.amountCents ?? 0), 0) }));
      const required = allocateMarketplaceTransferReversals({ merchantDebits: allocation.merchantDebits,
        previousMerchantDebits, previousReversals: credits.map(credit => ({ payoutId: credit.payoutId, amountCents: credit.amountCents })),
        payouts: payouts.map(row => ({ ...row, beneficiaryMerchantId: row.beneficiaryMerchantId! })) });
      if (!required.some(row => row.payoutId === payout.id)) fail("marketplace_wallet_return_original_principal_reserved");
    }
    return { payout, funding, payment, refund, instructions, budget, allocation, confirmedRefunds: history.receipts };
  }

  async existing(actor: AsaasWalletReturnActor, refundPlanId: string, payoutId: string): Promise<AsaasWalletReturnJournal | undefined> {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns
        WHERE payout_id=${payoutId} AND seller_merchant_id=${actor.sellerMerchantId}`;
      if (!rows.length) return;
      if (rows[0].refund_plan_id !== refundPlanId) fail("marketplace_wallet_return_original_principal_reserved");
      validateJournal(rows[0]); return rows[0];
    });
  }

  async sellerConnection(sellerMerchantId: string, environment: "test" | "live", walletId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ secret_cipher: string | null; wallet_id: string | null; status: string; environment: string; payouts_enabled: boolean }>>`
      SELECT secret_cipher,wallet_id,status,environment,payouts_enabled FROM merchant_payment_connections
      WHERE merchant_id=${sellerMerchantId} AND provider='asaas'`;
    const row = rows[0];
    if (rows.length !== 1 || !row?.secret_cipher || row.wallet_id !== walletId || row.environment !== environment || row.status !== "active" || !row.payouts_enabled) {
      fail("marketplace_wallet_return_original_seller_account_unavailable");
    }
    return decryptPaymentSecret(row.secret_cipher!);
  }

  async authorize(actor: AsaasWalletReturnActor, request: AsaasMarketplaceWalletReturnRequest, asaasOrigin: string): Promise<AsaasWalletReturnJournal> {
    if (!validAsaasMarketplaceWalletReturnRequest(request) || request.seller.merchantId !== actor.sellerMerchantId ||
      request.authorization.actorId !== actor.userId) fail("marketplace_wallet_return_consent_changed");
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const candidate = await this.candidateTx(tx, actor, request.refundPlanId, request.originalPayout.id);
      const { funding, refund, payout, payment, budget } = candidate;
      const prior = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE payout_id=${payout.id} FOR UPDATE`;
      if (prior.length) {
        validateJournal(prior[0]);
        if (prior[0].seller_merchant_id !== actor.sellerMerchantId || prior[0].refund_plan_id !== refund.id || prior[0].amount_cents !== request.amountCents) {
          fail("marketplace_wallet_return_original_principal_reserved");
        }
        return prior[0];
      }
      if (request.host.merchantId !== funding.hostMerchantId || request.fundingPlanId !== funding.paymentIntentId || request.returnId !== refund.returnId ||
        request.instructionsHash !== funding.instructionsHash || request.allocationHash !== refund.allocationHash || request.paymentMethod !== payment.method ||
        request.environment !== funding.environment || request.host.accountFingerprint !== funding.accountFingerprint ||
        fundingHash(request.capture) !== fundingHash(budget.capture) || request.originalPayout.providerTransferId !== payout.providerTransferId ||
        request.originalPayout.reference !== payout.reference || request.amountCents !== payout.amountCents || request.seller.walletId !== payout.destination) fail("marketplace_wallet_return_basis_changed");
      // Derive the prefix here, under the order lock. A caller-supplied prefix
      // is discarded; the V1 journal's existing canonical hash freezes it.
      const { reference: _reference, requestHash: _requestHash, previousRefunds: _suppliedPrefix, ...raw } = request as OriginalWalletReturnRequest;
      const claimed = { ...raw, ...(candidate.confirmedRefunds.length ? { previousRefunds: candidate.confirmedRefunds } : {}) };
      request = freezeAsaasMarketplaceWalletReturnRequest(claimed);
      const rows = await tx.merchantPaymentConnection.findMany({ where: { merchantId: actor.sellerMerchantId, provider: "asaas",
        environment: request.environment, walletId: request.seller.walletId, status: "active", payoutsEnabled: true }, select: { secretCipher: true } });
      if (rows.length !== 1 || !rows[0].secretCipher || marketplaceCaptureAccount("asaas", request.environment,
        decryptPaymentSecret(rows[0].secretCipher), asaasOrigin).accountFingerprint !== request.seller.accountFingerprint) fail("marketplace_wallet_return_original_seller_account_unavailable");
      const id = `awreturn_${fundingHash([refund.id, payout.id])}`;
      await tx.$executeRaw`INSERT INTO marketplace_asaas_wallet_returns
        (id,host_merchant_id,seller_merchant_id,actor_id,funding_plan_id,refund_plan_id,payout_id,environment,
        host_account_fingerprint,seller_account_fingerprint,original_provider_transfer_id,amount_cents,request,request_hash,reference)
        VALUES (${id},${funding.hostMerchantId},${actor.sellerMerchantId},${actor.userId},${funding.paymentIntentId},${refund.id},${payout.id},${request.environment},
          ${request.host.accountFingerprint},${request.seller.accountFingerprint},${payout.providerTransferId},${request.amountCents},${JSON.stringify(request)}::jsonb,${request.requestHash},${request.reference})`;
      const inserted = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE id=${id}`;
      return inserted[0];
    }, { maxWait: 10000, timeout: 15000 });
  }

  async requireForActor(actor: AsaasWalletReturnActor, id: string): Promise<AsaasWalletReturnJournal> {
    return this.prisma.$transaction(async tx => {
      await this.actor(tx, actor);
      const rows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE id=${id} AND seller_merchant_id=${actor.sellerMerchantId}`;
      if (!rows.length) throw new NotFoundException("marketplace_wallet_return_not_found");
      validateJournal(rows[0]); return rows[0];
    });
  }

  async read(requestHash: string) {
    const rows = await this.prisma.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE request_hash=${requestHash}`;
    if (!rows.length) return;
    validateJournal(rows[0]);
    const row = rows[0];
    const confirmedRefunds = await this.hostScope(row.host_merchant_id, () => this.prisma.$transaction(async tx => {
      await lockMarketplaceOrder(tx, row.host_merchant_id, row.request.capture.providerPaymentId);
      const history = await readConfirmedAsaasMarketplaceRefundHistory(tx, row.host_merchant_id, row.funding_plan_id,
        row.request.capture, row.status === "returned" ? undefined : row.refund_plan_id);
      if (row.status !== "returned" && (
        await tx.marketplaceRefundPlan.count({ where: { fundingPlanId: row.funding_plan_id, id: { not: row.refund_plan_id } } }) !== history.rows.length ||
        fundingHash(history.receipts) !== fundingHash((row.request as OriginalWalletReturnRequest).previousRefunds ?? []))) {
        fail("marketplace_wallet_return_history_unreconciled");
      }
      return history.receipts;
    }));
    return { requestHash, authorizationId: rows[0].request.authorization.id,
      state: rows[0].status === "claimed" ? "claimed" as const : rows[0].status === "returned" ? "returned" as const : "submitted" as const,
      ...(rows[0].provider_return_transfer_id ? { providerTransferId: rows[0].provider_return_transfer_id } : {}),
      ...(confirmedRefunds ? { confirmedRefunds } : {}) };
  }

  async consumeSubmissionAuthorization(requestHash: string) {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE request_hash=${requestHash}`;
      if (!initial.length) return;
      await lockMarketplaceOrder(tx, initial[0].host_merchant_id, initial[0].request.capture.providerPaymentId);
      const rows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE request_hash=${requestHash} FOR UPDATE`;
      const row = rows[0];
      if (!row || row.status !== "claimed" || row.submitted_at || row.provider_return_transfer_id) return;
      validateJournal(row);
      // Recheck current refund/order/debt state under the SAME order lock before
      // consuming permission. A crash after commit can only reconcile by GET.
      const actor = { sellerMerchantId: row.seller_merchant_id, userId: row.actor_id };
      await this.actor(tx, actor);
      const candidate = await this.candidateTx(tx, actor, row.refund_plan_id, row.payout_id);
      if (candidate.funding.instructionsHash !== row.request.instructionsHash || candidate.refund.allocationHash !== row.request.allocationHash ||
        candidate.payout.providerTransferId !== row.request.originalPayout.providerTransferId ||
        fundingHash(candidate.confirmedRefunds) !== fundingHash((row.request as OriginalWalletReturnRequest).previousRefunds ?? [])) fail("marketplace_wallet_return_basis_changed");
      await tx.$executeRaw`UPDATE marketplace_asaas_wallet_returns SET status='unknown', submitted_at=now(),version=version+1
        WHERE id=${row.id} AND version=${row.version} AND status='claimed'`;
      return { requestHash, authorizationId: row.request.authorization.id, state: "submission_authorized" as const };
    }, { maxWait: 10000, timeout: 15000 });
  }

  async record(id: string, observation: AsaasMarketplaceWalletReturnObservation): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      const initial = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE id=${id}`;
      if (!initial.length) return false;
      await lockMarketplaceOrder(tx, initial[0].host_merchant_id, initial[0].request.capture.providerPaymentId);
      const rows = await tx.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE id=${id} FOR UPDATE`;
      const row = rows[0];
      if (!row || !row.submitted_at || row.status === "claimed") return false;
      validateJournal(row);
      await lockMarketplaceOrder(tx, row.host_merchant_id, row.request.capture.providerPaymentId);
      if (["returned", "failed"].includes(row.status)) return false;
      if (observation.state === "unknown") {
        if (row.status !== "unknown") await tx.$executeRaw`UPDATE marketplace_asaas_wallet_returns SET status='unknown',version=version+1 WHERE id=${id}`;
        return true;
      }
      if (!identifier(observation.providerTransferId) || observation.providerTransferId === row.request.originalPayout.providerTransferId ||
        row.provider_return_transfer_id && row.provider_return_transfer_id !== observation.providerTransferId ||
        observation.amountCents !== row.amount_cents || !Number.isFinite(Date.parse(observation.observedAt))) fail("marketplace_wallet_return_receipt_changed");
      const proof = observation.state === "returned" ? observation.proof : null;
      if (proof && (!validAsaasMarketplaceWalletReturnProof(row.request, proof) || proof.providerTransferId !== observation.providerTransferId || proof.observedAt !== observation.observedAt)) fail("marketplace_wallet_return_evidence_invalid");
      const certificateHash = proof ? fundingHash({ request: row.request, proof }) : null;
      await tx.$executeRaw`UPDATE marketplace_asaas_wallet_returns SET status=${observation.state},provider_return_transfer_id=${observation.providerTransferId},
        observed_at=${new Date(observation.observedAt)},proof=${proof ? JSON.stringify(proof) : null}::jsonb,certificate_hash=${certificateHash},version=version+1 WHERE id=${id}`;
      if (proof) {
        for (const [kind, entry, fingerprint] of proofEntries(proof)) await tx.$executeRaw`INSERT INTO marketplace_asaas_wallet_return_receipts
          (receipt_id,journal_id,kind,account_fingerprint,transfer_id,amount_cents,date)
          VALUES (${entry.id},${id},${kind},${fingerprint},${entry.transferId},${entry.amountCents},${entry.date}::date)`;
        const updated = { ...row, certificate_hash: certificateHash };
        await this.hostScope(row.host_merchant_id, () => tx.outboxMessage.create({ data: { eventId: `marketplace_asaas_wallet_return_${id}`, eventType: "marketplace.asaas_wallet_return.returned",
          schemaVersion: 1, merchantId: row.host_merchant_id, occurredAt: new Date(observation.observedAt), correlationId: row.funding_plan_id,
          causationId: row.id, producer: "marketplace", payload: walletReturnPayload(updated) } }));
      }
      return true;
    }, { maxWait: 10000, timeout: 15000 });
  }

  async certifiedForRequest(request: AsaasMarketplaceWalletReturnRequest): Promise<CertifiedAsaasMarketplaceWalletReturn | undefined> {
    // Establish the host context only from the exact durable journal binding,
    // never from a merchant ID or certificate supplied by the HTTP caller.
    const rows = await this.prisma.$queryRaw<AsaasWalletReturnJournal[]>`SELECT * FROM marketplace_asaas_wallet_returns WHERE request_hash=${request.requestHash}`;
    if (!rows.length) return;
    validateJournal(rows[0]);
    if (rows[0].status !== "returned" || fundingHash(rows[0].request) !== fundingHash(request)) return;
    return this.hostScope(rows[0].host_merchant_id, () => this.prisma.$transaction(async tx => {
      const certified = await readCertifiedAsaasMarketplaceWalletReturns(tx, request.host.merchantId, request.fundingPlanId, request.refundPlanId);
      return certified.find(row => row.requestHash === request.requestHash && fundingHash(row.request) === fundingHash(request));
    }));
  }

  async listUnresolved(limit = 20): Promise<AsaasWalletReturnJournal[]> {
    const take = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const rows = await this.prisma.$queryRaw<AsaasWalletReturnJournal[]>`SELECT wr.* FROM marketplace_asaas_wallet_returns wr
      WHERE wr.status IN ('unknown','pending') OR (wr.status='returned' AND EXISTS (
        SELECT 1 FROM marketplace_refund_plans rf WHERE rf.id=wr.refund_plan_id
          AND rf.funding_plan_id=wr.funding_plan_id AND rf.host_merchant_id=wr.host_merchant_id
          AND rf.status='blocked' AND rf.block_reason='marketplace_refund_asaas_transfer_recovery_unavailable'))
      ORDER BY wr.created_at,wr.id LIMIT ${take}`;
    for (const row of rows) validateJournal(row);
    return rows;
  }
}
