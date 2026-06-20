import type { ShippingQuoteResult } from "../entities/shipping-quote.entity.js";

export type FreeShippingConfig = {
  enabled: boolean;
  min_cart_total: number;
};

/**
 * Apply the merchant free-shipping subsidy to a quote set.
 *
 * Contract (ADR §6.2): when free shipping qualifies it becomes exactly ONE
 * recommended option — the cheapest eligible (lowest original price) standard
 * carrier. All other carriers REMAIN PAID as explicitly-labeled alternatives.
 * We must never return every carrier at R$0,00.
 *
 * Tie-break for "cheapest" follows the same ordering used elsewhere in the
 * shipping engine: lowest price → soonest eta_days → label (pt-BR collation).
 *
 * Returns the free variant(s) only (the single subsidised carrier). The caller
 * (mergeFreeShipping) merges this single free entry over the matching paid
 * carrier and keeps the rest paid. Signature/return type unchanged.
 */
export function applyFreeShippingPolicy(
  results: ShippingQuoteResult[],
  cartTotal: number,
  config: FreeShippingConfig
): ShippingQuoteResult[] {
  if (!config.enabled || cartTotal < config.min_cart_total) return results;
  if (results.length === 0) return results;

  // Pick the single cheapest eligible carrier as the free/recommended option.
  const cheapest = results.reduce((best, r) => {
    if (r.price !== best.price) return r.price < best.price ? r : best;
    if (r.eta_days !== best.eta_days) return r.eta_days < best.eta_days ? r : best;
    return r.label.localeCompare(best.label, "pt-BR") < 0 ? r : best;
  });

  // Only that carrier becomes free; the others are left untouched (paid).
  return results.map((r) =>
    r === cheapest ? { ...r, price: 0, is_free: true } : r
  );
}
