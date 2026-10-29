import { isDeepStrictEqual } from "node:util";
import { parseCheckoutCouponPaymentAuthority, type CheckoutCouponPaymentAuthority } from "../../checkout/domain/services/checkout-coupon-binding.js";
import type { PaymentIntentSnapshot } from "./payment-intent.entity.js";

type JournalScope = Pick<PaymentIntentSnapshot, "id" | "merchantId" | "sessionId" | "amountCents" | "currency" | "method"> & { creation?: unknown };
const privateInputKeys = ["couponAuthority", "_storefrontCouponBinding", "coupon_authority", "storefrontCouponScope"] as const;

function conflict(): never { throw new Error("payment_coupon_authority_conflict"); }

/** Never sanitize a private field into a provider payload. Refuse it, including
 * undefined/null presence, before cloning/persistence or provider dispatch. */
export function assertNoPaymentCouponAuthorityInProviderInput(input: unknown): void {
  try {
    if (input && typeof input === "object" && privateInputKeys.some(key => key in input)) return conflict();
  } catch { return conflict(); }
}

/** Reads only the stored sibling, never a live cart or provider metadata. Parsing
 * authenticates nothing: a future issuer must capture it under canonical fences. */
export function readPaymentCouponAuthority(scope: JournalScope): CheckoutCouponPaymentAuthority | undefined {
  try {
    const creation = scope.creation;
    if (!creation || typeof creation !== "object") return undefined;
    const present = "couponAuthority" in creation;
    const authorityDescriptor = Object.getOwnPropertyDescriptor(creation, "couponAuthority");
    const inputDescriptor = Object.getOwnPropertyDescriptor(creation, "input");
    // JSONB has own enumerable data properties. Do not let a later clone erase
    // inherited/non-enumerable presence or reread a mutable private accessor.
    if (present && (!authorityDescriptor?.enumerable || !("value" in authorityDescriptor)
      || !inputDescriptor?.enumerable || !("value" in inputDescriptor))) return conflict();
    const input: unknown = present ? inputDescriptor!.value : "input" in creation ? creation.input : undefined;
    assertNoPaymentCouponAuthorityInProviderInput(input);
    if (!present) return undefined;
    const value = parseCheckoutCouponPaymentAuthority(authorityDescriptor!.value);
    if (value.merchantId !== scope.merchantId || value.checkoutSessionId !== scope.sessionId) return conflict();
    if (!input || typeof input !== "object") return conflict();
    const fields = ["merchantId", "sessionId", "amountCents", "currency", "method"] as const;
    if (fields.some(key => !(key in input) || Reflect.get(input, key) !== scope[key])
      || !("intentId" in input) || input.intentId !== scope.id) return conflict();
    return value;
  } catch { return conflict(); }
}

/** Symmetric: a legacy journal cannot acquire authority on recovery, and a
 * bound journal cannot drop/substitute it even if every monetary field agrees. */
export function assertSamePaymentCouponAuthority(current: JournalScope, next: JournalScope): void {
  const before = readPaymentCouponAuthority(current), after = readPaymentCouponAuthority(next);
  if (!isDeepStrictEqual(before, after)) return conflict();
}
