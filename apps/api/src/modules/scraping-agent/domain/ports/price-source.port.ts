import type { ProductQuery, PriceQuoteResult } from "../entities/price-quote-job.entity.js";

export const PRICE_SOURCES = Symbol("PRICE_SOURCES");

export interface PriceSourcePort {
  readonly sourceKey: string;
  fetchQuote(query: ProductQuery, merchantId: string): Promise<PriceQuoteResult[]>;
}
