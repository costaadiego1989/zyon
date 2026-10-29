import type { CrossSellStorefrontAcceptance, CrossSellStorefrontQuote, CrossSellStorefrontQuoteRequest, CrossSellStorefrontAcknowledgement } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import type { StorefrontCart, StorefrontCartCommercialSnapshot } from "./storefront-cart.port.js";
export const STOREFRONT_CROSS_SELL_CART = Symbol("STOREFRONT_CROSS_SELL_CART");
export type StorefrontCrossSellCartScope = { merchantId: string; cartId: string };
export type StorefrontCrossSellCartAcknowledgement = CrossSellStorefrontAcknowledgement;
export interface StorefrontCrossSellCartPort {
  /** Read-only actual NORMAL owner/proof dispatch; undefined means proved absence,
   * never invalid evidence. Does not authorize a mutation or expose a body flag. */
  projectNormalSource(scope: StorefrontCrossSellCartScope, expectedCart?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart|undefined>;
  project(scope: StorefrontCrossSellCartScope, expectedCart?: StorefrontCartCommercialSnapshot): Promise<StorefrontCart>;
  /** Internal server-only cost map; never include in public cart/quote DTOs. */
  projectForCheckout(scope: StorefrontCrossSellCartScope): Promise<{ cart: StorefrontCart; costsByVariant: ReadonlyMap<string, number> }>;
  quote(scope: StorefrontCrossSellCartScope, request: CrossSellStorefrontQuoteRequest): Promise<CrossSellStorefrontQuote>;
  accept(scope: StorefrontCrossSellCartScope, request: CrossSellStorefrontAcceptance): Promise<StorefrontCrossSellCartAcknowledgement>;
}

