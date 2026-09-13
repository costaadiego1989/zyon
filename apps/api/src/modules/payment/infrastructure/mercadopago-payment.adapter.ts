import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  FetchPaymentStatusInput,
  FetchPaymentStatusOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

function mercadoPagoStateFromStatus(status: string | undefined): FetchPaymentStatusOutput["state"] {
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
    default:
      return "unknown";
  }
}

type MercadoPagoPaymentMethod = "pix" | "boleto" | "card";

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

@Injectable()
export class MercadoPagoPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessToken: string,
    private readonly publicKey: string | undefined,
    private readonly fetchImpl: typeof fetch,
    private readonly marketplaceSeller = false,
    private readonly requirePlatformSplit = false,
  ) {}

  validatePlatformFee(input: CreateProviderPaymentInput): void {
    if (this.requirePlatformSplit && !this.marketplaceSeller && (input.platformFeeCents ?? 0) > 0) {
      throw new Error("mercadopago_oauth_required_for_platform_fee");
    }
  }

  creationAccountFingerprint(): string { return createHash("sha256").update(`${this.apiBaseUrl}\0${this.accessToken}`).digest("hex"); }

  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
    if (paymentMethodFromMethod(input.method) === "card") {
      return this.recoverHostedCardPreference(input);
    }
    const query = new URLSearchParams({ external_reference: input.intentId, limit: "100", sort: "date_created", criteria: "desc" });
    const response = await this.fetchImpl(`${this.apiBaseUrl.replace(/\/+$/, "")}/v1/payments/search?${query}`, {
      headers: { Authorization: `Bearer ${this.accessToken}`, accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("mercadopago_payment_recovery_failed");
    const body = await response.json() as { results?: any[]; paging?: { total?: number } };
    if (!Array.isArray(body.results) || body.results.length > 1 || (body.paging?.total ?? 0) > 1) throw new Error("mercadopago_payment_recovery_ambiguous");
    const payment = body.results[0];
    if (!payment) return null;
    if (payment.external_reference !== input.intentId || payment.metadata?.intent_id !== input.intentId ||
      payment.metadata?.session_id !== input.sessionId || !Number.isFinite(payment.transaction_amount) ||
      Math.round(payment.transaction_amount * 100) !== input.amountCents || payment.currency_id !== input.currency) throw new Error("mercadopago_payment_recovery_mismatch");
    const id = String(payment.id ?? "");
    if (!id) throw new Error("mercadopago_payment_missing_id");
    return { providerPaymentId: id, status: "requires_action", buyerFacingPayload: {
      qrCodeCopyPaste: payment.point_of_interaction?.transaction_data?.qr_code,
      encodedQrImage: payment.point_of_interaction?.transaction_data?.qr_code_base64,
      invoiceUrl: payment.transaction_details?.external_resource_url,
    } };
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

    const payment = (await res.json()) as { status?: string; transaction_amount?: number; external_reference?: string };
    const state = mercadoPagoStateFromStatus(
      typeof payment.status === "string" ? payment.status : undefined
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
    this.validatePlatformFee(input);
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
      payer: {
        email: input.payerEmail
      },
      ...(notificationUrlFor(input) ? { notification_url: notificationUrlFor(input) } : {}),
      ...(this.marketplaceSeller && (input.platformFeeCents ?? 0) > 0 ? { application_fee: majorUnitsFromCents(input.platformFeeCents!) } : {}),
      metadata: {
        intent_id: input.intentId,
        merchant_id: input.merchantId,
        session_id: input.sessionId
      }
    };

    const res = await this.fetchImpl(`${base}/v1/payments`, {
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

    if (!res.ok) {
      const errorText = await res.text().catch(() => "");
      throw new Error(`mercadopago_payment_create_failed:${res.status}:${errorText}`);
    }

    const created = (await res.json()) as {
      id?: number;
      status?: string;
      point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string } };
    };

    const providerPaymentId = typeof created?.id === "number" ? String(created.id) : "";
    if (!providerPaymentId) throw new Error("mercadopago_payment_missing_id");

    const buyerFacingPayload: CreateProviderPaymentOutput["buyerFacingPayload"] = {};

    if (paymentMethod === "pix" || paymentMethod === "boleto") {
      const qrData = created.point_of_interaction?.transaction_data;
      if (qrData?.qr_code) {
        buyerFacingPayload.qrCodeCopyPaste = qrData.qr_code;
      }
      if (qrData?.qr_code_base64) {
        buyerFacingPayload.encodedQrImage = qrData.qr_code_base64;
      }
      // PIX expires in 30 minutes by default (MercadoPago standard)
      buyerFacingPayload.quoteExpiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    }

    return {
      providerPaymentId,
      status: "requires_action",
      buyerFacingPayload
    };
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
      payer: input.payerEmail ? { email: input.payerEmail } : undefined,
      payment_methods: {
        // Keep the hosted experience on the card rail chosen in Zyon. Mercado
        // Pago account balance cannot be excluded by their platform, but Pix
        // and boleto are excluded from this card-specific preference.
        excluded_payment_types: [{ id: "ticket" }, { id: "bank_transfer" }],
      },
      ...(notificationUrlFor(input) ? { notification_url: notificationUrlFor(input) } : {}),
      ...(this.marketplaceSeller && (input.platformFeeCents ?? 0) > 0
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
