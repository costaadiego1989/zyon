import { createHash } from "node:crypto";
import type { CheckoutSession } from "@zyon/shared-types";
import { requiresPhysicalDelivery } from "./cart-fulfillment.js";

/** Bind the payment to sale identities as well as money; presentation fields are excluded. */
export function paymentCartFingerprint(session: Pick<CheckoutSession, "cart" | "shipping">): string {
  const items = session.cart.items.map(item => [item.sku, item.product_id ?? null, item.variant ?? null,
    Math.round(item.price * 100), item.quantity,
    ...(item.fulfillmentStrategy === "scheduled_service" ? [["scheduled_service", item.variantId ?? null,
      item.fulfillmentSchedule?.slotId ?? null, item.fulfillmentSchedule?.startsAt ?? null,
      item.fulfillmentSchedule?.endsAt ?? null, item.fulfillmentSchedule?.timeZone ?? null,
      item.fulfillmentSchedule?.durationMinutes ?? null]] : [])]);
  items.sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const value = {
    version: 1, currency: session.cart.currency,
    commerceCartRef: session.cart.commerceCartRef ?? null, items,
    discountCents: Math.round((session.cart.currentDiscount ?? 0) * 100),
    shippingCents: requiresPhysicalDelivery(session.cart) ? Math.round((session.shipping?.customerPrice ?? 0) * 100) : 0,
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function marketplacePaymentCartFingerprint(session: Pick<CheckoutSession, "cart" | "shipping"> & Partial<Pick<CheckoutSession, "customer">>): string {
  const identities = session.cart.items.map(item => JSON.stringify([item.sku, item.quantity, Math.round(item.price * 100), item.variantId ?? null,
    item.marketplace?.lineItemId ?? null, item.marketplace?.sourceMerchantId ?? null,
    item.marketplace?.stockReservationId ?? null, item.marketplace?.commissionCents ?? null])).sort();
  const shipping = session.shipping as (CheckoutSession["shipping"] & { marketplace?: unknown }) | undefined;
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)])) : value;
  return createHash("sha256").update(JSON.stringify({ payment: paymentCartFingerprint(session), identities,
    cartRef: (session.cart as { cart_ref?: string }).cart_ref ?? null,
    // Preserve old identities exactly when no multi-origin quote was admitted.
    ...(shipping?.marketplace !== undefined ? { marketplaceShipping: canonical(shipping.marketplace),
      destination: canonical(session.customer?.address ?? null) } : {}) })).digest("hex");
}
