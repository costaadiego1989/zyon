import type { Cart, MerchantRules } from "@zyon/shared-types";

export const DISCOUNT_RULES_ENGINE = Symbol("DISCOUNT_RULES_ENGINE");

export interface DiscountAuthorization {
  approved: boolean;
  /** The clamped, authorized discount value (0 if not approved) */
  authorizedDiscount: number;
  /** Exact monetary result from a cent-based engine, when available. */
  authorizedDiscountCents?:number;
  reason: string;
}

/**
 * Port over the @zyon/rules-engine evaluateDiscountOffer function.
 * Validates that a requested discount does not exceed maxDiscountPercent.
 * Product cost/margin do not participate in eligibility (merchant decision).
 */
export interface DiscountRulesEnginePort {
  authorizeDiscount(
    cart: Cart,
    rules: MerchantRules,
    requestedDiscountValue: number,
    discountType: "percent" | "fixed"
  ): DiscountAuthorization;
}
