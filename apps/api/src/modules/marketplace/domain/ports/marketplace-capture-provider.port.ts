export interface MarketplaceCaptureRequest {
  provider: "stripe" | "asaas";
  environment: "test" | "live";
  accountFingerprint: string;
  providerPaymentId: string;
  amountCents: number;
  currency: "BRL";
}

/** Verified read from the original capture account, never a fee estimate. */
export interface MarketplaceCaptureEvidence extends MarketplaceCaptureRequest {
  sourceId: string;
  balanceTransactionId?: string;
  providerFeeCents: number;
  netAmountCents: number;
}

export interface MarketplaceCaptureProvider {
  readCapture(input: MarketplaceCaptureRequest): Promise<MarketplaceCaptureEvidence>;
}
