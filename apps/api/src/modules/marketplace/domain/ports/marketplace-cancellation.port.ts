export interface MarketplaceCancellationRequest {
  hostMerchantId: string;
  paymentIntentId: string;
  /** Required for Mercado Pago's immutable provider metadata binding. */
  checkoutSessionId?: string;
  instructionsHash: string;
  provider: "stripe" | "asaas" | "mercadopago";
  environment: "test" | "live";
  accountFingerprint: string;
  providerPaymentId: string;
  amountCents: number;
  currency: "BRL";
}

/** Proof that this exact payment can never capture, not a local timeout/deletion. */
interface MarketplaceCancellationProof extends MarketplaceCancellationRequest {
  state: "terminal_uncaptured";
  amountReceivedCents: 0;
  amountCapturableCents: 0;
  cancelledAt: string;
  observedAt: string;
}

export type MarketplaceCancellationEvidence = MarketplaceCancellationProof & ({ provider: "stripe" } | {
  provider: "mercadopago";
  checkoutSessionId: string;
  mercadoPago: {
    paymentId: string;
    collectorId: string;
    status: "cancelled";
    statusDetail: "by_collector" | "by_payer" | "expired";
    captured: false;
    netReceivedAmountCents: 0;
    refundedAmountCents: 0;
    dateApproved: null;
  };
});

export interface MarketplaceCancellationProvider {
  readCancellation(input: MarketplaceCancellationRequest): Promise<MarketplaceCancellationEvidence | null>;
}

export interface MarketplaceCancellationRepository {
  request(hostMerchantId: string, paymentIntentId: string): Promise<MarketplaceCancellationRequest | null>;
  release(evidence: MarketplaceCancellationEvidence): Promise<"released">;
}

export const MARKETPLACE_TERMINAL_CANCELLATION_REASON = "marketplace_provider_terminal_uncaptured";
