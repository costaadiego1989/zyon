export type MarketplacePayoutProviderName = "stripe" | "asaas" | "mercadopago";
export interface MarketplacePayoutRequest {
  provider: MarketplacePayoutProviderName;
  accountFingerprint: string;
  providerPaymentId: string;
  destination: string;
  amountCents: number;
  currency: "BRL";
  reference: string;
  /** Immutable funding evidence; a later fee/source change requires reconciliation. */
  capture?: import("./marketplace-capture-provider.port.js").MarketplaceCaptureEvidence;
}
export interface MarketplacePayoutObservation {
  state: "confirmed" | "pending" | "failed" | "unknown";
  providerTransferId?: string;
}
/** Only submit can prove that it never attempted a financial POST. */
export type MarketplacePayoutSubmission = MarketplacePayoutObservation | { state: "not_submitted" };
export interface MarketplacePayoutProvider {
  submit(input: MarketplacePayoutRequest): Promise<MarketplacePayoutSubmission>;
  reconcile(input: MarketplacePayoutRequest, providerTransferId?: string): Promise<MarketplacePayoutObservation>;
}
