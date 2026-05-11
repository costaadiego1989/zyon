export const PAYMENT_PROVIDER_PORT = Symbol("PAYMENT_PROVIDER_PORT");

export type CreateProviderPaymentInput = {
  merchantId: string;
  sessionId: string;
  intentId: string;
  amountCents: number;
  currency: string;
  method: string;
  description?: string;
  // Asaas-only (pix / boleto / card via Asaas)
  asaasCustomerId?: string;
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    phone: string;
  };
  remoteIp?: string;
};

export type CreateProviderPaymentOutput = {
  providerPaymentId: string;
  status: "pending" | "requires_action";
  buyerFacingPayload: {
    qrCodeCopyPaste?: string;
    invoiceUrl?: string;
    encodedQrImage?: string;
    clientSecret?: string;
    stripePublishableKey?: string;
  };
};

export interface PaymentProviderPort {
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput>;
}
