import type { PriceQuoteResult } from "../entities/price-quote-job.entity.js";

export function rankResults(results: PriceQuoteResult[]): string[] {
  return [...results]
    .filter((r) => r.availability !== "out_of_stock")
    .sort((a, b) => a.total_cost - b.total_cost)
    .map((r) => r.id);
}
