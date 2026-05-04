export const PAYMENT_PROVIDER_PORT = Symbol("PAYMENT_PROVIDER_PORT");

export type CreateProviderPaymentInput = {
  merchantId: string;
  sessionId: string;
  intentId: string;
  /** Valor esperado já em centavos (alinhado ao checkout). */
  amountCents: number;
  currency: string;
  method: string;
  asaasCustomerId: string;
  description?: string;
};

export type CreateProviderPaymentOutput = {
  providerPaymentId: string;
  status: "pending" | "requires_action";
  buyerFacingPayload: { qrCodeCopyPaste?: string; invoiceUrl?: string; encodedQrImage?: string };
};

export interface PaymentProviderPort {
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput>;
}
