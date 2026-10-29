/**
 * MERC-H3: Single source of truth for default merchant rules.
 * Used by both PrismaMerchantRepository and InMemoryMerchantRepository.
 */
import type { MerchantRules } from "./merchant.types.js";

export const DEFAULT_RULES: MerchantRules = {
  maxDiscountPercent: 10,
  minimumMarginPercent: 38,
  allowFreeShipping: true,
  allowShippingDiscount: true,
  allowBonusItem: false,
  allowStackDiscountAndFreeShipping: false,
  freeShippingMinCartValue: 250,
  maxShippingSubsidy: 45,
  maxPartialShippingDiscount: 20,
  offerExpirationMinutes: 15,
  blockedRegions: [],
  brandVoice: "consultative",
  couponBoxEnabled: true,
  autonomousEngineEnabled: true,
  originZip: undefined,
  quickReplies: undefined,
  cryptoPayments: undefined,
};
