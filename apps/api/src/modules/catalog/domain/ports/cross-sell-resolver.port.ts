import type { CartItem } from "@zyon/shared-types";

export const CROSS_SELL_RESOLVER_PORT = Symbol("CROSS_SELL_RESOLVER_PORT");

/**
 * Abstraction for resolving cross-sell products by SKU.
 * Cross-sell module implements; catalog depends on abstraction only.
 * (CAT-H3: Introduce CrossSellResolverPort)
 */
export interface CrossSellResolverPort {
  isKnownCrossSellSku(sku: string): boolean;
  resolveCartItem(sku: string): CartItem;
}
