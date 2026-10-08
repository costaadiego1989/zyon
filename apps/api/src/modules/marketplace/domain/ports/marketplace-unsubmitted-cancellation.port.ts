import { createHash } from "node:crypto";
import type { MarketplaceCancellationReason } from "./marketplace-cancellation-execution.port.js";

export const MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY = Symbol("MARKETPLACE_UNSUBMITTED_CANCELLATION_REPOSITORY");
export const MARKETPLACE_UNSUBMITTED_CANCELLATION_REASON = "marketplace_never_submitted_cancelled";
export const marketplaceUnsubmittedCancellationEventId = (id: string) =>
  `marketplace_local_cancel_${createHash("sha256").update(id).digest("hex")}`;

export interface MarketplaceUnsubmittedCancellationRepository {
  cancel(hostMerchantId: string, paymentIntentId: string, reason: MarketplaceCancellationReason): Promise<"released" | "not_applicable">;
  status(hostMerchantId: string, paymentIntentId: string): Promise<{ reason: MarketplaceCancellationReason } | null>;
}

export interface MarketplaceUnsubmittedCancellationProof {
  version: 1;
  kind: "never_submitted";
  hostMerchantId: string;
  paymentIntentId: string;
  checkoutSessionId: string;
  cartRef: string;
  instructionsHash: string;
  creationInputHash: string;
  reservationsHash: string;
  provider: string;
  environment: string;
  accountFingerprint: string;
  amountCents: number;
  currency: "BRL";
  paymentVersionBefore: number;
  reason: MarketplaceCancellationReason;
  cancelledAt: string;
}

/** A dashboard hint only: stock, allocation and the durable receipt still need
 * repository validation. No buyer data is needed by this projection. */
export function isNeverSubmittedMarketplacePayment(payment: {
  status: string; providerPaymentId?: string | null; creation: unknown;
  approvedAmountCents?: number | null; statusHistory: unknown;
}): boolean {
  const creation = payment.creation as Record<string, unknown> | null;
  const input = creation?.input as Record<string, unknown> | null;
  return payment.status === "pending" && payment.providerPaymentId == null && payment.approvedAmountCents == null &&
    !!creation && !Array.isArray(creation) && creation.state === "ready" && creation.firstAttemptAt === undefined &&
    creation.leaseToken === undefined && creation.leaseUntil === undefined && creation.reason === undefined &&
    !!input && typeof input === "object" && !Array.isArray(input) &&
    !!input.marketplaceFunding && typeof input.marketplaceFunding === "object" && !Array.isArray(input.marketplaceFunding) &&
    Array.isArray(payment.statusHistory) && payment.statusHistory.length > 0 &&
    payment.statusHistory.every(row => !!row && typeof row === "object" && row.status === "pending" &&
      typeof row.occurredAt === "string" && Number.isFinite(Date.parse(row.occurredAt)));
}
