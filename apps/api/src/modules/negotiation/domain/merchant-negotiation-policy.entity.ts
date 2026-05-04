import type { MerchantNegotiationPolicy } from "@aacp/negotiation-engine";

function isValidRange(range: { minOfferDiscountPercent: number; maxDiscountPercent: number }): boolean {
  return (
    range.minOfferDiscountPercent >= 0 &&
    range.maxDiscountPercent >= 0 &&
    range.minOfferDiscountPercent <= range.maxDiscountPercent &&
    range.maxDiscountPercent <= 100
  );
}

export function assertValidMerchantNegotiationPolicy(policy: MerchantNegotiationPolicy): void {
  if (!isValidRange(policy.global)) {
    throw new Error("merchant_negotiation_policy_invalid_global");
  }
  for (const c of policy.categories ?? []) {
    if (!isValidRange(c)) throw new Error("merchant_negotiation_policy_invalid_category");
  }
  for (const i of policy.items ?? []) {
    if (!isValidRange(i)) throw new Error("merchant_negotiation_policy_invalid_item");
  }
}
