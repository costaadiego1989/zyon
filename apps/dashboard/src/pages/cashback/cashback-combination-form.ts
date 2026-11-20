import type { CashbackCombinationRules, CashbackDraft, CashbackRules } from "@zyon/shared-types";
import { cashbackDecimal } from "./cashback-form.js";
import type { LimitChoice } from "./cashback-form.js";

export interface CashbackCombinationForm {
  combinationAllowCoupons: "" | "yes" | "no";
  combinationAllowAdvancedRules: "" | "yes" | "no";
  combinationLimitMode: "" | CashbackCombinationRules["limitMode"];
  combinationPercentChoice: LimitChoice;
  combinationPercent: string;
  combinationMoneyChoice: LimitChoice;
  combinationMoney: string;
}

export const EMPTY_CASHBACK_COMBINATION_FORM: CashbackCombinationForm = {
  combinationAllowCoupons: "", combinationAllowAdvancedRules: "", combinationLimitMode: "",
  combinationPercentChoice: "", combinationPercent: "", combinationMoneyChoice: "", combinationMoney: "",
};

export function cashbackCombinationFormFromRules(rules?: CashbackDraft | null): CashbackCombinationForm {
  const combination = rules?.combination;
  if (!combination) return { ...EMPTY_CASHBACK_COMBINATION_FORM };
  const choice = (value: number | null | undefined): LimitChoice => value === null ? "unlimited" : typeof value === "number" && Number.isFinite(value) ? "limited" : "";
  const decimal = (value: number | null | undefined) => typeof value !== "number" || !Number.isFinite(value) ? "" : (value / 100).toFixed(2).replace(".", ",");
  return {
    combinationAllowCoupons: typeof combination.allowCoupons !== "boolean" ? "" : combination.allowCoupons ? "yes" : "no",
    combinationAllowAdvancedRules: typeof combination.allowAdvancedRules !== "boolean" ? "" : combination.allowAdvancedRules ? "yes" : "no",
    combinationLimitMode: combination.limitMode === "respect_general" || combination.limitMode === "cashback_specific" ? combination.limitMode : "",
    combinationPercentChoice: choice(combination.maximumCombinedDiscountBps), combinationPercent: decimal(combination.maximumCombinedDiscountBps),
    combinationMoneyChoice: choice(combination.maximumCombinedDiscountCents), combinationMoney: decimal(combination.maximumCombinedDiscountCents),
  };
}

export function parseCashbackCombinationForm(form: CashbackCombinationForm, required: boolean) {
  const combination: Partial<CashbackCombinationRules> = {};
  const errors: Partial<Record<keyof CashbackCombinationForm, string>> = {};
  if (form.combinationAllowCoupons) combination.allowCoupons = form.combinationAllowCoupons === "yes";
  else if (required) errors.combinationAllowCoupons = "Escolha se o cashback pode combinar com cupons.";
  if (form.combinationAllowAdvancedRules) combination.allowAdvancedRules = form.combinationAllowAdvancedRules === "yes";
  else if (required) errors.combinationAllowAdvancedRules = "Escolha se o cashback pode combinar com regras avançadas.";
  if (form.combinationLimitMode) combination.limitMode = form.combinationLimitMode;
  else if (required) errors.combinationLimitMode = "Escolha qual teto deve prevalecer.";

  const limits = [
    ["combinationPercentChoice", "combinationPercent", "maximumCombinedDiscountBps", 10000],
    ["combinationMoneyChoice", "combinationMoney", "maximumCombinedDiscountCents", 1_000_000_000_000],
  ] as const;
  for (const [choice, field, key, maximum] of limits) {
    if (form[choice] === "unlimited") combination[key] = null;
    else if (form[choice] === "limited") {
      if (!form[field].trim() && !required) continue;
      const value = cashbackDecimal(form[field]);
      if (value === null || value < 1 || value > maximum) errors[field] = key === "maximumCombinedDiscountBps"
        ? "Informe um percentual maior que 0 e de até 100%, com no máximo duas casas decimais."
        : "Informe um valor maior que 0, com no máximo duas casas decimais.";
      else combination[key] = value;
    } else if (required) errors[choice] = "Escolha definir este teto ou não usar este tipo de limite.";
  }
  if (combination.maximumCombinedDiscountBps === null && combination.maximumCombinedDiscountCents === null) {
    errors.combinationPercentChoice = "Defina pelo menos um teto: percentual, valor em reais ou ambos.";
  }
  return { combination, errors, complete: Object.keys(errors).length === 0 && Object.keys(combination).length === 5 };
}

export interface CashbackCombinationSimulation {
  error: string | null;
  productsCents: number;
  discountsCents: number;
  combinedLimitCents: number | null;
  maximumCashbackCents: number | null;
  totalCents: number | null;
  earnedCents: number | null;
}

export function simulateCashbackCombination(rules: CashbackRules, productsCents: number, couponCents: number, advancedCents: number,
  generalDiscountCapBps?: number | null): CashbackCombinationSimulation {
  const discountsCents = couponCents + advancedCents;
  const result: CashbackCombinationSimulation = { error: null, productsCents, discountsCents, combinedLimitCents: null,
    maximumCashbackCents: null, totalCents: null, earnedCents: null };
  const combination = rules.combination;
  const validMoney = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000_000;
  if (![productsCents, couponCents, advancedCents, discountsCents].every(validMoney) || productsCents === 0) return { ...result, error: "Informe valores válidos para a simulação." };
  if (!combination) return { ...result, error: "Defina as condições de combinação antes de simular." };
  if (discountsCents > productsCents) return { ...result, error: "Os descontos não podem superar o valor dos produtos." };
  if (couponCents > 0 && !combination.allowCoupons) return { ...result, error: "A combinação com cupons não é permitida por estas regras." };
  if (advancedCents > 0 && !combination.allowAdvancedRules) return { ...result, error: "A combinação com regras avançadas não é permitida por estas regras." };
  const rate = (value: number, bps: number) => Number(BigInt(value) * BigInt(bps) / 10000n);
  let limit = Math.min(combination.maximumCombinedDiscountBps === null ? productsCents : rate(productsCents, combination.maximumCombinedDiscountBps),
    combination.maximumCombinedDiscountCents ?? productsCents);
  if (combination.limitMode === "respect_general") {
    if (generalDiscountCapBps == null || !Number.isSafeInteger(generalDiscountCapBps) || generalDiscountCapBps < 0 || generalDiscountCapBps > 10000) {
      return { ...result, error: "O teto geral da loja ainda não está disponível. Consulte as regras avançadas para concluir esta simulação." };
    }
    limit = Math.min(limit, rate(productsCents, generalDiscountCapBps));
  }
  result.combinedLimitCents = limit;
  if (discountsCents > limit) return { ...result, error: "Cupom e regra avançada já ultrapassam o teto conjunto. Revise esses benefícios antes de usar cashback." };
  const net = productsCents - discountsCents;
  const maximumCashbackCents = net < rules.minimumRedeemOrderCents ? 0
    : Math.max(0, Math.min(limit - discountsCents, rate(net, rules.maximumRedeemBps), rules.maximumRedeemCents ?? net));
  const totalCents = net - maximumCashbackCents;
  const earnedCents = totalCents < rules.minimumEarnCents ? 0 : Math.min(rate(totalCents, rules.earnRateBps),
    rules.maximumEarnPerOrderCents ?? Number.MAX_SAFE_INTEGER, rules.buyerMonthlyEarnLimitCents ?? Number.MAX_SAFE_INTEGER,
    rules.monthlyBudgetCents ?? Number.MAX_SAFE_INTEGER);
  return { ...result, maximumCashbackCents, totalCents, earnedCents };
}
