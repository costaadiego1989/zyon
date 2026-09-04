import type { Cart, MerchantRules } from "@zyon/shared-types";

export const DISCOUNT_RULES_ENGINE = Symbol("DISCOUNT_RULES_ENGINE");

export interface DiscountAuthorization {
  approved: boolean;
  /** The clamped, authorized discount value (0 if not approved) */
  authorizedDiscount: number;
  reason: string;
}

/**
 * Port over the @zyon/rules-engine evaluateDiscountOffer function.
 * Validates that a requested discount does not exceed maxDiscountPercent
 * and does not violate minimumMarginPercent.
 */
export interface DiscountRulesEnginePort {
  authorizeDiscount(
    cart: Cart,
    rules: MerchantRules,
    requestedDiscountValue: number,
    discountType: "percent" | "fixed"
  ): DiscountAuthorization;
}
