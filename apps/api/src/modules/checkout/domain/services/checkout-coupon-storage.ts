import { isDeepStrictEqual } from "node:util";
import type { Cart } from "@zyon/shared-types";
import { parseCheckoutCouponBinding, type CheckoutCouponBinding } from "./checkout-coupon-binding.js";

const bindingKey = "_storefrontCouponBinding";
type Scope = { merchantId: string; sessionId: string; buyerId: string };

function conflict(): never { throw new Error("checkout_coupon_binding_conflict"); }
function snapshot<T>(work: () => T): T {
  try { return work(); } catch { return conflict(); }
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Presence, not validity. Malformed/undefined private values must not be ignored. */
export function hasStoredCheckoutCouponBinding(cart: unknown): boolean {
  return snapshot(() => record(cart) && bindingKey in cart);
}

/** For public/generic writes only. Issuance needs a separate fenced command. */
export function assertNoCheckoutCouponBindingInput(cart: unknown): void {
  if (hasStoredCheckoutCouponBinding(cart)) return conflict();
}

/** Storage JSON is already the existing Cart boundary. Do not widen that public
 * contract; remove the reserved field even when its private payload is corrupt.
 * Full commercial validation still belongs to the authority adapters. */
export function stripStoredCheckoutCouponBinding(cart: unknown): Cart {
  return snapshot(() => {
    const cloned = structuredClone(cart);
    if (record(cloned)) delete cloned[bindingKey];
    return cloned as Cart;
  });
}

export function readStoredCheckoutCouponBinding(cart: unknown): CheckoutCouponBinding | undefined {
  return snapshot(() => {
    if (!hasStoredCheckoutCouponBinding(cart)) return undefined;
    if (!record(cart)) return conflict();
    return parseCheckoutCouponBinding(cart[bindingKey]);
  });
}

/** Preserve only canonical storage metadata, never caller-provided metadata.
 * Conservative until lifecycle commands exist: the entire public cart is fixed.
 * This does not issue, release, redeem or claim ownership of a reservation. */
export function preserveStoredCheckoutCouponBinding(storedCart: unknown, nextPublicCart: Cart, scope: Scope): Cart {
  return snapshot(() => {
    assertNoCheckoutCouponBindingInput(nextPublicCart);
    const binding = readStoredCheckoutCouponBinding(storedCart);
    const next = stripStoredCheckoutCouponBinding(nextPublicCart);
    if (!binding) return next;
    const current = stripStoredCheckoutCouponBinding(storedCart);
    if (binding.merchantId !== scope.merchantId || binding.checkoutSessionId !== scope.sessionId
      || binding.buyerId !== scope.buyerId || current.cart_ref !== binding.cartId
      || !isDeepStrictEqual(current, next)) return conflict();
    const discount = current.currentDiscount;
    if (binding.state !== "released" && (typeof discount !== "number" || !Number.isFinite(discount)
      || discount !== Math.round(discount * 100) / 100 || Math.round(discount * 100) !== binding.discountCents)) return conflict();
    const stored = { ...next, [bindingKey]: binding };
    return stored;
  });
}
