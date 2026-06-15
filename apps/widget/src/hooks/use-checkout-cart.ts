import { useEffect, useState } from "react";
import type { CheckoutExperienceSnapshot, UpdateCartItemInput } from "@aacp/shared-types";
import { buildVisibleCart, countVisibleItems, removeVisibleCartItem, incrementVisibleCartItem, decrementVisibleCartItem, fallbackExperience, type VisibleCartState } from "./checkout-view-model.js";
import type { WidgetConfig } from "../lib/widget-types.js";

export function useCheckoutCart(
  experience: CheckoutExperienceSnapshot | null,
  config: WidgetConfig,
  persistCart?: (items: UpdateCartItemInput[]) => void | Promise<void>
) {
  const [visibleCart, setVisibleCart] = useState<VisibleCartState>(() =>
    buildVisibleCart(fallbackExperience(config))
  );
  const [selectedShippingMethod, setSelectedShippingMethod] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!experience) return;
    const cart = buildVisibleCart(experience);
    if (experience.shipping?.method) {
      setSelectedShippingMethod(experience.shipping.method);
    }
    setVisibleCart(cart);
  }, [experience]);

  // Optimistic local update for snappy UI; server reconciles cart + payable total
  // via persistCart. `next` carries the post-mutation quantity to send to the server.
  function persistQuantity(sku: string, next: VisibleCartState): void {
    const item = next.items.find((entry) => entry.sku === sku);
    void persistCart?.([{ sku, quantity: item?.quantity ?? 0 }]);
  }

  function handleRemoveCartItem(sku: string): void {
    setVisibleCart((current) => removeVisibleCartItem(current, sku));
    void persistCart?.([{ sku, quantity: 0 }]);
  }

  function incrementItem(sku: string): void {
    setVisibleCart((current) => {
      const next = incrementVisibleCartItem(current, sku);
      persistQuantity(sku, next);
      return next;
    });
  }

  function decrementItem(sku: string): void {
    setVisibleCart((current) => {
      const next = decrementVisibleCartItem(current, sku);
      persistQuantity(sku, next);
      return next;
    });
  }

  function applyShipping(method: string, price: number): void {
    setSelectedShippingMethod(method);
    setVisibleCart((current) => ({
      ...current,
      totals: {
        ...current.totals,
        shipping: price,
        total: Math.max(0, current.totals.subtotal + price - current.totals.discount)
      }
    }));
  }

  const visibleItems = visibleCart.items;
  const visibleTotals = visibleCart.totals;
  const cartItemCount = countVisibleItems(visibleItems);

  function resetCart(currency = config.cart.currency ?? "BRL"): void {
    setSelectedShippingMethod(undefined);
    setVisibleCart({
      items: [],
      totals: { currency, subtotal: 0, shipping: 0, discount: 0, total: 0 }
    });
  }

  return {
    visibleCart,
    visibleItems,
    visibleTotals,
    cartItemCount,
    handleRemoveCartItem,
    incrementItem,
    decrementItem,
    applyShipping,
    selectedShippingMethod,
    setVisibleCart,
    resetCart,
  };
}

export type CheckoutCartState = ReturnType<typeof useCheckoutCart>;
