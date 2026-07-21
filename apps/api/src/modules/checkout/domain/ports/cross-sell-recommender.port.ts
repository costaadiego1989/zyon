import type { Cart, SuggestedProduct } from "@zyon/shared-types";

export const CHECKOUT_CROSS_SELL_RECOMMENDER = Symbol("CHECKOUT_CROSS_SELL_RECOMMENDER");

export interface CheckoutCrossSellRecommenderPort {
  suggest(input: {
    merchant_id: string;
    session_id: string;
    cart: Cart;
  }): Promise<SuggestedProduct[]>;
}
