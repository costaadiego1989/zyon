import type { PaymentConnectionSnapshot } from "./payment-platform.types.js";

/** Older snapshots can say pending/restricted only because payouts were pending. */
export function stripeConnectionAllowsCharges(connection?: PaymentConnectionSnapshot): connection is PaymentConnectionSnapshot {
  return Boolean(connection && connection.status !== "degraded" && connection.chargesEnabled);
}
