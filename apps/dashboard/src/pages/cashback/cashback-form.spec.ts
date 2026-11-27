import { describe, expect, it } from "vitest";
import { cashbackDecimal, cashbackFormFromRules, EMPTY_CASHBACK_FORM, parseCashbackForm } from "./cashback-form.js";

const completeForm = () => ({ ...EMPTY_CASHBACK_FORM, earnRatePercent: "5", minimumEarn: "0", maximumEarnPerOrderChoice: "unlimited" as const,
  buyerMonthlyEarnLimitChoice: "limited" as const, buyerMonthlyEarnLimit: "25,50", monthlyBudgetChoice: "limited" as const, monthlyBudget: "1000",
  releaseTrigger: "order_fulfilled" as const, releaseDelayDays: "7", expiryChoice: "limited" as const, expiryDays: "90", minimumRedeemOrder: "50",
  maximumRedeemPercent: "20", maximumRedeemChoice: "unlimited" as const, allowWithDiscounts: "no" as const, terms: "Crédito para novas compras nesta loja. Consulte todas as condições." });

describe("cashback merchant rules", () => {
  it("CB-01 starts without commercial prefills and never turns blanks into zero or unlimited", () => {
    expect(Object.values(cashbackFormFromRules(null)).every(value => value === "")).toBe(true);
    const result = parseCashbackForm({ ...EMPTY_CASHBACK_FORM }, true);
    expect(result.rules).toEqual({}); expect(result.complete).toBe(false);
    expect(Object.keys(result.errors)).toHaveLength(13);
    expect(result.errors.minimumEarn).toContain("Preencha"); expect(result.errors.expiryChoice).toContain("Escolha");
  });
  it("CB-02 publishes only explicit rules, preserves zero, false and explicit null, and converts money/rates exactly", () => {
    const result = parseCashbackForm(completeForm(), true);
    expect(result.errors).toEqual({}); expect(result.complete).toBe(true);
    expect(result.rules).toEqual({ earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: 2550,
      monthlyBudgetCents: 100000, releaseTrigger: "order_fulfilled", releaseDelayDays: 7, expiryDays: 90, minimumRedeemOrderCents: 5000,
      maximumRedeemBps: 2000, maximumRedeemCents: null, allowWithDiscounts: false, terms: completeForm().terms });
  });
  it("CB-02 rejects 100% redemption, extra decimals, invalid expiry and empty regulation", () => {
    const result = parseCashbackForm({ ...completeForm(), maximumRedeemPercent: "100", earnRatePercent: "5.001", expiryDays: "0", terms: "" }, true);
    expect(result.complete).toBe(false); expect(Object.keys(result.errors).sort()).toEqual(["earnRatePercent", "expiryDays", "maximumRedeemPercent", "terms"]);
    expect(cashbackDecimal("1e3")).toBeNull(); expect(cashbackDecimal("-1")).toBeNull(); expect(cashbackDecimal("1,25")).toBe(125);
  });
  it("CB-03 keeps partial drafts partial and round-trips unlimited choices without making them mandatory defaults", () => {
    expect(parseCashbackForm({ ...EMPTY_CASHBACK_FORM, earnRatePercent: "2,75" }, false)).toEqual({ rules: { earnRateBps: 275 }, errors: {}, complete: false });
    const rules = parseCashbackForm({ ...completeForm(), expiryChoice: "unlimited" }, true).rules;
    const result = cashbackFormFromRules(rules);
    expect(result.expiryChoice).toBe("unlimited"); expect(result.expiryDays).toBe("");
    expect(parseCashbackForm(result, true).rules).toEqual(rules);
  });
});
