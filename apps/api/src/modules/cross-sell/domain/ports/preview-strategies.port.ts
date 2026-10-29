import type { CatalogStrategyRecommenderPort } from "./catalog-strategy.port.js";
import type { CrossSellCoOccurrencePort } from "./co-occurrence.port.js";

export const CROSS_SELL_PREVIEW_STRATEGIES = Symbol("CROSS_SELL_PREVIEW_STRATEGIES");

/** Public previews historically used fresh recommenders per invocation. Keep
 * their cache lifetime separate from the shared checkout recommenders. */
export interface CrossSellPreviewStrategiesPort {
  createCatalog(): CatalogStrategyRecommenderPort;
  createCoOccurrence(): CrossSellCoOccurrencePort;
}

