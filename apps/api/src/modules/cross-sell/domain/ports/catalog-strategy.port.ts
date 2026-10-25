/**
 * Port for catalog-driven cross-sell strategies.
 * Derives suggestions directly from merchant's live catalog without manual promotion configuration.
 */
export const CROSS_SELL_CATALOG_STRATEGY = Symbol("CROSS_SELL_CATALOG_STRATEGY");

export interface CatalogStrategyRecommenderPort {
  /**
   * Same-category products as cart items. Excludes items already in cart.
   * Ordered by in-stock first, then price ascending (cheaper add-ons convert better).
   *
   * @param merchantId - tenant boundary
   * @param cartSkus - SKUs currently in cart
   * @param limit - max recommendations (default 3)
   * @returns ordered array of commercial SKUs
   */
  sameCategory(merchantId: string, cartSkus: string[], limit?: number): Promise<string[]>;

  /**
   * Products priced above cart's average line price.
   * Nudges buyer toward higher-value add-on. Ordered by price ascending above threshold.
   *
   * @param merchantId - tenant boundary
   * @param cartSkus - SKUs currently in cart
   * @param cartTotal - total cart value in units (e.g., dollars)
   * @param limit - max recommendations (default 3)
   * @returns ordered array of commercial SKUs
   */
  cartValueUpgrade(merchantId: string, cartSkus: string[], cartTotal: number, limit?: number): Promise<string[]>;
}
