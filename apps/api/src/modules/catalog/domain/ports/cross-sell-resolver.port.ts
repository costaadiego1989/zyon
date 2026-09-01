import type { CartItem } from "@zyon/shared-types";

export const CROSS_SELL_RESOLVER_PORT = Symbol("CROSS_SELL_RESOLVER_PORT");

export interface CrossSellResolverPort {
  isKnownCrossSellSku(sku: string): boolean;
  resolveCartItem(sku: string): CartItem | null;
}
