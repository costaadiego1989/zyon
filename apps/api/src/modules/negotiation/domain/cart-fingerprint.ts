import type { Cart } from "@aacp/shared-types";
import type { NegotiationCart } from "@aacp/negotiation-engine";

/** SKU/qty/price/total only so checkout-session cart matches negotiated cart fingerprints. */
export function negotiationCartFingerprint(cart: NegotiationCart): string {
  const items = [...cart.items]
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      price: item.price
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

  return JSON.stringify({ total: cart.total, items });
}

export function checkoutCartFingerprint(cart: Cart): string {
  const items = [...cart.items]
    .map((item) => ({
      sku: item.sku,
      quantity: item.quantity,
      price: item.price
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku));

  return JSON.stringify({ total: cart.total, items });
}
