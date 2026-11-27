import type { CashbackCombinationRules, CashbackRules } from "@zyon/shared-types";
import { CashbackError, cents, MAX_MONEY, rate } from "./cashback.js";

export interface CommercialBenefitOrigins {
  couponCents: number;
  advancedRuleCents: number;
  unknownCents: number;
  hasCoupon: boolean;
  hasAdvancedRule: boolean;
  hasUnknown: boolean;
  couponStackable?: boolean;
}
export interface CombinationContext {
  origins: CommercialBenefitOrigins;
  generalDiscountCapBps: number;
  marginDiscountLimitCents: number;
}

export function validateCombination(value: unknown): CashbackCombinationRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CashbackError("cashback_combination_required");
  const r = value as Record<string, unknown>;
  const keys = ["allowCoupons", "allowAdvancedRules", "limitMode", "maximumCombinedDiscountBps", "maximumCombinedDiscountCents"];
  if (keys.some(key => !Object.hasOwn(r, key) || r[key] === undefined) || Object.keys(r).some(key => !keys.includes(key))) throw new CashbackError("cashback_combination_choices_required");
  if (typeof r.allowCoupons !== "boolean" || typeof r.allowAdvancedRules !== "boolean") throw new CashbackError("cashback_combination_permissions_required");
  if (!["respect_general", "cashback_specific"].includes(String(r.limitMode))) throw new CashbackError("cashback_combination_mode_required");
  if (r.maximumCombinedDiscountBps !== null) {
    if (cents(r.maximumCombinedDiscountBps, "combined_rate", false) > 10000) throw new CashbackError("cashback_combined_rate_invalid");
  }
  if (r.maximumCombinedDiscountCents !== null) cents(r.maximumCombinedDiscountCents, "combined_cap", false);
  if (r.maximumCombinedDiscountBps === null && r.maximumCombinedDiscountCents === null) throw new CashbackError("cashback_combination_cap_required");
  return r as unknown as CashbackCombinationRules;
}

export function combinedDiscountCap(grossCents: number, policy: CashbackCombinationRules, generalCapBps: number): number {
  cents(grossCents); cents(generalCapBps, "general_rate");
  if (generalCapBps > 10000) throw new CashbackError("cashback_general_rate_invalid");
  return Math.min(policy.maximumCombinedDiscountBps === null ? MAX_MONEY : rate(grossCents, policy.maximumCombinedDiscountBps),
    policy.maximumCombinedDiscountCents ?? MAX_MONEY,
    policy.limitMode === "respect_general" ? rate(grossCents, generalCapBps) : MAX_MONEY, grossCents);
}

export function combinationEligibility(policy: CashbackCombinationRules, origins: CommercialBenefitOrigins): string | null {
  if (origins.hasCoupon && !policy.allowCoupons) return "cashback_coupon_combination_not_allowed";
  if (origins.hasAdvancedRule && !policy.allowAdvancedRules) return "cashback_rule_combination_not_allowed";
  if (origins.hasUnknown && !(policy.allowCoupons && policy.allowAdvancedRules)) return "cashback_unknown_benefit_origin";
  if (origins.hasCoupon && origins.couponStackable === false) return "cashback_coupon_exclusive";
  return null;
}

export function cashbackCombinedLimit(input: { grossCents: number; netProductsCents: number; availableCents: number; rules: CashbackRules; context: CombinationContext }): { maximumCashbackCents: number; reason: string | null; combinedCapCents: number } {
  const { grossCents, netProductsCents, availableCents, rules, context } = input;
  [grossCents, netProductsCents, availableCents].forEach(value => cents(value));
  const policy = validateCombination(rules.combination);
  const combinedCapCents = combinedDiscountCap(grossCents, policy, context.generalDiscountCapBps);
  const reason = combinationEligibility(policy, context.origins);
  const commercialCents = grossCents - netProductsCents;
  if (commercialCents < 0) throw new CashbackError("cashback_commercial_totals_invalid");
  if (reason) return { maximumCashbackCents: 0, reason, combinedCapCents };
  if (commercialCents > combinedCapCents) return { maximumCashbackCents: 0, reason: "cashback_combined_cap_exceeded", combinedCapCents };
  if (commercialCents > context.marginDiscountLimitCents) return { maximumCashbackCents: 0, reason: "cashback_minimum_margin", combinedCapCents };
  if (netProductsCents < rules.minimumRedeemOrderCents) return { maximumCashbackCents: 0, reason: null, combinedCapCents };
  return { maximumCashbackCents: Math.max(0, Math.min(availableCents, rate(netProductsCents, rules.maximumRedeemBps), rules.maximumRedeemCents ?? MAX_MONEY,
    combinedCapCents - commercialCents, context.marginDiscountLimitCents - commercialCents, netProductsCents)), reason: null, combinedCapCents };
}

/** Same product-cost and 4% payment-fee convention as the existing rules engine. */
export function marginDiscountLimit(grossCents: number, productCostCents: number, minimumMarginBps: number): number {
  cents(grossCents); cents(productCostCents); cents(minimumMarginBps, "minimum_margin");
  if (minimumMarginBps > 10000) throw new CashbackError("cashback_minimum_margin_invalid");
  const denominator = 10000 - 400 - minimumMarginBps;
  if (denominator <= 0) return 0;
  const minimumRevenue = Number((BigInt(productCostCents) * 10000n + BigInt(denominator) - 1n) / BigInt(denominator));
  return Math.max(0, grossCents - minimumRevenue);
}
