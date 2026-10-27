import type { MarketplaceCaptureEvidence } from "./marketplace-capture-provider.port.js";
import type { MarketplaceRefundContributionCertificate } from "./marketplace-refund-contribution.port.js";
import type { AsaasMarketplaceWalletReturnProof, AsaasMarketplaceWalletReturnRequest } from "./asaas-marketplace-transfer-recovery.port.js";

/** Immutable instruction persisted before any provider mutation. */
export interface MarketplaceRefundRequest {
  kind: "refund" | "transfer_reversal";
  provider: "stripe" | "asaas" | "mercadopago";
  environment: "test" | "live";
  accountFingerprint: string;
  providerPaymentId: string;
  /** Charge identifier from the verified original funding capture. */
  sourceId: string;
  paymentAmountCents: number;
  amountCents: number;
  currency: "BRL";
  reference: string;
  requestHash: string;
  /** Confirmed earlier refunds in this capture, frozen by the allocation ledger. */
  previousRefunds: Array<{ providerOperationId: string; amountCents: number }>;
  /** Original independently verified Asaas capture. Never recalculate its fees after a refund. */
  asaasCapture?: MarketplaceCaptureEvidence;
  /** Separate seller-funded fees; original purchase allocation is never rewritten. */
  fundingContributions?: {
    planHash: string;
    contributedNetCents: number;
    certificates: MarketplaceRefundContributionCertificate[];
  };
  /** Frozen replay of each certified Stripe V4 source and its own transfers.
   * Buyer refunds still target the original charge; reversal liquidity does
   * not create another capture or a new seller contribution authorization. */
  stripeSourceFunding?: import("./marketplace-stripe-source-refund.port.js").StripeMarketplaceSourceRefundFunding;
  /** Certified whole original wallet returns. Later refunds reuse the same held
   * principal under cumulative beneficiary debits; no additional wallet POST. */
  asaasWalletReturns?: Array<{ id: string; payoutId: string; certificateHash: string;
    request: AsaasMarketplaceWalletReturnRequest; proof: AsaasMarketplaceWalletReturnProof }>;
  /** One independently authorized return of a completed V5/V7 outbound.
   * The original payout return cannot provide the same liquidity again. */
  asaasResidualWalletReturns?: Array<{ id: string; residualPlanId: string; residualOperationId: string; certificateHash: string;
    request: AsaasMarketplaceWalletReturnRequest; proof: AsaasMarketplaceWalletReturnProof }>;
  transfer?: {
    /** Residual transfers carry a frozen provider request hash; legacy originals omit both fields. */
    kind?: "residual";
    requestHash?: string;
    providerTransferId: string;
    destination: string;
    amountCents: number;
    /** Original payout reference, not the refund operation reference. */
    reference: string;
    /** Confirmed earlier reversals of this exact transfer; absent in first-generation legacy requests. */
    previousReversals?: Array<{ providerOperationId: string; amountCents: number; reference: string; requestHash: string }>;
  };
}

export interface MarketplaceRefundObservation {
  state: "confirmed" | "pending" | "unknown" | "failed";
  /** Asaas uses asaas_refund_<sha256>: a local fingerprint of the GET receipt, not a native provider ID. */
  providerOperationId?: string;
  amountCents?: number;
  observedAt?: string;
  /** A native receipt remains valid even if a later financial movement requires
   * investigation. Recording it must preserve the order's financial hold. */
  reconciliationRequired?: boolean;
}

/** A failed receipt is terminal; only not_submitted proves no POST was attempted. */
export type MarketplaceRefundSubmission = MarketplaceRefundObservation | { state: "not_submitted" };

export interface MarketplaceRefundProvider {
  submit(input: MarketplaceRefundRequest): Promise<MarketplaceRefundSubmission>;
  /** GET only, including lost-response recovery. An empty search stays unknown. */
  reconcile(input: MarketplaceRefundRequest, providerOperationId?: string): Promise<MarketplaceRefundObservation>;
}
