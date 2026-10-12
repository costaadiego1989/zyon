import type { CreateProviderPaymentInput } from "./ports/payment-provider.port.js";

export type PendingPaymentCancellationInput = {
  /** Immutable input saved before creation, never browser-provided. */
  payment: CreateProviderPaymentInput;
  providerPaymentId: string;
  idempotencyKey: string;
};

export type PendingPaymentCancellationResult = {
  state: "pending" | "cancelled" | "paid" | "unavailable" | "unknown" | "unsupported";
};

export type PaymentCancellation = {
  operationId: string;
  buyerId: string;
  idempotencyKey: string;
  providerPaymentId: string;
  startedAt: string;
  state: "in_flight" | "uncertain" | "cancelled" | "blocked";
  leaseToken?: string;
  leaseUntil?: string;
  /** Persisted BEFORE remote mutation. All subsequent attempts are GET-only. */
  mutationAttemptedAt?: string;
  reason?: string;
};

export function assertStandardCancellationInput(input: PendingPaymentCancellationInput, provider: string, fingerprint: string): void {
  const p = input.payment;
  const scope = p as { marketplaceFunding?: unknown; marketplacePublicAdmission?: unknown };
  if (!p || p.provider !== provider || !fingerprint || p.providerAccountFingerprint !== fingerprint ||
      scope.marketplaceFunding !== undefined || scope.marketplacePublicAdmission !== undefined ||
      !p.merchantId?.trim() || !p.sessionId?.trim() || !p.intentId?.trim() ||
      !input.providerPaymentId?.trim() || !input.idempotencyKey?.trim() ||
      !Number.isSafeInteger(p.amountCents) || p.amountCents <= 0 || p.currency !== "BRL" ||
      !["pix", "card"].includes(p.method)) throw new Error("payment_cancellation_identity_invalid");
}

export function exactCancellationAmount(value: unknown, expectedCents: number): boolean {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value * 100 - expectedCents) < 0.000001;
}
