import type { PriceQuoteResult } from "../entities/price-quote-job.entity.js";

export type RoutingDecision = "integrated" | "external";

export function decidePurchaseRouting(result: PriceQuoteResult, merchantDomain: string): RoutingDecision {
  try {
    const url = new URL(result.url);
    if (url.hostname.includes(merchantDomain)) return "integrated";
  } catch {
    // non-parseable url → external
  }
  return "external";
}
