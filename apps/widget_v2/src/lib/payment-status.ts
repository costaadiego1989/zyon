export type PaymentPollingOutcome = "pending" | "completed" | "failed";

const COMPLETED_STATUSES = new Set(["approved", "paid", "confirmed"]);
const FAILED_STATUSES = new Set([
  "failed",
  "cancelled",
  "refunded",
  "chargeback_lost",
]);

/**
 * Reduces the persisted payment status to the only states the checkout poller
 * needs. Unknown and intermediate provider statuses remain pollable.
 */
export function paymentPollingOutcome(status: string | undefined): PaymentPollingOutcome {
  const normalized = status?.trim().toLowerCase();
  if (normalized && COMPLETED_STATUSES.has(normalized)) return "completed";
  if (normalized && FAILED_STATUSES.has(normalized)) return "failed";
  return "pending";
}
