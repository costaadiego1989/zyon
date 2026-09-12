export const PAYMENT_PROVIDER_PORT = Symbol("PAYMENT_PROVIDER_PORT");

/** How the merchant share is settled for this immutable payment intent. */
export type MerchantSettlementMode = "immediate_split" | "delayed_merchant_payout";

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
  /** Provider-validated contact for PIX or boleto notifications. */
  payerEmail?: string;
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
  /**
   * `delayed_merchant_payout` is opt-in. Its charge must be created on the
   * platform account, and a merchant destination is snapshotted for the
   * provider-transfer worker after the buyer return window closes.
   */
  settlementMode?: MerchantSettlementMode;
  merchantPayoutDestination?: string;
  merchantPayoutHoldDays?: number;
  /**
   * Crypto-only: buyer-selected chain override. When set (and valid for the
   * merchant's crypto config), the crypto quote is built on this chain instead
   * of the merchant's configured default chain.
   */
  preferredChain?: "polygon" | "base";
  /**
   * Crypto-only: live BRL/USDC rate to use when computing the USDC amount,
   * overriding the merchant's configured brlPerUsdc. Falls back to the merchant
   * value when absent.
   */
  brlPerUsdcOverride?: number;
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
  /**
   * Frozen routing identity from the payment creation. A refund is a financial
   * mutation and must use the account that captured the original charge.
   */
  provider?: CreateProviderPaymentInput["provider"];
  providerAccountFingerprint?: string;
  settlementMode?: MerchantSettlementMode;
  merchantId: string;
  providerPaymentId: string;
  amountCents: number;
  reason?: string;
  /** Stable key for retrying the same return without issuing it twice. */
  idempotencyKey?: string;
};

export type RefundPaymentOutput = {
  refundId: string;
  status: "succeeded" | "pending" | "failed" | "manual_required";
};

/** Authoritative state of an already-created provider refund. */
export type RefundProviderState = "succeeded" | "pending" | "failed" | "unknown";

export type FetchRefundStatusInput = {
  provider?: CreateProviderPaymentInput["provider"];
  providerAccountFingerprint?: string;
  merchantId: string;
  providerPaymentId: string;
  providerRefundId: string;
  /**
   * Stable merchant reference for providers whose refund list lacks a
   * provider-generated refund id. It is never used to issue a new refund.
   */
  refundReference?: string;
};

export type FetchRefundStatusOutput = {
  state: RefundProviderState;
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
    settlementMode?: MerchantSettlementMode;
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
  /**
   * Reads an already-created refund without issuing another financial POST.
   * Unavailable or inconclusive adapters return `unknown` so callers retain
   * their durable PENDING marker for manual reconciliation.
   */
  fetchRefundStatus?(input: FetchRefundStatusInput): Promise<FetchRefundStatusOutput>;
}
