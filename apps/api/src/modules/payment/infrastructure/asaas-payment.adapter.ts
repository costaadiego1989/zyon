import { assertStandardCancellationInput, exactCancellationAmount, type PendingPaymentCancellationInput, type PendingPaymentCancellationResult } from "../domain/pending-payment-cancellation.js";
import { Injectable } from "@nestjs/common";
import { marketplaceCaptureAccount } from "../../marketplace/infrastructure/marketplace-capture-account.js";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchRefundStatusInput,
  FetchRefundStatusOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  ReadMarketplacePaymentActionOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

function asaasStateFromStatus(status: string | undefined): FetchPaymentStatusOutput["state"] {
  switch (status) {
    case "RECEIVED":
    case "CONFIRMED":
    case "RECEIVED_IN_CASH":
      return "approved";
    case "OVERDUE":
    case "REFUNDED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "DELETED":
      return "failed";
    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
      return "pending";
    default:
      return "unknown";
  }
}

export function safeAsaasSandboxInvoice(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "sandbox.asaas.com" && !url.port && !url.username && !url.password &&
      /^\/i\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.hash && !url.search ? url.href : undefined;
  } catch { return undefined; }
}

/** Preserve explicit offsets; this sandbox profile interprets offset-free timestamps as UTC-03.
 * The offset assumption still requires provider sandbox homologation. */
export function asaasQrExpiration(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return undefined;
  const normalized = value.replace(" ", "T"), timestamp = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : `${normalized}-03:00`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

type AsaasBillingType = "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";

type AsaasRefund = {
  id?: string;
  status?: string;
  description?: string;
};

const ASAAS_DESCRIPTION_REFERENCE_PREFIX = "asaas:description:";

function asaasRefundState(status: string | undefined): FetchRefundStatusOutput["state"] {
  switch (status) {
    case "DONE":
      return "succeeded";
    case "PENDING":
    case "AWAITING_BANK_ACCOUNT":
    case "IN_ANALYSIS":
      return "pending";
    case "CANCELLED":
    case "FAILED":
    case "REFUSED":
      return "failed";
    default:
      return "unknown";
  }
}

function asaasDescriptionReference(reference: string): string {
  return `${ASAAS_DESCRIPTION_REFERENCE_PREFIX}${reference}`;
}

function referenceFromAsaasRefundInput(input: FetchRefundStatusInput): string | undefined {
  if (input.refundReference) return input.refundReference;
  if (input.providerRefundId.startsWith(ASAAS_DESCRIPTION_REFERENCE_PREFIX)) {
    return input.providerRefundId.slice(ASAAS_DESCRIPTION_REFERENCE_PREFIX.length);
  }
  return undefined;
}

function billingFromMethod(method: string): AsaasBillingType {
  switch (method) {
    case "pix":
      return "PIX";
    case "boleto":
      return "BOLETO";
    case "card":
      return "CREDIT_CARD";
    default:
      return "UNDEFINED";
  }
}

function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

function asaasCustomerPhone(input: string | undefined): { field: "phone" | "mobilePhone"; value: string } | undefined {
  if (!input) return undefined;
  let digits = input.replace(/\D/g, "");
  // Checkout callers commonly include the Brazilian country code. Asaas
  // expects the national number and distinguishes landline from mobile.
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2);
  }
  if (digits.length === 11) return { field: "mobilePhone", value: digits };
  if (digits.length === 10) return { field: "phone", value: digits };
  return undefined;
}

function defaultDueDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

type AsaasFixedSplitNetValueGuard = (input: CreateProviderPaymentInput) => number | undefined;

type AsaasProviderFeeEnvelope = Readonly<{ fixedCents: number; basisPoints: number }>;

/**
 * Public standard receiving fees published by Asaas. These are a conservative
 * fallback only for ordinary receipts: an account-specific contract or
 * anticipation can deduct more and must be declared through the environment
 * overrides below.
 */
const ASAAS_PUBLIC_STANDARD_MAXIMUM_FEE: Readonly<Record<Exclude<AsaasBillingType, "UNDEFINED">, AsaasProviderFeeEnvelope>> = {
  PIX: { fixedCents: 199, basisPoints: 0 },
  BOLETO: { fixedCents: 199, basisPoints: 0 },
  CREDIT_CARD: { fixedCents: 49, basisPoints: 429 },
};

/**
 * Returns a conservative maximum for the provider deduction from this charge.
 *
 * A fixed Asaas split is evaluated against `netValue`, not the amount shown to
 * the buyer. The public Asaas schedule supplies a conservative baseline for
 * ordinary receipts, while an account-specific contract or anticipation must
 * override it with the worst applicable deduction through the environment.
 */
export function maximumAsaasProviderFeeCents(
  input: Pick<CreateProviderPaymentInput, "amountCents" | "method">,
  env: NodeJS.ProcessEnv = process.env,
): number | undefined {
  const method = billingFromMethod(input.method);
  if (method === "UNDEFINED" || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    return undefined;
  }
  const configured = configuredAsaasProviderFeeEnvelope(method, env);
  if (configured === undefined) return undefined;

  // A fee expressed in basis points can round up to the next cent. Rounding
  // upward here keeps the preflight conservative.
  const percentageFee = Math.ceil((input.amountCents * configured.basisPoints) / 10_000);
  const maximum = configured.fixedCents + percentageFee;
  return Number.isSafeInteger(maximum) ? maximum : undefined;
}

function configuredAsaasProviderFeeEnvelope(
  method: Exclude<AsaasBillingType, "UNDEFINED">,
  env: NodeJS.ProcessEnv,
): AsaasProviderFeeEnvelope | undefined {
  const prefix = `ASAAS_PLATFORM_SPLIT_MAX_PROVIDER_FEE_${method}`;
  const fixedRaw = env[`${prefix}_FIXED_CENTS`];
  const basisPointsRaw = env[`${prefix}_BPS`];
  if (fixedRaw === undefined && basisPointsRaw === undefined) return ASAAS_PUBLIC_STANDARD_MAXIMUM_FEE[method];

  const fixedCents = parseNonNegativeInteger(fixedRaw);
  const basisPoints = parseNonNegativeInteger(basisPointsRaw);
  if (fixedCents === undefined || basisPoints === undefined || basisPoints > 10_000) return undefined;
  return { fixedCents, basisPoints };
}

function parseNonNegativeInteger(value: string | undefined): number | undefined {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

@Injectable()
export class AsaasPaymentAdapter implements PaymentProviderPort {
  private readonly normalizedBaseUrl: string;
  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly platformWalletId?: string,
    private readonly requirePlatformSplit = false,
    private readonly platformSplitMaximumProviderFeeCents: AsaasFixedSplitNetValueGuard = maximumAsaasProviderFeeCents,
  ) {
    // Normalize: ASAAS_BASE_URL may already include the /v3 suffix (e.g.
    // https://www.asaas.com/api/v3). All methods build `${base}/v3/...`, so strip
    // a trailing /v3 to avoid a duplicated /v3/v3 path. Keep /api intact.
    this.normalizedBaseUrl = apiBaseUrl.replace(/\/+$/, "").replace(/\/v3$/, "");
  }

  creationAccountFingerprint(): string { return createHash("sha256").update(`${this.apiBaseUrl}\0${this.apiKey}`).digest("hex"); }

  async prepareMarketplaceAccount(input: { provider: "stripe" | "asaas"; environment: "test" | "live" }) {
    if (input.provider !== "asaas") throw new Error("marketplace_capture_provider_mismatch");
    if (this.platformWalletId || this.requirePlatformSplit) throw new Error("marketplace_capture_split_forbidden");
    return marketplaceCaptureAccount("asaas", input.environment, this.apiKey, this.apiBaseUrl);
  }

  async readCancellationStatus(input: PendingPaymentCancellationInput): Promise<PendingPaymentCancellationResult> {
    assertStandardCancellationInput(input, "asaas", this.creationAccountFingerprint());
    const p = input.payment;
    if (p.method !== "pix") return { state: "unsupported" };
    const payment = await this.readCancellationPayment({ merchantId: p.merchantId, providerPaymentId: input.providerPaymentId });
    if (payment.id !== input.providerPaymentId || payment.externalReference !== p.intentId || payment.customer !== p.asaasCustomerId ||
        !p.asaasCustomerId || payment.billingType !== "PIX" || !exactCancellationAmount(payment.value, p.amountCents) ||
        payment.currency !== undefined && payment.currency !== "BRL") throw new Error("payment_cancellation_identity_mismatch");
    if (payment.subscription != null || payment.installment != null) return { state: "unsupported" };
    if (["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH", "REFUNDED", "REFUND_REQUESTED", "REFUND_IN_PROGRESS",
      "CHARGEBACK_REQUESTED", "CHARGEBACK_DISPUTE", "AWAITING_CHARGEBACK_REVERSAL"].includes(payment.status ?? "")) return { state: "paid" };
    if (!["PENDING", "OVERDUE"].includes(payment.status ?? "")) return { state: "unavailable" };
    return { state: payment.deleted === true ? "cancelled" : payment.deleted === false ? "pending" : "unknown" };
  }

  async cancelPendingPayment(input: PendingPaymentCancellationInput): Promise<PendingPaymentCancellationResult> {
    const before = await this.readCancellationStatus(input);
    if (before.state !== "pending") return before;
    const response = await this.fetchImpl(`${this.normalizedBaseUrl}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      method: "DELETE", headers: { accept: "application/json", access_token: this.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { state: "unknown" };
    const receipt = await response.json() as { id?: string; deleted?: boolean };
    if (receipt.id !== input.providerPaymentId || receipt.deleted !== true) return { state: "unknown" };
    // A 404 or acknowledgement alone cannot rule out a payment racing deletion.
    return this.readCancellationStatus(input);
  }

  private async readCancellationPayment(input: { providerPaymentId: string; merchantId: string }) {
    const response = await this.fetchImpl(`${this.normalizedBaseUrl}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`, { headers: { accept: "application/json", access_token: this.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error("payment_cancellation_status_unavailable");
    return response.json() as Promise<{ id?: string; externalReference?: string; customer?: string; billingType?: string; value?: number; currency?: string; subscription?: unknown; installment?: unknown; status?: string; deleted?: boolean }>;
  }

  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    const base = this.normalizedBaseUrl;
    const query = new URLSearchParams({ externalReference: input.intentId, limit: "100" });
    const response = await this.fetchImpl(`${base}/v3/payments?${query}`, {
      headers: { accept: "application/json", access_token: this.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("asaas_payment_recovery_failed");
    const result = await response.json() as { data?: Array<{ id?: string; externalReference?: string; customer?: string; value?: number; billingType?: string; status?: string; invoiceUrl?: string }>; hasMore?: boolean };
    if (!Array.isArray(result.data) || result.hasMore || result.data.length > 1) throw new Error("asaas_payment_recovery_ambiguous");
    if (result.data.length === 0) return null;
    const payment = result.data[0];
    if (payment.externalReference !== input.intentId || payment.customer !== input.asaasCustomerId ||
      payment.billingType !== billingFromMethod(input.method) || !Number.isFinite(payment.value) ||
      Math.round(payment.value! * 100) !== input.amountCents || input.currency !== "BRL") throw new Error("asaas_payment_recovery_mismatch");
    return this.createdOutput(input, payment);
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const payment = await this.readPayment(input);
    if (input.marketplaceAccount && (payment.status === "RECEIVED_IN_CASH" ||
      input.marketplacePayment?.method === "pix" && payment.status === "CONFIRMED")) return { state: "unknown" };
    return { state: asaasStateFromStatus(typeof payment.status === "string" ? payment.status : undefined),
      approvedAmountCents: typeof payment.value === "number" && Number.isFinite(payment.value) ? Math.round(payment.value * 100) : undefined };
  }

  private async readPayment(input: FetchPaymentStatusInput) {
    const marketplace = input.marketplaceAccount !== undefined || input.marketplacePayment !== undefined;
    if (marketplace) await this.assertMarketplaceStatusInput(input);
    const base = this.normalizedBaseUrl;
    const res = await this.fetchImpl(`${base}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      headers: {
        accept: "application/json",
        access_token: this.apiKey
      },
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      // Provider error bodies can contain customer and payment metadata. Keep
      // the status for operational diagnosis without letting that data reach
      // application logs or error reporting.
      throw new Error(`asaas_payment_fetch_failed:${res.status}`);
    }
    const payment = (await res.json()) as { id?: string; object?: string; status?: string; value?: number;
      externalReference?: string; customer?: string; billingType?: string; currency?: string;
      deleted?: boolean; split?: unknown; installment?: unknown; subscription?: unknown; invoiceUrl?: string;
      discount?: { value?: number }; fine?: { value?: number }; interest?: { value?: number } };
    if (marketplace) {
      const expected = input.marketplacePayment!;
      const cents = typeof payment?.value === "number" ? payment.value * 100 : NaN;
      if (!payment || payment.object !== "payment" || payment.id !== input.providerPaymentId ||
          payment.externalReference !== expected.intentId || payment.customer !== expected.asaasCustomerId ||
          payment.billingType !== billingFromMethod(expected.method) || payment.deleted !== false ||
          (payment.currency !== undefined && payment.currency !== "BRL") || !Number.isFinite(cents) ||
          Math.abs(cents - expected.amountCents) > 0.000001 || payment.installment != null || payment.subscription != null ||
          (payment.split != null && (!Array.isArray(payment.split) || payment.split.length !== 0))) {
        throw new Error("marketplace_payment_identity_mismatch");
      }
      // A manual cash receipt never funds the platform account. It must not
      // authorize marketplace fulfillment or seller payouts.
    }
    return payment;
  }

  /** Read the original charge only. Removed/overdue/risk-held charges expose no payable instructions. */
  async readMarketplacePaymentAction(input: FetchPaymentStatusInput): Promise<ReadMarketplacePaymentActionOutput> {
    const environment = input.marketplaceAccount?.environment;
    const method = input.marketplacePayment?.method;
    if (!(environment === "test" && (method === "pix" || method === "boleto") || environment === "live" && method === "pix")) {
      throw new Error("marketplace_payment_resume_identity_invalid");
    }
    const payment = await this.readPayment(input);
    if (payment.status !== "PENDING") return { providerStatus: payment.status === "RECEIVED" ? "succeeded" :
      ["CONFIRMED", "AWAITING_RISK_ANALYSIS"].includes(payment.status ?? "") ? "processing" : "unknown", action: null,
      reason: ["CONFIRMED", "AWAITING_RISK_ANALYSIS"].includes(payment.status ?? "") ? "payment_processing" : "payment_terminal" };
    // Dynamic QR/boleto amounts may change with surcharges. Do not show a frozen total alongside another payable amount.
    if ([payment.discount, payment.fine, payment.interest].some(value => value != null && value.value !== 0)) {
      throw new Error("marketplace_payment_identity_mismatch");
    }
    if (input.marketplacePayment!.method === "boleto") {
      const invoiceUrl = safeAsaasSandboxInvoice(payment.invoiceUrl);
      if (!invoiceUrl) throw new Error("marketplace_payment_instructions_invalid");
      return { providerStatus: "requires_action", action: { kind: "asaas_boleto", invoiceUrl }, reason: null };
    }
    const response = await this.fetchImpl(`${this.normalizedBaseUrl}/v3/payments/${encodeURIComponent(input.providerPaymentId)}/pixQrCode`, {
      headers: { accept: "application/json", access_token: this.apiKey }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("marketplace_payment_instructions_unavailable");
    const qr = await response.json() as { payload?: unknown; encodedImage?: unknown; expirationDate?: unknown };
    const expiresAt = asaasQrExpiration(qr.expirationDate);
    if (typeof qr.payload !== "string" || !qr.payload.trim() || qr.payload.length > 4096 || /[\u0000-\u001f]/.test(qr.payload) ||
      !expiresAt || Date.parse(expiresAt) <= Date.now() || qr.encodedImage !== undefined &&
      (typeof qr.encodedImage !== "string" || qr.encodedImage.length > 1_000_000 || !/^[A-Za-z0-9+/=]+$/.test(qr.encodedImage))) {
      throw new Error("marketplace_payment_instructions_invalid");
    }
    // A concurrent deletion or amount change between both GETs must not expose stale instructions.
    const after = await this.readPayment(input);
    if (after.status !== "PENDING" || [after.discount, after.fine, after.interest].some(value => value != null && value.value !== 0)) {
      return { providerStatus: "unknown", action: null, reason: "payment_action_unavailable" };
    }
    return { providerStatus: "requires_action", action: { kind: "asaas_pix", copyPaste: qr.payload,
      ...(typeof qr.encodedImage === "string" ? { encodedImage: qr.encodedImage } : {}), expiresAt }, reason: null };
  }

  private async assertMarketplaceStatusInput(input: FetchPaymentStatusInput): Promise<void> {
    const account = input.marketplaceAccount, payment = input.marketplacePayment;
    if (!account || !payment || input.provider !== "asaas" || account.provider !== "asaas" || input.settlementMode ||
        input.providerAccountFingerprint !== account.accountFingerprint || !/^[a-f0-9]{64}$/.test(account.accountFingerprint) ||
        !input.merchantId?.trim() || !input.providerPaymentId?.trim() || !payment.intentId?.trim() ||
        !payment.sessionId?.trim() || payment.currency !== "BRL" || !["pix", "boleto", "card"].includes(payment.method) ||
        !payment.asaasCustomerId?.trim() || !Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) {
      throw new Error("marketplace_payment_identity_invalid");
    }
    const actual = await this.prepareMarketplaceAccount(account);
    if (actual.accountFingerprint !== account.accountFingerprint) throw new Error("marketplace_capture_account_mismatch");
  }

  async cancelPayment(input: FetchPaymentStatusInput): Promise<{ state: "cancelled" | "blocked" | "unknown" }> {
    const url = `${this.normalizedBaseUrl}/v3/payments/${encodeURIComponent(input.providerPaymentId)}`;
    const headers = { accept: "application/json", access_token: this.apiKey };
    const read = async () => {
      const response = await this.fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return undefined;
      return response.json() as Promise<{ deleted?: boolean; status?: string }>;
    };
    const payment = await read();
    if (!payment || !["PENDING", "OVERDUE"].includes(payment.status ?? "")) return { state: "blocked" };
    if (payment.deleted === true) return { state: "cancelled" };
    const response = await this.fetchImpl(url, { method: "DELETE", headers, redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { state: "unknown" };
    const result = await response.json() as { deleted?: boolean };
    if (result.deleted !== true) return { state: "unknown" };
    // Asaas can delete a paid charge without refunding it. Confirm that the
    // removed charge is still unpaid before admitting a replacement payment.
    const removed = await read();
    if (!removed) return { state: "unknown" };
    if (!["PENDING", "OVERDUE"].includes(removed.status ?? "")) return { state: "blocked" };
    return { state: removed.deleted === true ? "cancelled" : "unknown" };
  }

  async fetchRefundStatus(input: FetchRefundStatusInput): Promise<FetchRefundStatusOutput> {
    const base = this.normalizedBaseUrl;
    const res = await this.fetchImpl(
      `${base}/v3/payments/${encodeURIComponent(input.providerPaymentId)}/refunds`,
      {
        headers: { accept: "application/json", access_token: this.apiKey },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) throw new Error(`asaas_refund_fetch_failed:${res.status}`);
    const body = await res.json() as { data?: AsaasRefund[]; refunds?: AsaasRefund[] };
    const refunds = body.data ?? body.refunds ?? [];
    const reference = referenceFromAsaasRefundInput(input);
    // Asaas documents its refund list with description and status, but no
    // durable refund id. Each return has a stable return:<id> description, so
    // it remains individually reconcilable when a payment has partial refunds.
    const refund = reference
      ? refunds.find((item) => item.description === reference)
      : refunds.find((item) => item.id === input.providerRefundId);
    return { state: asaasRefundState(refund?.status) };
  }

  async createCustomer(input: {
    merchantId: string;
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
  }): Promise<string> {
    const base = this.normalizedBaseUrl;
    const body: Record<string, unknown> = {
      name: input.name,
      email: input.email,
      cpfCnpj: input.cpfCnpj.replace(/\D/g, "")
    };
    const phone = asaasCustomerPhone(input.phone);
    if (phone) body[phone.field] = phone.value;

    const cpfDigits = input.cpfCnpj.replace(/\D/g, "");

    // Idempotency: if a customer with this CPF already exists in Asaas, reuse it
    // instead of failing. Asaas rejects duplicate cpfCnpj on create.
    const existingId = await this.findCustomerByCpf(base, cpfDigits);
    if (existingId) return existingId;

    const res = await this.fetchImpl(`${base}/v3/customers`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: this.apiKey
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      // On duplicate/validation error, try one more lookup before giving up
      const recovered = await this.findCustomerByCpf(base, cpfDigits);
      if (recovered) return recovered;
      throw new Error(`asaas_customer_create_failed:${res.status}`);
    }

    const result = (await res.json()) as { id?: string };
    if (!result.id) throw new Error("asaas_customer_missing_id");
    return result.id;
  }

  /** Look up an existing Asaas customer by CPF. Returns the id or undefined. */
  private async findCustomerByCpf(base: string, cpfDigits: string): Promise<string | undefined> {
    if (!cpfDigits) return undefined;
    try {
      const res = await this.fetchImpl(`${base}/v3/customers?cpfCnpj=${cpfDigits}`, {
        method: "GET",
        headers: {
          accept: "application/json",
          access_token: this.apiKey
        },
        redirect: "error", signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return undefined;
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      return data.data?.[0]?.id ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async tokenizeCreditCard(input: CreateProviderPaymentInput): Promise<string> {
    const base = this.normalizedBaseUrl;
    const tokenizeBody: Record<string, unknown> = {
      customer: input.asaasCustomerId,
      creditCard: {
        holderName: input.creditCard!.holderName,
        number: input.creditCard!.number.replace(/\s+/g, ""),
        expiryMonth: input.creditCard!.expiryMonth,
        expiryYear: input.creditCard!.expiryYear,
        ccv: input.creditCard!.ccv
      },
      creditCardHolderInfo: {
        name: input.creditCardHolderInfo?.name ?? input.creditCard!.holderName,
        email: input.creditCardHolderInfo?.email ?? "",
        cpfCnpj: (input.creditCardHolderInfo?.cpfCnpj ?? "").replace(/\D/g, ""),
        postalCode: (input.creditCardHolderInfo?.postalCode ?? "").replace(/\D/g, ""),
        addressNumber: input.creditCardHolderInfo?.addressNumber ?? "S/N",
        phone: (input.creditCardHolderInfo?.phone ?? "").replace(/\D/g, "")
      }
    };

    if (input.remoteIp) {
      tokenizeBody.remoteIp = input.remoteIp;
    }

    const res = await this.fetchImpl(`${base}/v3/creditCard/tokenize`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: this.apiKey
      },
      body: JSON.stringify(tokenizeBody),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      throw new Error(`asaas_tokenize_failed:${res.status}`);
    }

    const result = (await res.json()) as { creditCardToken?: string };
    if (!result.creditCardToken) {
      throw new Error("asaas_tokenize_missing_token");
    }

    return result.creditCardToken;
  }

  validatePlatformFee(input: CreateProviderPaymentInput): void {
    const platformFeeCents = input.platformFeeCents ?? 0;
    if (this.requirePlatformSplit && platformFeeCents > 0 && !this.platformWalletId) {
      throw new Error("asaas_platform_wallet_not_configured");
    }
    if (!this.platformWalletId || platformFeeCents <= 0) return;

    const maximumProviderFeeCents = this.platformSplitMaximumProviderFeeCents(input);
    if (maximumProviderFeeCents === undefined) {
      throw new Error("asaas_platform_split_net_value_guard_not_configured");
    }
    if (platformFeeCents > input.amountCents - maximumProviderFeeCents) {
      throw new Error("asaas_platform_split_may_exceed_net_value");
    }
  }

  /** Validates the local route/configuration without making a PSP request. */
  async preparePayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentInput> {
    this.validatePlatformFee(input);
    return input;
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (!["pix", "card"].includes(input.method)) throw new Error("payment_method_not_supported");
    this.validatePlatformFee(input);
    const base = this.normalizedBaseUrl;
    if (input.currency !== "BRL") throw new Error("asaas_currency_unsupported");
    const billingType = billingFromMethod(input.method);
    const body: Record<string, unknown> = {
      customer: input.asaasCustomerId,
      billingType,
      value: majorUnitsFromCents(input.amountCents),
      dueDate: defaultDueDate(),
      description: input.description ?? `Checkout ${input.sessionId}`,
      externalReference: input.intentId
    };

    if (billingType === "CREDIT_CARD" && input.creditCard) {
      const creditCardToken = await this.tokenizeCreditCard(input);
      body.creditCardToken = creditCardToken;
    }

    if (this.platformWalletId && (input.platformFeeCents ?? 0) > 0) {
      body.split = [{ walletId: this.platformWalletId, fixedValue: majorUnitsFromCents(input.platformFeeCents!) }];
    }

    const res = await this.fetchImpl(`${base}/v3/payments`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: this.apiKey
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      throw new Error(`asaas_payment_create_failed:${res.status}`);
    }

    const created = (await res.json()) as { id?: string; status?: string; invoiceUrl?: string };
    return this.createdOutput(input, created);
  }

  private async createdOutput(input: CreateProviderPaymentInput, created: { id?: string; status?: string; invoiceUrl?: string }): Promise<CreateProviderPaymentOutput> {
    const base = this.normalizedBaseUrl;
    const billingType = billingFromMethod(input.method);
    const providerPaymentId = typeof created?.id === "string" ? created.id.trim() : "";
    if (!providerPaymentId) throw new Error("asaas_payment_missing_id");

    if (["connected_physical_sandbox_v2", "connected_physical_live_v2"].includes(input.marketplacePublicAdmission?.profile ?? "")) {
      const observed = await this.readMarketplacePaymentAction({ marketplaceAccount: input.marketplaceFunding!,
        marketplacePayment: { intentId: input.intentId, sessionId: input.sessionId, amountCents: input.amountCents,
          currency: input.currency, method: input.method, asaasCustomerId: input.asaasCustomerId },
        provider: input.provider, providerAccountFingerprint: input.providerAccountFingerprint, merchantId: input.merchantId, providerPaymentId });
      const action = observed.action;
      return { providerPaymentId, status: action ? "requires_action" : "pending", buyerFacingPayload:
        action?.kind === "asaas_pix" ? { qrCodeCopyPaste: action.copyPaste, encodedQrImage: action.encodedImage, quoteExpiresAt: action.expiresAt } :
        action?.kind === "asaas_boleto" ? { invoiceUrl: action.invoiceUrl } : {} };
    }

    const buyerFacingPayload: CreateProviderPaymentOutput["buyerFacingPayload"] = {
      invoiceUrl: typeof created.invoiceUrl === "string" ? created.invoiceUrl : undefined
    };

    if (billingType === "PIX") {
      const qr = await this.fetchImpl(`${base}/v3/payments/${encodeURIComponent(providerPaymentId)}/pixQrCode`, {
        headers: {
          accept: "application/json",
          access_token: this.apiKey
        },
        redirect: "error",
      signal: AbortSignal.timeout(15_000)
      });
      if (qr.ok) {
        const pj = (await qr.json()) as { payload?: string; encodedImage?: string; expirationDate?: string };
        if (typeof pj.payload === "string") buyerFacingPayload.qrCodeCopyPaste = pj.payload;
        if (typeof pj.encodedImage === "string") buyerFacingPayload.encodedQrImage = pj.encodedImage;
      }
      // PIX expires in 30 minutes by default (Asaas standard)
      buyerFacingPayload.quoteExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }

    const status: CreateProviderPaymentOutput["status"] =
      billingType === "CREDIT_CARD" && (created.status === "CONFIRMED" || created.status === "RECEIVED")
        ? "pending"
        : billingType === "PIX"
          ? "requires_action"
          : "pending";

    return {
      providerPaymentId,
      status,
      buyerFacingPayload
    };
  }

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string }) {
    const base = this.normalizedBaseUrl;
    const res = await this.fetchImpl(`${base}/v3/payments/${encodeURIComponent(input.providerPaymentId)}/refund`, {
      method: "POST",
      headers: { "Content-Type": "application/json", access_token: this.apiKey },
      body: JSON.stringify({ value: input.amountCents / 100, description: input.reason ?? "Customer requested refund" }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      throw new Error(`asaas_refund_failed:${res.status}`);
    }
    const data = await res.json() as { id?: string; refunds?: AsaasRefund[] };
    const reference = input.reason;
    const refund = reference ? data.refunds?.find((item) => item.description === reference) : undefined;
    let state = asaasRefundState(refund?.status);
    // The refund POST can return a payment representation without its `refunds`
    // array. Read the authoritative list once in that case so a terminal
    // cancellation is visible to the operator immediately; a failed read stays
    // PENDING and is reconciled later without issuing another financial POST.
    if (state === "unknown" && reference) {
      try {
        state = (await this.fetchRefundStatus({
          merchantId: input.merchantId,
          providerPaymentId: input.providerPaymentId,
          providerRefundId: asaasDescriptionReference(reference),
          refundReference: reference,
        })).state;
      } catch {
        state = "pending";
      }
    }
    // The POST merely accepts a request. A return is locally complete only for
    // Asaas status DONE; all other outcomes use the durable PENDING workflow.
    return {
      refundId: reference ? asaasDescriptionReference(reference) : data.id ?? input.providerPaymentId,
      status: state === "succeeded" ? "succeeded" as const : state === "failed" ? "failed" as const : "pending" as const,
    };
  }
}
