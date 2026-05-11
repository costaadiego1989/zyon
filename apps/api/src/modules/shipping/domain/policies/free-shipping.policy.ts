import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";

export type FreeShippingConfig = {
  enabled: boolean;
  min_cart_total: number;
};

export function applyFreeShippingPolicy(
  results: ShippingQuoteResult[],
  cartTotal: number,
  config: FreeShippingConfig
): ShippingQuoteResult[] {
  if (!config.enabled || cartTotal < config.min_cart_total) return results;
  return results.map((r) => ({ ...r, price: 0, is_free: true }));
}
