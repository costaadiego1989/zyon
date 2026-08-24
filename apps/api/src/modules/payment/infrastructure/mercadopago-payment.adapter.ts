import { Injectable } from "@nestjs/common";
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

  async fetchPaymentStatus(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput> {
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/v1/payments/${encodeURIComponent(input.providerPaymentId)}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        accept: "application/json"
      }
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
      body: JSON.stringify(body)
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
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`mercadopago_refund_failed: ${res.status} ${err}`);
    }
    const data = await res.json();
    return { refundId: data.id?.toString() ?? input.providerPaymentId, status: "succeeded" as const };
  }
}
