import type { MarketplaceCancellationEvidence, MarketplaceCancellationRequest } from "./marketplace-cancellation.port.js";

export type MarketplaceCancellationReason = "requested_by_customer" | "abandoned" | "duplicate" | "fraudulent";
interface MarketplaceCancellationExecutionIdentity extends MarketplaceCancellationRequest {
  checkoutSessionId: string;
  cancellationReason: MarketplaceCancellationReason;
  reference: string;
  requestHash: string;
}
export type MarketplaceCancellationExecutionRequest = MarketplaceCancellationExecutionIdentity & (
  { version: 1; provider: "stripe" | "mercadopago" } |
  { version: 2; provider: "asaas"; asaasCustomerId: string; asaasBillingType: "PIX" | "BOLETO" }
);
export interface MarketplaceCancellationOperation {
  operationId: string;
  hostMerchantId: string;
  paymentIntentId: string;
  state: "planned" | "unknown" | "confirmed" | "blocked";
  version: number;
  request: MarketplaceCancellationExecutionRequest;
}
/** A removed Asaas payment can be restored. This is operational evidence only:
 * it must never be accepted as terminal cancellation or stock-release evidence. */
export interface MarketplaceAsaasRemovalObservation {
  requestHash: string;
  providerPaymentId: string;
  customerId: string;
  billingType: "PIX" | "BOLETO";
  amountCents: number;
  status: "PENDING" | "OVERDUE";
  state: "removed_reversible" | "active_uncaptured";
  observedAt: string;
}
export type MarketplaceCancellationObservation = { state: "unknown"; asaas?: MarketplaceAsaasRemovalObservation } |
  { state: "confirmed"; evidence: MarketplaceCancellationEvidence } |
  { state: "blocked"; reason: "marketplace_cancellation_capture_observed";
    requestHash: string; providerPaymentId: string; amountReceivedCents: number; observedAt: string };

export interface MarketplaceCancellationExecutionProvider {
  /** At most one provider mutation. Its response is never release evidence. */
  submitCancellation(request: MarketplaceCancellationExecutionRequest): Promise<{ state: "unknown" }>;
  reconcileCancellation(request: MarketplaceCancellationExecutionRequest): Promise<MarketplaceCancellationObservation>;
}
export interface MarketplaceCancellationExecutionRepository {
  prepare(hostMerchantId: string, paymentIntentId: string, reason: MarketplaceCancellationReason): Promise<MarketplaceCancellationOperation>;
  claim(hostMerchantId: string, operationId: string, now: Date, options?: { reconcileOnly?: boolean }):
    Promise<{ operation: MarketplaceCancellationOperation; submit: boolean } | undefined>;
  record(operation: MarketplaceCancellationOperation, observation: MarketplaceCancellationObservation): Promise<boolean>;
  listUnresolved(limit: number): Promise<Array<{ hostMerchantId: string; operationId: string }>>;
}
