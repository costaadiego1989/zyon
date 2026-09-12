import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchRefundStatusInput,
  FetchRefundStatusOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
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

  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    const base = this.apiBaseUrl.replace(/\/+$/, "");
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
    const payment = (await res.json()) as { status?: string; value?: number };
    const state = asaasStateFromStatus(typeof payment.status === "string" ? payment.status : undefined);
    const approvedAmountCents =
      typeof payment.value === "number" && !Number.isNaN(payment.value)
        ? Math.round(payment.value * 100)
        : undefined;
    return { state, approvedAmountCents };
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
        signal: AbortSignal.timeout(15_000)
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
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const billingType = billingFromMethod(input.method);
    const providerPaymentId = typeof created?.id === "string" ? created.id.trim() : "";
    if (!providerPaymentId) throw new Error("asaas_payment_missing_id");

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
