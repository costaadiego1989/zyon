import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
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

function defaultDueDate(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class AsaasPaymentAdapter implements PaymentProviderPort {
  private readonly normalizedBaseUrl: string;
  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly platformWalletId?: string,
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
      const errorText = await res.text().catch(() => "");
      throw new Error(`asaas_payment_fetch_failed:${res.status}:${errorText}`);
    }
    const payment = (await res.json()) as { status?: string; value?: number };
    const state = asaasStateFromStatus(typeof payment.status === "string" ? payment.status : undefined);
    const approvedAmountCents =
      typeof payment.value === "number" && !Number.isNaN(payment.value)
        ? Math.round(payment.value * 100)
        : undefined;
    return { state, approvedAmountCents };
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
    if (input.phone) body.phone = input.phone.replace(/\D/g, "");

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
      const errorText = await res.text().catch(() => "");
      console.error(`[asaas-adapter] createCustomer failed: status=${res.status} body=${errorText.slice(0, 500)}`);
      // On duplicate/validation error, try one more lookup before giving up
      const recovered = await this.findCustomerByCpf(base, cpfDigits);
      if (recovered) return recovered;
      throw new Error(`asaas_customer_create_failed:${res.status}:${errorText}`);
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
      if (!res.ok) { console.error(`[asaas-adapter] findCustomerByCpf status=${res.status}`); return undefined; }
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      console.error(`[asaas-adapter] findCustomerByCpf cpf=${cpfDigits} found=${data.data?.length ?? 0} id=${data.data?.[0]?.id}`);
      return data.data?.[0]?.id ?? undefined;
    } catch (e) {
      console.error(`[asaas-adapter] findCustomerByCpf exception: ${e instanceof Error ? e.message : String(e)}`);
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
      const errorText = await res.text().catch(() => "");
      throw new Error(`asaas_tokenize_failed:${res.status}:${errorText}`);
    }

    const result = (await res.json()) as { creditCardToken?: string };
    if (!result.creditCardToken) {
      throw new Error("asaas_tokenize_missing_token");
    }

    return result.creditCardToken;
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
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
      const errorText = await res.text().catch(() => "");
      throw new Error(`asaas_payment_create_failed:${res.status}:${errorText}`);
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
      const err = await res.text().catch(() => "");
      throw new Error(`asaas_refund_failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { refundId: data.id ?? input.providerPaymentId, status: "succeeded" as const };
  }
}
