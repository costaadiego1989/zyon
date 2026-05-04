import type { BuyerNegotiationPreferences } from "@aacp/negotiation-engine";

export function assertValidBuyerNegotiationPreferences(prefs: BuyerNegotiationPreferences): void {
  if (prefs.maxRounds < 1) throw new Error("buyer_prefs_invalid_rounds");
  if (prefs.targetDiscountPercent < 0 || prefs.targetDiscountPercent > 100) {
    throw new Error("buyer_prefs_invalid_target");
  }
  if (prefs.minimumAcceptableDiscountPercent < 0 || prefs.minimumAcceptableDiscountPercent > 100) {
    throw new Error("buyer_prefs_invalid_minimum");
  }
}
