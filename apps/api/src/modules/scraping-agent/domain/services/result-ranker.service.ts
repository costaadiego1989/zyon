import type { PriceQuoteResult } from "../entities/price-quote-job.entity.js";

export class NoAvailableSourcesError extends Error {
  constructor() {
    super("no_available_sources");
    this.name = "NoAvailableSourcesError";
  }
}

export function rankResults(results: PriceQuoteResult[]): string[] {
  const available = [...results].filter((r) => r.availability !== "out_of_stock");
  if (available.length === 0) {
    throw new NoAvailableSourcesError();
  }
  return available.sort((a, b) => a.total_cost - b.total_cost).map((r) => r.id);
}
