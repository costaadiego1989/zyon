import { createHash } from "node:crypto";
import type { CheckoutSession } from "@zyon/shared-types";
import { requiresPhysicalDelivery } from "./cart-fulfillment.js";

/** Bind the payment to sale identities as well as money; presentation fields are excluded. */
export function paymentCartFingerprint(session: CheckoutSession): string {
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
