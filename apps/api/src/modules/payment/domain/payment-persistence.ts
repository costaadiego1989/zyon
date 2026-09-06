import type { PaymentIntentSnapshot } from "./payment-intent.entity.js";
import { isDeepStrictEqual } from "node:util";

// PostgreSQL JSONB reorders object keys and omits undefined properties.
function sameJson(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  return isDeepStrictEqual(normalize(left), normalize(right));
}

export class PaymentIntentConflictError extends Error {
  constructor() { super("payment_intent_concurrent_change"); }
}

export function assertSamePaymentIdentity(current: PaymentIntentSnapshot, next: PaymentIntentSnapshot): void {
  const fields = ["id", "merchantId", "sessionId", "idempotencyKey", "amountCents", "currency", "method", "acceptedOfferId", "commerceOrderId"] as const;
  if (fields.some(key => current[key] !== next[key]) ||
    !sameJson(current.amountBreakdown, next.amountBreakdown) ||
    (current.creation && !sameJson(current.creation.input, next.creation?.input)) ||
    (current.providerPaymentId && next.providerPaymentId !== current.providerPaymentId &&
      !(current.method === "crypto" && current.status === "requires_action" && next.status === "approved" && current.providerPaymentId.startsWith("crypto_")))) throw new Error("payment_intent_immutable_fields_changed");
}
