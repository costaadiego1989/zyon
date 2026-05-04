import { Injectable } from "@nestjs/common";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";

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

/** Documentação oficial: header HTTP `access_token` com valor da API key (schema OpenAPI v3 da Asaas). */
@Injectable()
export class AsaasPaymentAdapter implements PaymentProviderPort {
  constructor(
    private readonly apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch
  ) {}

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    const base = this.apiBaseUrl.replace(/\/+$/, "");
    const billingType = billingFromMethod(input.method);
    const body: Record<string, unknown> = {
      customer: input.asaasCustomerId,
      billingType,
      value: majorUnitsFromCents(input.amountCents),
      dueDate: defaultDueDate(),
      description: input.description ?? `Checkout ${input.sessionId}`,
      externalReference: input.intentId
    };

    const res = await this.fetchImpl(`${base}/v3/payments`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        access_token: this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`asaas_payment_create_failed:${res.status}`);
    }

    const created = (await res.json()) as { id?: string; invoiceUrl?: string };
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
        }
      });
      if (qr.ok) {
        const pj = (await qr.json()) as { payload?: string; encodedImage?: string };
        if (typeof pj.payload === "string") buyerFacingPayload.qrCodeCopyPaste = pj.payload;
        if (typeof pj.encodedImage === "string") buyerFacingPayload.encodedQrImage = pj.encodedImage;
      }
    }

    return {
      providerPaymentId,
      status: billingType === "PIX" ? "requires_action" : "pending",
      buyerFacingPayload
    };
  }
}
