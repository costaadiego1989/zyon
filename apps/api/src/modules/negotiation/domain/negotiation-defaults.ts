import type { BuyerNegotiationPreferences, MerchantNegotiationPolicy } from "@aacp/negotiation-engine";

export const DEFAULT_MERCHANT_NEGOTIATION_POLICY: MerchantNegotiationPolicy = {
  enabled: false,
  global: { minOfferDiscountPercent: 0, maxDiscountPercent: 10 },
  maxRounds: 1,
  estimatedCostPerAiCallCents: 1
};

export const DEFAULT_BUYER_NEGOTIATION_PREFERENCES: BuyerNegotiationPreferences = {
  enabled: false,
  targetDiscountPercent: 0,
  minimumAcceptableDiscountPercent: 0,
  maxRounds: 1,
  autoAccept: false
};
