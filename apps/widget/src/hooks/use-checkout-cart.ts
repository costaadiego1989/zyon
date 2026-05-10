import { useEffect, useState } from "react";
import type { CheckoutExperienceSnapshot } from "@aacp/shared-types";
import { buildVisibleCart, countVisibleItems, removeVisibleCartItem, fallbackExperience, type VisibleCartState } from "./checkout-view-model.js";
import type { WidgetConfig } from "../lib/widget-types.js";

export function useCheckoutCart(
  experience: CheckoutExperienceSnapshot | null,
  config: WidgetConfig
) {
  const [visibleCart, setVisibleCart] = useState<VisibleCartState>(() =>
    buildVisibleCart(fallbackExperience(config))
  );

  useEffect(() => {
    if (!experience) return;
    setVisibleCart(buildVisibleCart(experience));
  }, [experience]);

  function handleRemoveCartItem(sku: string): void {
    setVisibleCart((current) => removeVisibleCartItem(current, sku));
  }

  const visibleItems = visibleCart.items;
  const visibleTotals = visibleCart.totals;
  const cartItemCount = countVisibleItems(visibleItems);

  return {
    visibleCart,
    visibleItems,
    visibleTotals,
    cartItemCount,
    handleRemoveCartItem,
    setVisibleCart,
  };
}

export type CheckoutCartState = ReturnType<typeof useCheckoutCart>;
