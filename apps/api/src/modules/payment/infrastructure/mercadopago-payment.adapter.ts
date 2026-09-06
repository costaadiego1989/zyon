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

@Injectable()
export class MercadoPagoPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly accessToken: string,
    private readonly publicKey: string | undefined,
    private readonly fetchImpl: typeof fetch
  ) {}

  creationAccountFingerprint(): string { return createHash("sha256").update(`${this.apiBaseUrl}\0${this.accessToken}`).digest("hex"); }

  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput | null> {
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

    const payment = (await res.json()) as { status?: string; transaction_amount?: number };
    const state = mercadoPagoStateFromStatus(
      typeof payment.status === "string" ? payment.status : undefined
    );
    const approvedAmountCents =
      typeof payment.transaction_amount === "number" &&
      !Number.isNaN(payment.transaction_amount)
        ? Math.round(payment.transaction_amount * 100)
        : undefined;

    return { state, approvedAmountCents };
  }

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const paymentMethod = paymentMethodFromMethod(input.method);

    const body: Record<string, unknown> = {
      external_reference: input.intentId,
      transaction_amount: majorUnitsFromCents(input.amountCents),
      description: input.description ?? `Checkout ${input.sessionId}`,
      payment_method_id: paymentMethod,
      payer: {
        email: input.creditCardHolderInfo?.email ?? "buyer@example.com"
      },
      notification_url: `${input.remoteIp || ""}`,
      metadata: {
        intent_id: input.intentId,
        session_id: input.sessionId
      }
    };

    // PIX-specific: no additional fields required on creation
    // Boleto: same as PIX at creation time
    // Card: tokenization would happen client-side in real implementation
    if (paymentMethod === "card" && input.creditCard) {
      // In production, MP requires client-side tokenization for PCI compliance.
      // For now, we throw to enforce this constraint.
      throw new Error("mercadopago_card_requires_client_tokenization");
    }

    const res = await this.fetchImpl(`${base}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
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

    const status: CreateProviderPaymentOutput["status"] =
      paymentMethod === "card" ? "pending" : "requires_action";

    return {
      providerPaymentId,
      status,
      buyerFacingPayload
    };
  }

  async refundPayment(input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string }) {
    const res = await this.fetchImpl(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refunds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.accessToken}` },
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
