import type { MerchantRules } from "@zyon/shared-types";
import { toNumber, type DecimalLike } from "../../../../shared/persistence/decimal.util.js";

/** Pure projection of an existing, fenced row; never inserts policy defaults. */
export function toMerchantRules(row: {
  maxDiscountPercent: DecimalLike; minimumMarginPercent: DecimalLike;
  allowFreeShipping: boolean; allowShippingDiscount: boolean; allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean; freeShippingMinCartValue: DecimalLike;
  maxShippingSubsidy: DecimalLike; maxPartialShippingDiscount: DecimalLike;
  offerExpirationMinutes: number; blockedRegions: string[]; brandVoice: string;
  couponBoxEnabled?: boolean | null; autonomousEngineEnabled?: boolean | null;
}): MerchantRules {
  return {
    maxDiscountPercent: toNumber(row.maxDiscountPercent), minimumMarginPercent: toNumber(row.minimumMarginPercent),
    allowFreeShipping: row.allowFreeShipping, allowShippingDiscount: row.allowShippingDiscount, allowBonusItem: row.allowBonusItem,
    allowStackDiscountAndFreeShipping: row.allowStackDiscountAndFreeShipping,
    freeShippingMinCartValue: toNumber(row.freeShippingMinCartValue), maxShippingSubsidy: toNumber(row.maxShippingSubsidy),
    maxPartialShippingDiscount: toNumber(row.maxPartialShippingDiscount), offerExpirationMinutes: row.offerExpirationMinutes,
    blockedRegions: row.blockedRegions, brandVoice: row.brandVoice as MerchantRules["brandVoice"],
    couponBoxEnabled: row.couponBoxEnabled ?? true, autonomousEngineEnabled: row.autonomousEngineEnabled ?? true,
  };
}
