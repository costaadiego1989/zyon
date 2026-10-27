export const ORDER_QUOTA_GRACE_MS = 72 * 60 * 60 * 1_000;

export type OrderQuotaState = "active" | "warning" | "grace" | "suspended";

export function orderQuotaPeriod(now: Date) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export function orderQuotaState(input: {
  used: number;
  limit: number | null;
  graceExpiresAt?: Date | null;
  now: Date;
}): OrderQuotaState {
  if (input.limit === null) return "active";
  if (input.used < input.limit) {
    return input.used >= Math.ceil(input.limit * 0.8) ? "warning" : "active";
  }
  // A suspension is valid only after the merchant has a persisted grace deadline.
  return input.graceExpiresAt && input.now >= input.graceExpiresAt ? "suspended" : "grace";
}
