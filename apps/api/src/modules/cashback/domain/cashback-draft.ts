import type { CashbackCombinationRules, CashbackDraft } from "@zyon/shared-types";
import { CashbackError, cents } from "./cashback.js";

/** Validate only present choices. Missing fields remain absent, never defaults. */
export function validateCashbackDraft(value: unknown): CashbackDraft {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CashbackError("cashback_draft_invalid");
  let serialized: string;
  try { serialized = JSON.stringify(value); } catch { throw new CashbackError("cashback_draft_invalid"); }
  if (serialized.length > 16000) throw new CashbackError("cashback_draft_invalid");
  const r = value as Record<string, unknown>;
  const fields = ["earnRateBps", "minimumEarnCents", "maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "releaseTrigger", "releaseDelayDays", "expiryDays", "minimumRedeemOrderCents", "maximumRedeemBps", "maximumRedeemCents", "allowWithDiscounts", "terms", "combination"];
  if (Object.keys(r).some(key => !fields.includes(key))) throw new CashbackError("cashback_unknown_rule");
  if (Object.values(r).some(item => item === undefined)) throw new CashbackError("cashback_draft_choice_required");
  for (const key of ["minimumEarnCents", "minimumRedeemOrderCents"]) if (Object.hasOwn(r, key)) cents(r[key], key);
  for (const key of ["maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "maximumRedeemCents"]) if (Object.hasOwn(r, key) && r[key] !== null) cents(r[key], key, false);
  if (Object.hasOwn(r, "earnRateBps") && cents(r.earnRateBps, "rate", false) > 10000) throw new CashbackError("cashback_rate_out_of_range");
  if (Object.hasOwn(r, "maximumRedeemBps") && cents(r.maximumRedeemBps, "redeem_rate", false) >= 10000) throw new CashbackError("cashback_rate_out_of_range");
  if (Object.hasOwn(r, "releaseTrigger") && r.releaseTrigger !== "payment_confirmed" && r.releaseTrigger !== "order_fulfilled") throw new CashbackError("cashback_release_trigger_invalid");
  if (Object.hasOwn(r, "releaseDelayDays") && cents(r.releaseDelayDays, "release_delay") > 365) throw new CashbackError("cashback_release_delay_invalid");
  if (Object.hasOwn(r, "expiryDays") && r.expiryDays !== null && cents(r.expiryDays, "expiry", false) > 3650) throw new CashbackError("cashback_expiry_invalid");
  if (Object.hasOwn(r, "allowWithDiscounts") && typeof r.allowWithDiscounts !== "boolean") throw new CashbackError("cashback_discount_policy_required");
  if (Object.hasOwn(r, "terms") && (typeof r.terms !== "string" || r.terms.trim().length < 10 || r.terms.length > 10000)) throw new CashbackError("cashback_terms_required");

  const result = { ...r } as CashbackDraft;
  if (typeof r.terms === "string") result.terms = r.terms.trim();
  if (Object.hasOwn(r, "combination")) {
    if (!r.combination || typeof r.combination !== "object" || Array.isArray(r.combination)) throw new CashbackError("cashback_combination_required");
    const c = r.combination as Record<string, unknown>;
    const keys = ["allowCoupons", "allowAdvancedRules", "limitMode", "maximumCombinedDiscountBps", "maximumCombinedDiscountCents"];
    if (Object.keys(c).some(key => !keys.includes(key)) || Object.values(c).some(item => item === undefined)) throw new CashbackError("cashback_combination_choices_required");
    for (const key of ["allowCoupons", "allowAdvancedRules"]) if (Object.hasOwn(c, key) && typeof c[key] !== "boolean") throw new CashbackError("cashback_combination_permissions_required");
    if (Object.hasOwn(c, "limitMode") && c.limitMode !== "respect_general" && c.limitMode !== "cashback_specific") throw new CashbackError("cashback_combination_mode_required");
    if (Object.hasOwn(c, "maximumCombinedDiscountBps") && c.maximumCombinedDiscountBps !== null && cents(c.maximumCombinedDiscountBps, "combined_rate", false) > 10000) throw new CashbackError("cashback_combined_rate_invalid");
    if (Object.hasOwn(c, "maximumCombinedDiscountCents") && c.maximumCombinedDiscountCents !== null) cents(c.maximumCombinedDiscountCents, "combined_cap", false);
    if (c.maximumCombinedDiscountBps === null && c.maximumCombinedDiscountCents === null) throw new CashbackError("cashback_combination_cap_required");
    result.combination = { ...c } as Partial<CashbackCombinationRules>;
  }
  return result;
}
