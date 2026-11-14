import { describe, expect, it } from "vitest";
import type { CashbackRules } from "@zyon/shared-types";
import { cashbackCombinationFormFromRules, EMPTY_CASHBACK_COMBINATION_FORM, parseCashbackCombinationForm, simulateCashbackCombination } from "./cashback-combination-form.js";

const form = () => ({ ...EMPTY_CASHBACK_COMBINATION_FORM, combinationAllowCoupons: "yes" as const, combinationAllowAdvancedRules: "yes" as const,
  combinationLimitMode: "cashback_specific" as const, combinationPercentChoice: "limited" as const, combinationPercent: "30",
  combinationMoneyChoice: "unlimited" as const });
const rules: CashbackRules = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
  monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null,
  minimumRedeemOrderCents: 0, maximumRedeemBps: 2000, maximumRedeemCents: null, allowWithDiscounts: true,
  combination: { allowCoupons: true, allowAdvancedRules: true, limitMode: "cashback_specific", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null },
  terms: "Crédito na mesma loja." };

describe("cashback combination merchant controls", () => {
  it("CS-01 new and legacy programs require explicit choices without commercial defaults", () => {
    expect(Object.values(cashbackCombinationFormFromRules(null)).every(value => value === "")).toBe(true);
    expect(cashbackCombinationFormFromRules({ allowWithDiscounts: true })).toEqual(EMPTY_CASHBACK_COMBINATION_FORM);
    const parsed = parseCashbackCombinationForm({ ...EMPTY_CASHBACK_COMBINATION_FORM }, true);
    expect(parsed.complete).toBe(false); expect(parsed.combination).toEqual({}); expect(Object.keys(parsed.errors)).toHaveLength(5);
  });
  it("CS-01 explicit booleans and exact caps round-trip while both unlimited and invalid caps are rejected", () => {
    const parsed = parseCashbackCombinationForm(form(), true);
    expect(parsed.complete).toBe(true); expect(parsed.combination).toEqual(rules.combination);
    expect(cashbackCombinationFormFromRules({ combination: parsed.combination as CashbackRules["combination"] })).toEqual({ ...form(), combinationPercent: "30,00" });
    expect(parseCashbackCombinationForm({ ...form(), combinationAllowCoupons: "no" }, true).combination.allowCoupons).toBe(false);
    expect(parseCashbackCombinationForm({ ...form(), combinationPercentChoice: "unlimited" }, true).complete).toBe(false);
    for (const value of ["0", "100.01", "-1", "5.001", "1e3"]) expect(parseCashbackCombinationForm({ ...form(), combinationPercent: value }, true).complete).toBe(false);
    expect(parseCashbackCombinationForm({ ...form(), combinationPercent: "100" }, true).complete).toBe(true);
  });
  it("CS-01 partial drafts preserve only explicit combination choices", () => {
    const parsed = parseCashbackCombinationForm({ ...EMPTY_CASHBACK_COMBINATION_FORM, combinationAllowCoupons: "no" }, false);
    expect(parsed).toEqual({ combination: { allowCoupons: false }, errors: {}, complete: false });
  });
  it("CS-03 CS-08 100 products less 10 coupon and 5 advanced rule leaves 15 cashback under the 30 cap", () => {
    expect(simulateCashbackCombination(rules, 10000, 1000, 500, 1000)).toEqual({ error: null, productsCents: 10000, discountsCents: 1500,
      combinedLimitCents: 3000, maximumCashbackCents: 1500, totalCents: 7000, earnedCents: 350 });
  });
  it("CS-02 general cap remains binding and unavailable context never invents a valid zero", () => {
    const general = { ...rules, combination: { ...rules.combination!, limitMode: "respect_general" as const } };
    expect(simulateCashbackCombination(general, 10000, 1000, 500, 2000)).toMatchObject({ combinedLimitCents: 2000, maximumCashbackCents: 500, totalCents: 8000, earnedCents: 400 });
    expect(simulateCashbackCombination(general, 10000, 0, 0)).toMatchObject({ maximumCashbackCents: null, totalCents: null, error: expect.stringContaining("ainda não") });
    expect(simulateCashbackCombination(general, 10000, 1000, 500, 1000).error).toContain("ultrapassam");
  });
  it("CS-02 CS-04 permissions and the lower monetary or redemption limit always apply", () => {
    expect(simulateCashbackCombination({ ...rules, combination: { ...rules.combination!, allowCoupons: false } }, 10000, 1, 0).error).toContain("cupons");
    expect(simulateCashbackCombination({ ...rules, combination: { ...rules.combination!, allowAdvancedRules: false } }, 10000, 0, 1).error).toContain("avançadas");
    expect(simulateCashbackCombination({ ...rules, maximumRedeemCents: 250 }, 10000, 1000, 500).maximumCashbackCents).toBe(250);
    expect(simulateCashbackCombination({ ...rules, combination: { ...rules.combination!, maximumCombinedDiscountCents: 1800 } }, 10000, 1000, 500).maximumCashbackCents).toBe(300);
  });
});
