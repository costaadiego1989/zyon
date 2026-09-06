export const PAYMENT_PROVIDER_PORT = Symbol("PAYMENT_PROVIDER_PORT");

export type CreateProviderPaymentInput = {
  provider?: "asaas" | "stripe" | "mercadopago" | "crypto";
  providerAccountFingerprint?: string;
  merchantId: string;
  sessionId: string;
  intentId: string;
  /**
   * Stable idempotency key derived from `(merchantId, sessionId, idempotencyKey)`.
   * Unlike `intentId` (random per attempt), this aligns the provider's own
   * dedupe with the local idempotency tuple so a client retry after a partial
   * failure reuses the same provider charge instead of creating a second
   * (ADR 0001 #6).
   */
  providerIdempotencyKey?: string;
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
  stripeConnectAccountId?: string;
  platformFeeCents?: number;
};

export type CryptoTransferQuotePayload = {
  kind: "merchant" | "platform_fee";
  destinationAddress: string;
  amountAtomic: string;
  amountDisplay: string;
};

export type CryptoBuyerFacingPayload = {
  chainId: number;
  chain: "polygon" | "base";
  evmNetwork: "mainnet" | "testnet";
  chainLabel: string;
  tokenAddress: string;
  tokenSymbol: "USDC";
  amountAtomic: string;
  amountDisplay: string;
  destinationAddress: string;
  transfers?: CryptoTransferQuotePayload[];
  quoteExpiresAt: string;
  walletConnectProjectId?: string;
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
  } & Partial<CryptoBuyerFacingPayload>;
};

export type AuthoritativePaymentState = "approved" | "failed" | "pending" | "unknown";

export type FetchPaymentStatusInput = {
  provider?: CreateProviderPaymentInput["provider"];
  providerAccountFingerprint?: string;
  merchantId: string;
  providerPaymentId: string;
};

export type FetchPaymentStatusOutput = {
  state: AuthoritativePaymentState;
  approvedAmountCents?: number;
};

export type RefundPaymentInput = {
  merchantId: string;
  providerPaymentId: string;
  amountCents: number;
  reason?: string;
};

export type RefundPaymentOutput = {
  refundId: string;
  status: "succeeded" | "pending" | "failed" | "manual_required";
};

export interface PaymentProviderPort {
  creationAccountFingerprint?(): string;
  /** Freeze the route/account before reserving a new financial operation. */
  preparePayment?(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentInput>;
  /** Empty search results never prove that a timed-out POST had no effect. */
  recoverPayment?(input: CreateProviderPaymentInput, firstAttemptAt: string): Promise<CreateProviderPaymentOutput | null>;
  createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput>;
  createCustomer?(input: {
    merchantId: string;
    name: string;
    email: string;
    cpfCnpj: string;
    phone?: string;
  }): Promise<string>;
  /**
   * Authoritative provider state for reconciliation of stale intents. Never used
   * for optimistic confirmation — only to drive the same transitions a webhook would.
   */
  fetchPaymentStatus?(input: FetchPaymentStatusInput): Promise<FetchPaymentStatusOutput>;
  /**
   * Refund a previously approved payment. Returns refund ID and status.
   * Crypto payments return status: "manual_required" (no automated refund).
   */
  refundPayment?(input: RefundPaymentInput): Promise<RefundPaymentOutput>;
}
