import type { Cart } from "@zyon/shared-types";

/** Unknown provider types retain physical delivery until explicitly classified. */
export function physicalDeliveryItems(cart: Pick<Cart, "items">): Cart["items"] {
  return cart.items.filter(item => item.productType !== "digital" && item.productType !== "service");
}

export function requiresPhysicalDelivery(cart: Pick<Cart, "items">): boolean {
  return !cart.items.length || physicalDeliveryItems(cart).length > 0;
}
