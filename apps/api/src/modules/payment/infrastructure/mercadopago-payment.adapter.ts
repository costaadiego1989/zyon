import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PaymentCreationRejectedError } from "../domain/payment-creation-rejected.error.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

function mercadoPagoStateFromStatus(
  status: string | undefined,
  statusDetail: string | undefined,
): FetchPaymentStatusOutput["state"] {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
    case "cancelled":
    case "refunded":
      return "failed";
    case "pending":
    case "in_process":
    case "in_mediation":
      return "pending";
    case "charged_back":
      // Mercado Pago keeps the chargeback result in `status_detail`: the
      // amount is still being reviewed, was returned to the buyer, or was
      // reinstated to the seller.
      if (statusDetail === "settled") return "chargeback_lost";
      if (statusDetail === "reimbursed") return "chargeback_won";
      return "chargeback_pending";
    default:
      return "unknown";
  }
}

type MercadoPagoPaymentMethod = "pix" | "boleto" | "card";

type MercadoPagoPayment = {
  id?: number | string;
  status?: string;
  external_reference?: string;
  payment_method_id?: string;
  metadata?: { intent_id?: string; session_id?: string };
  transaction_amount?: number;
  currency_id?: string;
  date_of_expiration?: string;
  point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
  transaction_details?: { external_resource_url?: string };
};

function paymentMethodFromMethod(method: string): MercadoPagoPaymentMethod {
  switch (method.toLowerCase()) {
    case "pix":
      return "pix";
    case "boleto":
      return "boleto";
    case "card":
      return "card";
    default:
      throw new Error(`mercadopago_unsupported_method:${method}`);
  }
}

function majorUnitsFromCents(amountCents: number): number {
  return Number((amountCents / 100).toFixed(2));
}

function notificationUrlFor(input: CreateProviderPaymentInput): string | undefined {
  const base = process.env.API_PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base) return undefined;
  // Mercado Pago signs every delivery. The reference is only a lookup key after
  // that signature check and lets Checkout Pro map its later payment id back to
  // the intent created before the buyer reaches the hosted page.
  return `${base}/webhooks/mercadopago?intent_ref=${encodeURIComponent(input.intentId)}`;
}

function payerFor(input: CreateProviderPaymentInput): Record<string, unknown> {
  const [firstName, ...lastNames] = (input.payerName?.trim() ?? "").split(/\s+/);
  return {
    email: input.payerEmail,
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastNames.length ? { last_name: lastNames.join(" ") } : {}),
    ...(input.payerIdentification ? { identification: input.payerIdentification } : {}),
  };
}

@Injectable()
export class MercadoPagoPaymentAdapter implements PaymentProviderPort {
  private accountIdPromise?: Promise<string | undefined>;
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessToken: string,
    private readonly publicKey: string | undefined,
    private readonly fetchImpl: typeof fetch,
    private readonly marketplaceSeller = false,
    private readonly requirePlatformSplit = false,
    private readonly platformAccount?: MercadoPagoPaymentAdapter,
  ) {}

  validatePlatformFee(input: CreateProviderPaymentInput): void {
    if (this.requirePlatformSplit && !this.marketplaceSeller && (input.platformFeeCents ?? 0) > 0) {
      throw new PaymentCreationRejectedError("mercadopago_oauth_required_for_platform_fee");
    }
  }

  creationAccountFingerprint(): string { return createHash("sha256").update(`${this.apiBaseUrl}\0${this.accessToken}`).digest("hex"); }

  async preparePayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentInput> {
    this.validatePlatformFee(input);
    if (input.mercadoPagoFeeMode || !this.marketplaceSeller || (input.platformFeeCents ?? 0) <= 0) return input;
    // An OAuth token can belong to the integrator itself. A split to that same
    // account is rejected with 2059; all funds already reach the platform.
    // Never infer this from token syntax or merchant-supplied account IDs.
    const [sellerId, platformId] = this.platformAccount
      ? await Promise.all([this.authenticatedAccountId(), this.platformAccount.authenticatedAccountId()])
      : [];
    return { ...input, mercadoPagoFeeMode: sellerId && platformId && sellerId === platformId ? "same_account" : "split" };
  }

  private authenticatedAccountId(): Promise<string | undefined> {
    this.accountIdPromise ??= (async () => {
      try {
        const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/, "")}/users/me`, {
          headers: { Authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
          redirect: "error", signal: AbortSignal.timeout(5_000),
        });
        if (!response.ok) return undefined;
        const user = await response.json() as { id?: unknown };
        const id = String(user.id ?? "");
        return /^[1-9]\d*$/.test(id) ? id : undefined;
      } catch { return undefined; }
    })();
    return this.accountIdPromise.then(id => {
      if (!id) this.accountIdPromise = undefined;
      return id;
    });
  }

  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    if (paymentMethodFromMethod(input.method) === "card") {
      return this.recoverHostedCardPreference(input);
    }
    const query = new URLSearchParams({ external_reference: input.intentId, limit: "100", sort: "date_created", criteria: "desc" });
    const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/, "")}/v1/payments/search?${query}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("mercadopago_payment_recovery_failed");
    const body = await response.json() as { results?: MercadoPagoPayment[]; paging?: { total?: number } };
    if (!Array.isArray(body.results) || body.results.length > 1 || (body.paging?.total ?? 0) > 1) throw new Error("mercadopago_payment_recovery_ambiguous");
    const payment = body.results[0];
    if (!payment) return null;
    if (payment.external_reference !== input.intentId || payment.metadata?.intent_id !== input.intentId ||
      payment.metadata?.session_id !== input.sessionId || typeof payment.transaction_amount !== "number" || !Number.isFinite(payment.transaction_amount) ||
      Math.round(payment.transaction_amount * 100) !== input.amountCents || payment.currency_id !== input.currency) throw new Error("mercadopago_payment_recovery_mismatch");
    const id = String(payment.id ?? "");
    if (!id) throw new Error("mercadopago_payment_missing_id");
    return this.paymentOutput(input, payment);
  }

  private async paymentOutput(input: CreateProviderPaymentInput, payment: MercadoPagoPayment): Promise<CreateProviderPaymentOutput> {
    const id = String(payment.id ?? "").trim();
    if (!id) throw new Error("mercadopago_payment_missing_id");
    // Search/creation can return a partial payment. Hydrate the same payment,
    // never POST another charge just to obtain its Pix presentation data.
    if (input.method === "pix" && (!payment.point_of_interaction?.transaction_data?.qr_code?.trim() ||
      !payment.point_of_interaction?.transaction_data?.qr_code_base64?.trim())) {
      const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/, "")}/v1/payments/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
        redirect: "error", signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`mercadopago_payment_details_failed:${response.status}`);
      const details = await response.json() as MercadoPagoPayment;
      if (String(details.id ?? "") !== id || details.external_reference !== input.intentId ||
        details.payment_method_id !== "pix" || typeof details.transaction_amount !== "number" ||
        Math.round(details.transaction_amount * 100) !== input.amountCents || details.currency_id !== input.currency) {
        throw new Error("mercadopago_payment_recovery_mismatch");
      }
      payment = details;
    }
    const qr = payment.point_of_interaction?.transaction_data;
    if (input.method === "pix" && !qr?.qr_code?.trim()) {
      throw new Error("mercadopago_pix_payload_unavailable");
    }
    return {
      providerPaymentId: id,
      status: "requires_action",
      buyerFacingPayload: {
        qrCodeCopyPaste: qr?.qr_code,
        encodedQrImage: qr?.qr_code_base64,
        invoiceUrl: qr?.ticket_url ?? payment.transaction_details?.external_resource_url,
        ...(payment.date_of_expiration ? { quoteExpiresAt: payment.date_of_expiration } : {}),
      },
    };
  }

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/v1/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        accept: "application/json"
      },
      signal: AbortSignal.timeout(15_000)
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`mercadopago_payment_fetch_failed:${res.status}:${errorText}`);
    }

    const payment = (await res.json()) as {
      status?: string;
      status_detail?: string;
      transaction_amount?: number;
      external_reference?: string;
    };
    const state = mercadoPagoStateFromStatus(
      typeof payment.status === "string" ? payment.status : undefined,
      typeof payment.status_detail === "string" ? payment.status_detail : undefined,
    );
    const approvedAmountCents =
      typeof payment.transaction_amount === "number" &&
      !Number.isNaN(payment.transaction_amount)
        ? Math.round(payment.transaction_amount * 100)
        : undefined;

    return {
      state,
      approvedAmountCents,
      externalReference: typeof payment.external_reference === "string" ? payment.external_reference : undefined,
    };
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    input = await this.preparePayment(input);
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const paymentMethod = paymentMethodFromMethod(input.method);
    if (paymentMethod === "card") {
      return this.createHostedCardCheckout(input, base);
    }

    const body: Record<string, unknown> = {
      external_reference: input.intentId,
      transaction_amount: majorUnitsFromCents(input.amountCents),
      description: input.description ?? `Checkout ${input.sessionId}`,
      payment_method_id: paymentMethod,
      payer: payerFor(input),
      ...(notificationUrlFor(input) ? { notification_url: notificationUrlFor(input) } : {}),
      ...(this.marketplaceSeller && input.mercadoPagoFeeMode !== "same_account" && (input.platformFeeCents ?? 0) > 0 ? { application_fee: majorUnitsFromCents(input.platformFeeCents!) } : {}),
      metadata: {
        intent_id: input.intentId,
        merchant_id: input.merchantId,
        session_id: input.sessionId
      }
    };

    let res: Response;
    try {
      res = await this.fetchImpl(`${base}/v1/payments`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "content-type": "application/json",
          "X-Idempotency-Key": input.providerIdempotencyKey ?? input.intentId,
          accept: "application/json"
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000)
      });
    } catch (error) {
      // A lost response may already have created the charge. Recover using GET
      // before making the buyer retry, preserving the original intent and key.
      const recovered = await this.recoverPayment(input).catch(() => null);
      if (recovered) return recovered;
      throw error;
    }

    if (!res.ok) {
      if (res.status >= 500 || res.status === 408 || res.status === 409) {
        const recovered = await this.recoverPayment(input).catch(() => null);
        if (recovered) return recovered;
      }
      const failure = await res.json().catch(() => null) as { cause?: Array<{ code?: unknown }> } | null;
      const codes = Array.isArray(failure?.cause)
        ? failure.cause.map(cause => String(cause?.code ?? "")).filter(code => /^[a-zA-Z0-9_-]{1,60}$/.test(code)).slice(0, 4)
        : [];
      if (res.status === 400 && codes.includes("2059")) {
        throw new PaymentCreationRejectedError("mercadopago_oauth_required_for_platform_fee", "2059");
      }
      if (res.status === 400 && input.method === "pix" && codes.includes("13253")) {
        throw new PaymentCreationRejectedError("mercadopago_pix_key_required", "13253");
      }
      throw new Error(`mercadopago_payment_create_failed:${res.status}${codes.length ? `:${codes.join(",")}` : ""}`);
    }

    return this.paymentOutput(input, await res.json() as MercadoPagoPayment);
  }

  /**
   * Card data is collected by Mercado Pago Checkout Pro. This deliberately
   * avoids a transparent-card fallback: neither PAN nor CVV reaches Zyon.
   */
  private async createHostedCardCheckout(
    input: CreateProviderPaymentInput,
    base: string,
  ): Promise<CreateProviderPaymentOutput> {
    const body: Record<string, unknown> = {
      external_reference: input.intentId,
      items: [{
        id: input.intentId,
        title: input.description ?? `Checkout ${input.sessionId}`,
        quantity: 1,
        currency_id: input.currency,
        unit_price: majorUnitsFromCents(input.amountCents),
      }],
      payer: input.payerEmail ? payerFor(input) : undefined,
      payment_methods: {
        // Keep the hosted experience on the card rail chosen in Zyon. Mercado
        // Pago account balance cannot be excluded by their platform, but Pix
        // and boleto are excluded from this card-specific preference.
        excluded_payment_types: [{ id: "ticket" }, { id: "bank_transfer" }],
      },
      ...(notificationUrlFor(input) ? { notification_url: notificationUrlFor(input) } : {}),
      ...(this.marketplaceSeller && input.mercadoPagoFeeMode !== "same_account" && (input.platformFeeCents ?? 0) > 0
        ? { marketplace_fee: majorUnitsFromCents(input.platformFeeCents!) }
        : {}),
      metadata: {
        intent_id: input.intentId,
        merchant_id: input.merchantId,
        session_id: input.sessionId,
      },
    };
    if (!body.payer) delete body.payer;

    const res = await this.fetchImpl(`${base}/checkout/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
        "X-Idempotency-Key": input.providerIdempotencyKey ?? input.intentId,
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`mercadopago_checkout_preference_create_failed:${res.status}`);
    const preference = await res.json() as { id?: string; init_point?: string; sandbox_init_point?: string };
    const providerPaymentId = typeof preference.id === "string" ? preference.id : "";
    const invoiceUrl = this.hostedCheckoutUrl(preference);
    if (!providerPaymentId || !invoiceUrl) throw new Error("mercadopago_checkout_preference_missing_redirect");
    return {
      providerPaymentId,
      status: "requires_action",
      buyerFacingPayload: { invoiceUrl },
    };
  }

  private async recoverHostedCardPreference(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    const query = new URLSearchParams({ external_reference: input.intentId, limit: "100" });
    const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/, "")}/checkout/preferences/search?${query}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("mercadopago_preference_recovery_failed");
    const result = await response.json() as {
      results?: Array<{
        id?: string;
        external_reference?: string;
        init_point?: string;
        sandbox_init_point?: string;
      }>;
      paging?: { total?: number };
    };
    if (!Array.isArray(result.results) || result.results.length > 1 || (result.paging?.total ?? 0) > 1) {
      throw new Error("mercadopago_preference_recovery_ambiguous");
    }
    const preference = result.results[0];
    if (!preference) return null;
    if (preference.external_reference !== input.intentId) {
      throw new Error("mercadopago_preference_recovery_mismatch");
    }
    const providerPaymentId = typeof preference.id === "string" ? preference.id : "";
    const invoiceUrl = this.hostedCheckoutUrl(preference);
    if (!providerPaymentId || !invoiceUrl) throw new Error("mercadopago_preference_recovery_mismatch");
    return { providerPaymentId, status: "requires_action", buyerFacingPayload: { invoiceUrl } };
  }

  private hostedCheckoutUrl(preference: { init_point?: string; sandbox_init_point?: string }): string {
    const usesTestCredential = /^TEST-/i.test(this.accessToken);
    const primary = usesTestCredential ? preference.sandbox_init_point : preference.init_point;
    const fallback = usesTestCredential ? preference.init_point : preference.sandbox_init_point;
    return typeof primary === "string"
      ? primary
      : typeof fallback === "string"
        ? fallback
        : "";
  }

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string; idempotencyKey?: string }) {
    const res = await this.fetchImpl(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
        ...(input.idempotencyKey ? { "X-Idempotency-Key": input.idempotencyKey } : {}),
      },
      body: JSON.stringify({ amount: input.amountCents / 100 }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`mercadopago_refund_failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { refundId: data.id?.toString() ?? input.providerPaymentId, status: "succeeded" as const };
  }
}
