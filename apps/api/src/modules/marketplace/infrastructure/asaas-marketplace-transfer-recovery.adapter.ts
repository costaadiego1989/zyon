import { createHash } from "node:crypto";
import type {
  AsaasMarketplaceWalletReturnAuthorizationReader, AsaasMarketplaceWalletReturnAuthorizationRecord,
  AsaasMarketplaceWalletReturnLedgerReceipt, AsaasMarketplaceWalletReturnObservation,
  AsaasMarketplaceWalletReturnProvider, AsaasMarketplaceWalletReturnRequest, AsaasMarketplaceWalletReturnSubmission,
} from "../domain/ports/asaas-marketplace-transfer-recovery.port.js";
import { marketplaceCaptureAccount } from "./marketplace-capture-account.js";
import { asaasMarketplaceRefundReceiptId } from "./asaas-marketplace-refund.adapter.js";

type AccountConfig = { asaasKey?: string; asaasOrigin?: string };
type JsonObject = Record<string, unknown>;
type OriginalWalletReturnRequest = AsaasMarketplaceWalletReturnRequest & {
  previousRefunds?: Array<{ providerOperationId: string; amountCents: number }>;
};
const object = (value: unknown): value is JsonObject => !!value && typeof value === "object" && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
const canonical = (value: unknown): string => JSON.stringify(value, (_, entry) => object(entry)
  ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
const digest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
const date = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const iso = (value: unknown): value is string => typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const absent = (value: unknown): boolean => value === undefined || value === null;
const money = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 21_474_836.47) throw Error("marketplace_asaas_wallet_return_amount_invalid");
  const result = Math.round(value * 100);
  if (Math.abs(value * 100 - result) > 0.000001) throw Error("marketplace_asaas_wallet_return_amount_invalid");
  return result;
};

export function freezeAsaasMarketplaceWalletReturnRequest(
  input: Omit<AsaasMarketplaceWalletReturnRequest, "reference" | "requestHash">,
): AsaasMarketplaceWalletReturnRequest {
  const requestHash = digest(input);
  return { ...input, reference: `mwreturn_${requestHash}`, requestHash };
}

export function validAsaasMarketplaceWalletReturnRequest(input: AsaasMarketplaceWalletReturnRequest): boolean {
  try {
    if (!object(input)) return false;
    const { reference, requestHash, ...raw } = input;
    const { capture, host, seller, originalPayout: original, authorization } = input;
    const residual = input.residual;
    const previousRefunds = (input as OriginalWalletReturnRequest).previousRefunds;
    const originalPrefixValid = previousRefunds === undefined || Array.isArray(previousRefunds) && previousRefunds.length <= 2000 &&
      new Set(previousRefunds.map(row => row?.providerOperationId)).size === previousRefunds.length &&
      previousRefunds.every(row => object(row) && /^asaas_refund_[a-f0-9]{64}$/.test(row.providerOperationId as string) && cents(row.amountCents)) &&
      previousRefunds.reduce((sum, row) => sum + row.amountCents, 0) <= capture?.netAmountCents;
    const sourceValid = input.version === 1 ? residual === undefined && originalPrefixValid : input.version === 2 && object(residual) &&
      identifier(residual.planId) && residual.operationId === original?.id && residual.generation === 1 &&
      [5, 7].includes(residual.version) && [residual.basisHash, residual.allocationHash, residual.outboundRequestHash].every(hash) &&
      Array.isArray(residual.previousRefunds) && residual.previousRefunds.length > 0 && residual.previousRefunds.length <= 2000 &&
      new Set(residual.previousRefunds.map(row => row?.providerOperationId)).size === residual.previousRefunds.length &&
      residual.previousRefunds.every(row => object(row) && /^asaas_refund_[a-f0-9]{64}$/.test(row.providerOperationId as string) && cents(row.amountCents)) &&
      [residual.hostRetainedCents, residual.platformRetainedCents, residual.refundedCents].every(value =>
        Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647) &&
      residual.previousRefunds.reduce((sum, row) => sum + row.amountCents, 0) === residual.refundedCents &&
      residual.refundedCents < capture?.netAmountCents &&
      residual.refundedCents + residual.hostRetainedCents + residual.platformRetainedCents + original.amountCents <= capture.netAmountCents &&
      (residual.version === 7 ? residual.hostRetainedCents > 0 : residual.hostRetainedCents === 0);
    return sourceValid && input.kind === "authorized_wallet_return" && input.provider === "asaas" &&
      ["test", "live"].includes(input.environment) && ["pix", "card"].includes(input.paymentMethod) && input.currency === "BRL" &&
      [input.fundingPlanId, input.refundPlanId, input.returnId].every(identifier) && hash(input.instructionsHash) && hash(input.allocationHash) &&
      object(host) && object(seller) && [host.merchantId, seller.merchantId, host.walletId, seller.walletId].every(identifier) &&
      hash(host.accountFingerprint) && hash(seller.accountFingerprint) && host.merchantId !== seller.merchantId &&
      host.accountFingerprint !== seller.accountFingerprint && host.walletId !== seller.walletId &&
      object(capture) && capture.provider === "asaas" && capture.environment === input.environment && capture.currency === "BRL" &&
      capture.accountFingerprint === host.accountFingerprint && /^pay_[A-Za-z0-9_-]+$/.test(capture.providerPaymentId) &&
      capture.sourceId === capture.providerPaymentId && capture.balanceTransactionId === undefined && cents(capture.amountCents) &&
      cents(capture.netAmountCents) && Number.isSafeInteger(capture.providerFeeCents) && capture.providerFeeCents >= 0 &&
      capture.netAmountCents + capture.providerFeeCents === capture.amountCents &&
      object(original) && identifier(original.id) && identifier(original.providerTransferId) &&
      typeof original.reference === "string" && /^[A-Za-z0-9_:-]{1,200}$/.test(original.reference) && date(original.dateCreated) &&
      cents(original.amountCents) && original.amountCents <= capture.netAmountCents && input.amountCents === original.amountCents &&
      object(authorization) && identifier(authorization.id) && identifier(authorization.actorId) &&
      authorization.sellerMerchantId === seller.merchantId && iso(authorization.authorizedAt) &&
      hash(requestHash) && reference === `mwreturn_${requestHash}` && digest(raw) === requestHash;
  } catch { return false; }
}

/** A full seller-authorized original wallet return for a received Pix/card capture.
 * GET wallet identities and debit/credit receipts on BOTH frozen accounts prove
 * actual movement. No native reversal link, arbitrary manual credit, buyer
 * refund, or available-account-balance shortcut is invented. No durable
 * authorization reader is installed by default, so mutation admission is closed. */
export class AsaasMarketplaceTransferRecoveryAdapter implements AsaasMarketplaceWalletReturnProvider {
  constructor(private readonly config: { host: AccountConfig; seller: AccountConfig },
    private readonly authorization?: AsaasMarketplaceWalletReturnAuthorizationReader,
    private readonly request: typeof fetch = globalThis.fetch,
    private readonly now: () => Date = () => new Date()) {}

  private validate(input: AsaasMarketplaceWalletReturnRequest): void {
    if (!validAsaasMarketplaceWalletReturnRequest(input)) throw Error("marketplace_asaas_wallet_return_request_invalid");
    for (const role of ["host", "seller"] as const) {
      const configured = this.config[role];
      const account = marketplaceCaptureAccount("asaas", input.environment, configured.asaasKey, configured.asaasOrigin);
      if (account.accountFingerprint !== input[role].accountFingerprint) throw Error("marketplace_asaas_wallet_return_account_mismatch");
    }
  }

  private matchesAuthorization(input: AsaasMarketplaceWalletReturnRequest,
    authorization: AsaasMarketplaceWalletReturnAuthorizationRecord | undefined): authorization is AsaasMarketplaceWalletReturnAuthorizationRecord {
    return !!authorization && authorization.requestHash === input.requestHash && authorization.authorizationId === input.authorization.id &&
      ["claimed", "submitted", "returned"].includes(authorization.state) &&
      (authorization.providerTransferId === undefined || identifier(authorization.providerTransferId));
  }

  async submit(input: AsaasMarketplaceWalletReturnRequest): Promise<AsaasMarketplaceWalletReturnSubmission> {
    let admissionAttempted = false, postAttempted = false;
    try {
      input = structuredClone(input);
      this.validate(input);
      if (!this.authorization) return { state: "not_submitted" };
      const authorization = await this.authorization.read(input.requestHash);
      if (!this.matchesAuthorization(input, authorization)) return { state: "not_submitted" };
      // Existing submitted/returned authorizations never authorize another POST.
      if (authorization.state !== "claimed" || authorization.providerTransferId) return { state: "unknown" };
      await this.wallets(input);
      const confirmedRefunds = this.refundPrefix(input, authorization);
      await this.payment(input, confirmedRefunds);
      const original = await this.original(input);
      const statements = await this.statements(input);
      this.originalLedger(input, statements);
      // Asaas documents no externalReference filter or replay idempotency key.
      // Complete bounded history is mandatory even before consuming admission.
      if (await this.findReturn(input)) return { state: "unknown" };
      if (canonical(original) !== canonical(await this.original(input))) throw Error("marketplace_asaas_wallet_return_original_changed");
      await this.payment(input, confirmedRefunds);
      admissionAttempted = true;
      const permit = await this.authorization.consumeSubmissionAuthorization(input.requestHash);
      if (!permit || permit.state !== "submission_authorized" || permit.requestHash !== input.requestHash ||
          permit.authorizationId !== input.authorization.id) return { state: "unknown" };
      postAttempted = true;
      const receipt = await this.json("seller", "/transfers/", { method: "POST", body: JSON.stringify({
        value: input.amountCents / 100, walletId: input.host.walletId, externalReference: input.reference,
      }) });
      if (!identifier(receipt.id) || receipt.id === input.originalPayout.providerTransferId || receipt.walletId !== input.host.walletId ||
          receipt.externalReference !== input.reference || money(receipt.value) !== input.amountCents) return { state: "unknown" };
      // Even synchronous DONE/FAILED is only a submitted identity. A separate
      // GET, complete history and both financial statements decide the result.
      return { state: "pending", providerTransferId: receipt.id, amountCents: input.amountCents, observedAt: this.now().toISOString() };
    } catch { return { state: admissionAttempted || postAttempted ? "unknown" : "not_submitted" }; }
  }

  async reconcile(input: AsaasMarketplaceWalletReturnRequest,
    providerTransferId?: string): Promise<AsaasMarketplaceWalletReturnObservation> {
    try {
      input = structuredClone(input);
      this.validate(input);
      if (!this.authorization || providerTransferId !== undefined && !identifier(providerTransferId)) return { state: "unknown" };
      const authorization = await this.authorization.read(input.requestHash);
      if (!this.matchesAuthorization(input, authorization) || authorization.state === "claimed" ||
          providerTransferId && authorization.providerTransferId && providerTransferId !== authorization.providerTransferId) return { state: "unknown" };
      await this.wallets(input);
      const historicalRefunds = this.refundPrefix(input, authorization);
      await this.payment(input, historicalRefunds);
      const original = await this.original(input);
      const found = await this.findReturn(input);
      const expectedId = providerTransferId ?? authorization.providerTransferId;
      if (!found || expectedId && found.id !== expectedId || found.id === input.originalPayout.providerTransferId) return { state: "unknown" };
      const returned = await this.json("seller", `/transfers/${encodeURIComponent(String(found.id))}`);
      this.returnReceipt(input, returned, String(found.id));
      const statements = await this.statements(input);
      const originalReceipts = this.originalLedger(input, statements);
      const returnedEntries = { host: statements.host.filter(row => row.transferId === returned.id),
        seller: statements.seller.filter(row => row.transferId === returned.id) };
      const base = { providerTransferId: String(returned.id), amountCents: input.amountCents, observedAt: this.now().toISOString() };
      if (["CANCELLED", "FAILED"].includes(String(returned.status))) return !returnedEntries.host.length && !returnedEntries.seller.length
        ? { state: "failed", ...base } : { state: "unknown" };
      if (["PENDING", "BANK_PROCESSING"].includes(String(returned.status))) return { state: "pending", ...base };
      if (returned.status !== "DONE" || returned.authorized !== true || !date(returned.effectiveDate)) return { state: "unknown" };
      const sellerReturnDebit = this.entry(returnedEntries.seller, String(returned.id), "INTERNAL_TRANSFER_DEBIT", -input.amountCents);
      const hostReturnCredit = this.entry(returnedEntries.host, String(returned.id), "INTERNAL_TRANSFER_CREDIT", input.amountCents);
      if (new Set([originalReceipts.originalHostDebit.id, originalReceipts.originalSellerCredit.id, sellerReturnDebit.id, hostReturnCredit.id]).size !== 4) return { state: "unknown" };
      // Re-read both resources after the ledger scan. A list or creation response
      // alone is never final proof; changed/cancelled/reversed histories hold.
      if (canonical(original) !== canonical(await this.original(input))) return { state: "unknown" };
      const latest = await this.json("seller", `/transfers/${encodeURIComponent(String(returned.id))}`);
      this.returnReceipt(input, latest, String(returned.id));
      if (canonical(this.transferIdentity(latest)) !== canonical(this.transferIdentity(returned))) return { state: "unknown" };
      await this.payment(input, historicalRefunds);
      await this.wallets(input);
      return { state: "returned", ...base, proof: { version: 1, kind: "authorized_wallet_return",
        association: "local_immutable_authorization", requestHash: input.requestHash, authorizationId: input.authorization.id,
        reference: input.reference, originalProviderTransferId: input.originalPayout.providerTransferId,
        providerTransferId: base.providerTransferId, hostAccountFingerprint: input.host.accountFingerprint,
        sellerAccountFingerprint: input.seller.accountFingerprint, hostWalletId: input.host.walletId,
        sellerWalletId: input.seller.walletId, amountCents: input.amountCents, observedAt: base.observedAt,
        ...originalReceipts, sellerReturnDebit, hostReturnCredit } };
    } catch { return { state: "unknown" }; }
  }

  private refundPrefix(input: AsaasMarketplaceWalletReturnRequest,
    authorization: AsaasMarketplaceWalletReturnAuthorizationRecord): Array<{ providerOperationId: string; amountCents: number }> {
    if (input.version === 1) {
      const frozen = (input as OriginalWalletReturnRequest).previousRefunds ?? [], current = authorization.confirmedRefunds;
      // Legacy V1 journals retain the empty submission prefix. A new original
      // return after earlier refunds uses only the prefix frozen by its claim.
      if (!frozen.length) return authorization.state === "returned" ? current ?? [] : [];
      if (!current || current.length < frozen.length || authorization.state !== "returned" && current.length !== frozen.length ||
        canonical(current.slice(0, frozen.length)) !== canonical(frozen)) throw Error("marketplace_asaas_wallet_return_prefix_changed");
      return current;
    }
    const frozen = input.residual!.previousRefunds, current = authorization.confirmedRefunds;
    if (!current || current.length < frozen.length || current.length > frozen.length + (authorization.state === "returned" ? 1 : 0) ||
        canonical(current.slice(0, frozen.length)) !== canonical(frozen)) throw Error("marketplace_asaas_residual_wallet_return_prefix_changed");
    return current;
  }

  private async wallets(input: AsaasMarketplaceWalletReturnRequest): Promise<void> {
    for (const role of ["host", "seller"] as const) {
      const result = await this.json(role, "/wallets/");
      if (result.object !== "list" || result.hasMore !== false || result.totalCount !== 1 || !Array.isArray(result.data) || result.data.length !== 1 ||
          !object(result.data[0]) || result.data[0].object !== "wallet" || result.data[0].id !== input[role].walletId) {
        throw Error("marketplace_asaas_wallet_return_wallet_mismatch");
      }
    }
  }

  private async payment(input: AsaasMarketplaceWalletReturnRequest,
    confirmedRefunds: Array<{ providerOperationId: string; amountCents: number }> = []): Promise<void> {
    const capture = input.capture;
    const payment = await this.json("host", `/payments/${encodeURIComponent(capture.providerPaymentId)}`);
    if (!Array.isArray(confirmedRefunds) || confirmedRefunds.length > 2000 ||
        new Set(confirmedRefunds.map(row => row.providerOperationId)).size !== confirmedRefunds.length ||
        confirmedRefunds.some(row => !/^asaas_refund_[a-f0-9]{64}$/.test(row.providerOperationId) || !cents(row.amountCents)) ||
        confirmedRefunds.reduce((sum, row) => sum + row.amountCents, 0) > capture.netAmountCents ||
        payment.id !== capture.providerPaymentId || !(confirmedRefunds.length ? ["RECEIVED", "REFUNDED"].includes(String(payment.status)) : payment.status === "RECEIVED") ||
        payment.billingType !== (input.paymentMethod === "pix" ? "PIX" : "CREDIT_CARD") || money(payment.value) !== capture.amountCents ||
        !confirmedRefunds.length && money(payment.netValue) !== capture.netAmountCents || payment.deleted === true || payment.anticipated === true ||
        !absent(payment.chargeback) || !absent(payment.installment) || !absent(payment.subscription) ||
        payment.refundedValue !== undefined && money(payment.refundedValue) !== confirmedRefunds.reduce((sum, row) => sum + row.amountCents, 0) ||
        payment.split !== undefined && (!Array.isArray(payment.split) || payment.split.length > 0)) {
      throw Error("marketplace_asaas_wallet_return_capture_changed");
    }
    // A certified wallet movement survives the buyer's own later DONE refunds.
    // Every live receipt must be in the independently committed local prefix.
    // New, pending, cancelled, missing or changed history remains inconclusive.
    const receipts = payment.refunds ?? [];
    if (!Array.isArray(receipts) || receipts.length !== confirmedRefunds.length) throw Error("marketplace_asaas_wallet_return_refund_history_changed");
    const expected = new Map(confirmedRefunds.map(row => [row.providerOperationId, row.amountCents]));
    for (const receipt of receipts) {
      if (!object(receipt) || receipt.status !== "DONE" || typeof receipt.description !== "string" || !receipt.description ||
        typeof receipt.dateCreated !== "string" || !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(receipt.dateCreated) ||
        !Number.isFinite(Date.parse(receipt.dateCreated.replace(" ", "T") + "Z")) ||
        receipt.refundedSplits !== undefined && receipt.refundedSplits !== null && (!Array.isArray(receipt.refundedSplits) || receipt.refundedSplits.length)) {
        throw Error("marketplace_asaas_wallet_return_refund_receipt_invalid");
      }
      const key = asaasMarketplaceRefundReceiptId(capture, receipt as { description: string; dateCreated: string; value: number });
      if (expected.get(key) !== money(receipt.value)) throw Error("marketplace_asaas_wallet_return_refund_history_changed");
      expected.delete(key);
    }
    if (expected.size) throw Error("marketplace_asaas_wallet_return_refund_history_missing");
  }

  private async original(input: AsaasMarketplaceWalletReturnRequest): Promise<JsonObject> {
    const original = input.originalPayout;
    const row = await this.json("host", `/transfers/${encodeURIComponent(original.providerTransferId)}`);
    this.transferReceipt(row, original.providerTransferId, original.reference, original.amountCents);
    if (row.status !== "DONE" || row.authorized !== true || !date(row.effectiveDate) || row.dateCreated !== original.dateCreated ||
        row.walletId !== undefined && row.walletId !== input.seller.walletId) throw Error("marketplace_asaas_wallet_return_original_mismatch");
    return this.transferIdentity(row);
  }

  private transferReceipt(row: JsonObject, id: string, reference: string, amountCents: number): void {
    if (row.object !== "transfer" || row.id !== id || row.externalReference !== reference || row.type !== "INTERNAL" ||
        row.operationType !== "INTERNAL" || money(row.value) !== amountCents || money(row.netValue) !== amountCents ||
        money(row.transferFee) !== 0 || !date(row.dateCreated) || !absent(row.bankAccount) || !absent(row.recurring)) {
      throw Error("marketplace_asaas_wallet_return_transfer_mismatch");
    }
  }

  private returnReceipt(input: AsaasMarketplaceWalletReturnRequest, row: JsonObject, id: string): void {
    this.transferReceipt(row, id, input.reference, input.amountCents);
    if ((row.dateCreated as string) < input.originalPayout.dateCreated || row.walletId !== undefined && row.walletId !== input.host.walletId) {
      throw Error("marketplace_asaas_wallet_return_destination_mismatch");
    }
  }

  private transferIdentity(row: JsonObject): JsonObject {
    return Object.fromEntries(["id", "externalReference", "type", "operationType", "dateCreated", "effectiveDate", "status",
      "authorized", "value", "netValue", "transferFee", "walletId"].map(key => [key, row[key]]));
  }

  private async findReturn(input: AsaasMarketplaceWalletReturnRequest): Promise<JsonObject | undefined> {
    const rows = await this.list("seller", `/transfers?type=ASAAS_ACCOUNT&dateCreated%5Bge%5D=${input.originalPayout.dateCreated}`);
    const candidates = rows.filter(row => row.externalReference === input.reference);
    if (candidates.length > 1) throw Error("marketplace_asaas_wallet_return_duplicate_receipts");
    return candidates[0];
  }

  private async statements(input: AsaasMarketplaceWalletReturnRequest): Promise<{ host: JsonObject[]; seller: JsonObject[] }> {
    const path = `/financialTransactions?startDate=${input.originalPayout.dateCreated}&order=asc`;
    return { host: await this.list("host", path), seller: await this.list("seller", path) };
  }

  private originalLedger(input: AsaasMarketplaceWalletReturnRequest, statements: { host: JsonObject[]; seller: JsonObject[] }): {
    originalHostDebit: AsaasMarketplaceWalletReturnLedgerReceipt; originalSellerCredit: AsaasMarketplaceWalletReturnLedgerReceipt;
  } {
    const original = input.originalPayout;
    return { originalHostDebit: this.entry(statements.host.filter(row => row.transferId === original.providerTransferId),
      original.providerTransferId, "INTERNAL_TRANSFER_DEBIT", -original.amountCents),
    originalSellerCredit: this.entry(statements.seller.filter(row => row.transferId === original.providerTransferId),
      original.providerTransferId, "INTERNAL_TRANSFER_CREDIT", original.amountCents) };
  }

  private entry(rows: JsonObject[], transferId: string, type: AsaasMarketplaceWalletReturnLedgerReceipt["type"],
    amountCents: number): AsaasMarketplaceWalletReturnLedgerReceipt {
    const row = rows[0];
    if (rows.length !== 1 || !row || row.object !== "financialTransaction" || !identifier(row.id) || row.transferId !== transferId ||
        row.type !== type || money(row.value) !== amountCents || !date(row.date) || !absent(row.paymentId) || !absent(row.splitId) ||
        !absent(row.anticipationId) || !absent(row.billId)) throw Error("marketplace_asaas_wallet_return_ledger_mismatch");
    return { id: row.id, transferId, type, amountCents, date: row.date };
  }

  private async list(role: "host" | "seller", path: string): Promise<JsonObject[]> {
    const rows: JsonObject[] = [], seen = new Set<string>();
    let offset = 0, expectedTotal: number | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await this.json(role, `${path}&limit=100&offset=${offset}`);
      if (result.object !== "list" || typeof result.hasMore !== "boolean" || !Number.isSafeInteger(result.totalCount) || Number(result.totalCount) < 0 ||
          result.offset !== offset || !Number.isSafeInteger(result.limit) || Number(result.limit) < 1 || Number(result.limit) > 100 ||
          !Array.isArray(result.data) || result.data.length > Number(result.limit) ||
          expectedTotal !== undefined && result.totalCount !== expectedTotal) throw Error("marketplace_asaas_wallet_return_history_invalid");
      expectedTotal = Number(result.totalCount);
      for (const row of result.data) {
        if (!object(row) || !identifier(row.id) || seen.has(row.id)) throw Error("marketplace_asaas_wallet_return_history_invalid");
        seen.add(row.id); rows.push(row);
      }
      if (!result.hasMore) {
        if (rows.length !== expectedTotal) throw Error("marketplace_asaas_wallet_return_history_incomplete");
        return rows;
      }
      if (!result.data.length || rows.length >= expectedTotal) throw Error("marketplace_asaas_wallet_return_history_incomplete");
      offset += result.data.length;
    }
    throw Error("marketplace_asaas_wallet_return_history_incomplete");
  }

  private async json(role: "host" | "seller", path: string, init: RequestInit = {}): Promise<JsonObject> {
    const config = this.config[role];
    const response = await this.request(`${new URL(config.asaasOrigin!).origin}/v3${path}`, { ...init,
      headers: { access_token: config.asaasKey!, accept: "application/json", "content-type": "application/json", "user-agent": "ZyonMarketplace/1.0" },
      redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Error("marketplace_asaas_wallet_return_provider_unavailable");
    const body: unknown = await response.json();
    if (!object(body)) throw Error("marketplace_asaas_wallet_return_response_invalid");
    return body;
  }
}
