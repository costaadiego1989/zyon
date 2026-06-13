import { useEffect, useState } from "react";
import type { CheckoutExperienceSnapshot } from "@aacp/shared-types";
import { buildVisibleCart, countVisibleItems, removeVisibleCartItem, incrementVisibleCartItem, decrementVisibleCartItem, fallbackExperience, type VisibleCartState } from "./checkout-view-model.js";
import type { WidgetConfig } from "../lib/widget-types.js";

export function useCheckoutCart(
  experience: CheckoutExperienceSnapshot | null,
  config: WidgetConfig
) {
  const [visibleCart, setVisibleCart] = useState<VisibleCartState>(() =>
    buildVisibleCart(fallbackExperience(config))
  );
  const [selectedShippingMethod, setSelectedShippingMethod] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!experience) return;
    const cart = buildVisibleCart(experience);
    const apiHasShipping = Boolean(experience.shipping);
    if (apiHasShipping && experience.shipping?.method) {
      setSelectedShippingMethod(experience.shipping.method);
    }
    setVisibleCart(() => {
      if (selectedShippingMethod || apiHasShipping) {
        return cart;
      }
      return {
        ...cart,
        totals: {
          ...cart.totals,
          shipping: 0,
          total: Math.max(0, cart.totals.subtotal - cart.totals.discount)
        }
      };
    });
  }, [experience, selectedShippingMethod]);

  function handleRemoveCartItem(sku: string): void {
    setVisibleCart((current) => removeVisibleCartItem(current, sku));
  }

  function incrementItem(sku: string): void {
    setVisibleCart((current) => incrementVisibleCartItem(current, sku));
  }

  function decrementItem(sku: string): void {
    setVisibleCart((current) => decrementVisibleCartItem(current, sku));
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
