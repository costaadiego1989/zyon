/**
 * Port for collaborative-filtering cross-sell recommendations.
 * Derives recommendations from historical co-occurrence in buyer purchase records.
 */
export const CROSS_SELL_CO_OCCURRENCE = Symbol("CROSS_SELL_CO_OCCURRENCE");

export interface CrossSellCoOccurrencePort {
  /**
   * Given commercial SKUs currently in the cart, return the commercial SKUs
   * that most frequently co-occur with them in past orders of this merchant.
   * Excludes SKUs already in the cart. Empty array when no signal exists.
   *
   * @param merchantId - tenant boundary
   * @param cartCommercialSkus - SKUs currently in cart
   * @param limit - max number of recommendations to return (default 3)
   * @returns ordered array of commercial SKUs
   */
  recommend(merchantId: string, cartCommercialSkus: string[], limit?: number): Promise<string[]>;
}
