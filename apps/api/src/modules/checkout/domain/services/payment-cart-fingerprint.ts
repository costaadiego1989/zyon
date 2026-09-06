import { createHash } from "node:crypto";
import type { CheckoutSession } from "@zyon/shared-types";

/** Bind the payment to sale identities as well as money; presentation fields are excluded. */
export function paymentCartFingerprint(session: CheckoutSession): string {
  const items = session.cart.items.map(item => [item.sku, item.product_id ?? null, item.variant ?? null,
    Math.round(item.price * 100), item.quantity]);
  items.sort((a, b) => {
    const left = JSON.stringify(a), right = JSON.stringify(b);
    return left < right ? -1 : left > right ? 1 : 0;
  });
  const value = {
    version: 1, currency: session.cart.currency,
    commerceCartRef: session.cart.commerceCartRef ?? null, items,
    discountCents: Math.round((session.cart.currentDiscount ?? 0) * 100),
    shippingCents: Math.round((session.shipping?.customerPrice ?? 0) * 100),
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
