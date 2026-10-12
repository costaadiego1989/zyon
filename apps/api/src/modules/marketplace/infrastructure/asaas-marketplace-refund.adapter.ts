import { createHash } from "node:crypto";
import type { MarketplaceRefundObservation, MarketplaceRefundProvider, MarketplaceRefundRequest, MarketplaceRefundSubmission } from "../domain/ports/marketplace-refund-provider.port.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import type { AsaasMarketplaceWalletReturnRequest } from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { validAsaasMarketplaceWalletReturnRequest } from "./asaas-marketplace-transfer-recovery.adapter.js";
import { asaasResidualHash } from "../domain/services/asaas-marketplace-residual.js";

const positiveCents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
const money = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 21_474_836.47) throw Error("marketplace_refund_asaas_amount_invalid");
  const result = Math.round(value * 100);
  if (Math.abs(value * 100 - result) > 0.000001) throw Error("marketplace_refund_asaas_amount_invalid");
  return result;
};
type Receipt = { description: string; dateCreated: string; value: number; status: "DONE" | "PENDING" | "CANCELLED"; refundedSplits?: unknown };
const description = (input: MarketplaceRefundRequest) => `Zyon marketplace refund ${input.reference} ${input.requestHash}`;
const fingerprintPattern = /^asaas_refund_[a-f0-9]{64}$/;

/** Asaas refunds[] has no documented native refund ID. This is a local evidence
 * fingerprint; status and optional links are deliberately excluded from identity. */
export function asaasMarketplaceRefundReceiptId(input: Pick<MarketplaceRefundRequest, "environment" | "accountFingerprint" | "providerPaymentId">,
  receipt: Pick<Receipt, "description" | "dateCreated" | "value">): string {
  return `asaas_refund_${createHash("sha256").update(JSON.stringify(["asaas-refund-v1", input.environment,
    input.accountFingerprint, input.providerPaymentId, receipt.description, receipt.dateCreated, money(receipt.value)])).digest("hex")}`;
}

/** Received, unsplit, non-installment Pix/card payments before any marketplace
 * transfer. No retries after a POST, no bank-slip onboarding, no manual proof. */
export class AsaasMarketplaceRefundAdapter implements MarketplaceRefundProvider {
  constructor(private readonly config: { asaasKey?: string; asaasOrigin?: string }, private readonly request: typeof fetch = globalThis.fetch,
    private readonly verifyWalletReturns?: (requests: AsaasMarketplaceWalletReturnRequest[]) => Promise<boolean>,
    private readonly verifyResidualReturns?: (requests: AsaasMarketplaceWalletReturnRequest[]) => Promise<boolean>) {}

  private validate(input: MarketplaceRefundRequest): void {
    const capture = input.asaasCapture;
    if (input.provider !== "asaas" || input.kind !== "refund" || input.transfer !== undefined || input.currency !== "BRL" ||
        !positiveCents(input.amountCents) || !positiveCents(input.paymentAmountCents) || input.amountCents > input.paymentAmountCents ||
        !/^pay_[A-Za-z0-9_-]+$/.test(input.providerPaymentId) || input.sourceId !== input.providerPaymentId ||
        !/^mrefund_[a-f0-9]{64}$/.test(input.reference) || !/^[a-f0-9]{64}$/.test(input.requestHash) || !capture ||
        capture.provider !== "asaas" || capture.environment !== input.environment || capture.accountFingerprint !== input.accountFingerprint ||
        capture.providerPaymentId !== input.providerPaymentId || capture.sourceId !== input.sourceId || capture.currency !== "BRL" ||
        capture.amountCents !== input.paymentAmountCents || !positiveCents(capture.netAmountCents) ||
        !Number.isSafeInteger(capture.providerFeeCents) || capture.providerFeeCents < 0 ||
        capture.netAmountCents + capture.providerFeeCents !== capture.amountCents || capture.balanceTransactionId !== undefined) {
      throw Error("marketplace_refund_asaas_request_invalid");
    }
    if (!Array.isArray(input.previousRefunds) || input.previousRefunds.length > 2000 ||
        new Set(input.previousRefunds.map(row => row?.providerOperationId)).size !== input.previousRefunds.length ||
        input.previousRefunds.some(row => !row || !fingerprintPattern.test(row.providerOperationId) || !positiveCents(row.amountCents)) ||
        input.previousRefunds.reduce((sum, row) => sum + row.amountCents, input.amountCents) > capture.netAmountCents) {
      throw Error("marketplace_refund_asaas_history_invalid");
    }
    const account = marketplaceCaptureAccount("asaas", input.environment, this.config.asaasKey, this.config.asaasOrigin);
    if (account.accountFingerprint !== input.accountFingerprint) throw Error("marketplace_refund_account_mismatch");
    if (input.fundingContributions !== undefined) throw Error("marketplace_refund_contribution_provider_mismatch");
    if (input.asaasWalletReturns !== undefined) {
      const rows = input.asaasWalletReturns;
      if (!this.verifyWalletReturns || !Array.isArray(rows) || !rows.length || rows.length > 2000 ||
          new Set(rows.map(row => row.id)).size !== rows.length || new Set(rows.map(row => row.payoutId)).size !== rows.length ||
          rows.some(row => !row.id || !row.payoutId || !/^[a-f0-9]{64}$/.test(row.certificateHash) || !row.request || !row.proof ||
            row.request.version !== 1 || row.request.residual !== undefined || row.request.provider !== "asaas" || row.request.environment !== input.environment || row.request.host.accountFingerprint !== input.accountFingerprint ||
            row.request.capture.providerPaymentId !== input.providerPaymentId || row.request.originalPayout.id !== row.payoutId ||
            row.proof.requestHash !== row.request.requestHash || row.proof.authorizationId !== row.request.authorization.id ||
            row.proof.hostAccountFingerprint !== input.accountFingerprint || row.proof.amountCents !== row.request.amountCents ||
            row.request.amountCents !== row.request.originalPayout.amountCents)) throw Error("marketplace_refund_asaas_wallet_return_invalid");
    }
    if (input.asaasResidualWalletReturns !== undefined) {
      const rows = input.asaasResidualWalletReturns;
      if (input.asaasWalletReturns !== undefined || input.stripeSourceFunding !== undefined || !this.verifyResidualReturns ||
          !Array.isArray(rows) || rows.length !== 1) throw Error("marketplace_refund_asaas_residual_wallet_return_invalid");
      const row = rows[0], r = row?.request, p = row?.proof, source = r?.residual;
      if (!r || !p || !source || r.version !== 2 || !validAsaasMarketplaceWalletReturnRequest(r) ||
          row.id !== `awresreturn_${asaasResidualHash([r.refundPlanId, source.operationId])}` ||
          row.residualPlanId !== source.planId || row.residualOperationId !== source.operationId ||
          row.certificateHash !== asaasResidualHash({ request: r, proof: p }) ||
          asaasResidualHash(source.previousRefunds) !== asaasResidualHash(input.previousRefunds) ||
          r.environment !== input.environment || r.host.accountFingerprint !== input.accountFingerprint ||
          r.capture.providerPaymentId !== input.providerPaymentId || asaasResidualHash(r.capture) !== asaasResidualHash(input.asaasCapture) ||
          p.version !== 1 || p.kind !== "authorized_wallet_return" || p.association !== "local_immutable_authorization" ||
          p.requestHash !== r.requestHash || p.authorizationId !== r.authorization.id || p.reference !== r.reference ||
          p.originalProviderTransferId !== r.originalPayout.providerTransferId || p.providerTransferId === p.originalProviderTransferId ||
          p.hostAccountFingerprint !== r.host.accountFingerprint || p.sellerAccountFingerprint !== r.seller.accountFingerprint ||
          p.hostWalletId !== r.host.walletId || p.sellerWalletId !== r.seller.walletId || p.amountCents !== r.amountCents ||
          !Number.isFinite(Date.parse(p.observedAt))) throw Error("marketplace_refund_asaas_residual_wallet_return_invalid");
      const entries = [[p.originalHostDebit, p.originalProviderTransferId, "INTERNAL_TRANSFER_DEBIT", -r.amountCents],
        [p.originalSellerCredit, p.originalProviderTransferId, "INTERNAL_TRANSFER_CREDIT", r.amountCents],
        [p.sellerReturnDebit, p.providerTransferId, "INTERNAL_TRANSFER_DEBIT", -r.amountCents],
        [p.hostReturnCredit, p.providerTransferId, "INTERNAL_TRANSFER_CREDIT", r.amountCents]] as const;
      if (new Set(entries.map(([e]) => e?.id)).size !== 4 || entries.some(([e, transferId, type, amount]) =>
        !e || !/^[A-Za-z0-9_-]{1,100}$/.test(e.id) || e.transferId !== transferId || e.type !== type || e.amountCents !== amount ||
        !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !Number.isFinite(Date.parse(e.date)))) throw Error("marketplace_refund_asaas_residual_wallet_return_invalid");
    }
  }

  private async payment(input: MarketplaceRefundRequest, beforeSubmission: boolean): Promise<Receipt[]> {
    const response = await this.request(`${new URL(this.config.asaasOrigin!).origin}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      headers: this.headers(), redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw Error("marketplace_refund_asaas_read_failed");
    const payment = await response.json() as Record<string, unknown>;
    if (!payment || payment.id !== input.providerPaymentId || money(payment.value) !== input.paymentAmountCents ||
        !["PIX", "CREDIT_CARD"].includes(String(payment.billingType)) || payment.deleted || payment.anticipated || payment.chargeback ||
        payment.installment || payment.subscription ||
        (payment.split != null && (!Array.isArray(payment.split) || payment.split.length !== 0)) ||
        !(beforeSubmission ? payment.status === "RECEIVED" : ["RECEIVED", "REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS"].includes(String(payment.status)))) {
      throw Error("marketplace_refund_asaas_payment_mismatch");
    }
    // The provider does not document netValue's immutability after refund. Compare
    // it only before a new POST; reconciliation keeps the frozen original fee.
    if (beforeSubmission && !input.previousRefunds.length && money(payment.netValue) !== input.asaasCapture!.netAmountCents) throw Error("marketplace_refund_asaas_net_changed");
    const receipts = payment.refunds ?? [];
    if (!Array.isArray(receipts) || receipts.length > 2000) throw Error("marketplace_refund_asaas_history_invalid");
    for (const receipt of receipts) {
      if (!receipt || typeof receipt !== "object" || typeof receipt.description !== "string" || !receipt.description ||
          typeof receipt.dateCreated !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(receipt.dateCreated) ||
          !Number.isFinite(Date.parse(receipt.dateCreated.replace(" ", "T") + "Z")) ||
          !positiveCents(money(receipt.value)) || !["DONE", "PENDING", "CANCELLED"].includes(receipt.status) ||
          (receipt.refundedSplits != null && (!Array.isArray(receipt.refundedSplits) || receipt.refundedSplits.length !== 0))) {
        throw Error("marketplace_refund_asaas_receipt_invalid");
      }
    }
    return receipts as Receipt[];
  }

  private headers(): Record<string, string> {
    return { access_token: this.config.asaasKey!, accept: "application/json", "user-agent": "ZyonMarketplace/1.0" };
  }

  /** Every external row must be this operation or its exact frozen prefix. */
  private history(input: MarketplaceRefundRequest, receipts: Receipt[]): Receipt | undefined {
    const prior = new Map(input.previousRefunds.map(row => [row.providerOperationId, row.amountCents]));
    const seen = new Set<string>(); let current: Receipt | undefined;
    for (const receipt of receipts) {
      const key = asaasMarketplaceRefundReceiptId(input, receipt);
      if (seen.has(key)) throw Error("marketplace_refund_asaas_duplicate_receipt");
      seen.add(key);
      if (receipt.description === description(input)) {
        if (current || money(receipt.value) !== input.amountCents) throw Error("marketplace_refund_asaas_ambiguous_receipt");
        current = receipt;
      } else {
        if (receipt.status !== "DONE" || prior.get(key) !== money(receipt.value)) throw Error("marketplace_refund_asaas_external_history");
        prior.delete(key);
      }
    }
    if (prior.size) throw Error("marketplace_refund_asaas_history_missing");
    return current;
  }

  async submit(input: MarketplaceRefundRequest): Promise<MarketplaceRefundSubmission> {
    input = structuredClone(input);
    let attempted = false, existing = false;
    try {
      this.validate(input);
      const receipts = await this.payment(input, true);
      // An observed same-reference operation must never reopen the durable claim,
      // even when its amount/status/history is no longer admissible.
      existing = receipts.some(row => row.description.includes(input.reference));
      const current = this.history(input, receipts);
      if (current) return { state: "unknown" };
      if (input.asaasWalletReturns && !await this.verifyWalletReturns!(input.asaasWalletReturns.map(row => row.request))) {
        throw Error("marketplace_refund_asaas_wallet_return_no_longer_available");
      }
      if (input.asaasResidualWalletReturns && !await this.verifyResidualReturns!(input.asaasResidualWalletReturns.map(row => row.request))) {
        throw Error("marketplace_refund_asaas_residual_wallet_return_no_longer_available");
      }
      if (input.asaasWalletReturns || input.asaasResidualWalletReturns) {
        // Live wallet verification must not leave the original payment/history
        // stale when a refund or chargeback appears during its ledger GETs.
        const currentReceipts = await this.payment(input, true);
        existing = currentReceipts.some(row => row.description.includes(input.reference));
        if (this.history(input, currentReceipts)) return { state: "unknown" };
      }
      attempted = true;
      await this.request(`${new URL(this.config.asaasOrigin!).origin}/v3/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
        method: "POST", headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ value: input.amountCents / 100, description: description(input) }),
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      // POST response/status is never proof; only a later independent GET can
      // provide the exact DONE/PENDING/CANCELLED history row.
      return { state: "unknown" };
    } catch { return { state: attempted || existing ? "unknown" : "not_submitted" }; }
  }

  async reconcile(input: MarketplaceRefundRequest, providerOperationId?: string): Promise<MarketplaceRefundObservation> {
    try {
      this.validate(input);
      if (providerOperationId && !fingerprintPattern.test(providerOperationId)) return { state: "unknown" };
      const current = this.history(input, await this.payment(input, false));
      if (!current) return { state: "unknown" };
      const identity = asaasMarketplaceRefundReceiptId(input, current);
      if (providerOperationId && identity !== providerOperationId) return { state: "unknown" };
      return { state: current.status === "DONE" ? "confirmed" : current.status === "CANCELLED" ? "failed" : "pending",
        providerOperationId: identity, amountCents: input.amountCents, observedAt: new Date().toISOString() };
    } catch { return { state: "unknown" }; }
  }
}
