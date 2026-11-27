import type { CashbackDraft, CashbackRules } from "@zyon/shared-types";

export type LimitChoice = "" | "limited" | "unlimited";
export interface CashbackForm {
  earnRatePercent: string;
  minimumEarn: string;
  maximumEarnPerOrderChoice: LimitChoice;
  maximumEarnPerOrder: string;
  buyerMonthlyEarnLimitChoice: LimitChoice;
  buyerMonthlyEarnLimit: string;
  monthlyBudgetChoice: LimitChoice;
  monthlyBudget: string;
  releaseTrigger: "" | CashbackRules["releaseTrigger"];
  releaseDelayDays: string;
  expiryChoice: LimitChoice;
  expiryDays: string;
  minimumRedeemOrder: string;
  maximumRedeemPercent: string;
  maximumRedeemChoice: LimitChoice;
  maximumRedeem: string;
  allowWithDiscounts: "" | "yes" | "no";
  terms: string;
}

export const EMPTY_CASHBACK_FORM: CashbackForm = {
  earnRatePercent: "", minimumEarn: "", maximumEarnPerOrderChoice: "", maximumEarnPerOrder: "",
  buyerMonthlyEarnLimitChoice: "", buyerMonthlyEarnLimit: "", monthlyBudgetChoice: "", monthlyBudget: "",
  releaseTrigger: "", releaseDelayDays: "", expiryChoice: "", expiryDays: "", minimumRedeemOrder: "",
  maximumRedeemPercent: "", maximumRedeemChoice: "", maximumRedeem: "", allowWithDiscounts: "", terms: "",
};

/** Parses at most two decimal places without silently rounding the merchant's rule. */
export function cashbackDecimal(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? result : null;
}

const asDecimal = (value: number | undefined) => value === undefined ? "" : (value / 100).toFixed(2).replace(".", ",");
const limitChoice = (value: number | null | undefined): LimitChoice => value === undefined ? "" : value === null ? "unlimited" : "limited";

export function cashbackFormFromRules(rules: CashbackDraft | null): CashbackForm {
  if (!rules) return { ...EMPTY_CASHBACK_FORM };
  return {
    earnRatePercent: asDecimal(rules.earnRateBps), minimumEarn: asDecimal(rules.minimumEarnCents),
    maximumEarnPerOrderChoice: limitChoice(rules.maximumEarnPerOrderCents), maximumEarnPerOrder: asDecimal(rules.maximumEarnPerOrderCents ?? undefined),
    buyerMonthlyEarnLimitChoice: limitChoice(rules.buyerMonthlyEarnLimitCents), buyerMonthlyEarnLimit: asDecimal(rules.buyerMonthlyEarnLimitCents ?? undefined),
    monthlyBudgetChoice: limitChoice(rules.monthlyBudgetCents), monthlyBudget: asDecimal(rules.monthlyBudgetCents ?? undefined),
    releaseTrigger: rules.releaseTrigger ?? "", releaseDelayDays: rules.releaseDelayDays === undefined ? "" : String(rules.releaseDelayDays),
    expiryChoice: limitChoice(rules.expiryDays), expiryDays: rules.expiryDays == null ? "" : String(rules.expiryDays),
    minimumRedeemOrder: asDecimal(rules.minimumRedeemOrderCents), maximumRedeemPercent: asDecimal(rules.maximumRedeemBps),
    maximumRedeemChoice: limitChoice(rules.maximumRedeemCents), maximumRedeem: asDecimal(rules.maximumRedeemCents ?? undefined),
    allowWithDiscounts: rules.allowWithDiscounts === undefined ? "" : rules.allowWithDiscounts ? "yes" : "no", terms: rules.terms ?? "",
  };
}

export interface CashbackFormResult { rules: Partial<CashbackRules>; errors: Partial<Record<keyof CashbackForm, string>>; complete: boolean; }

export function parseCashbackForm(form: CashbackForm, requireComplete: boolean): CashbackFormResult {
  const rules: Partial<CashbackRules> = {};
  const errors: CashbackFormResult["errors"] = {};
  function decimal(field: keyof CashbackForm, key: keyof CashbackRules, minimum: number, maximum: number) {
    const value = form[field];
    if (!value.trim()) { if (requireComplete) errors[field] = "Preencha este campo. Use 0 quando não houver mínimo."; return; }
    const cents = cashbackDecimal(value);
    if (cents === null || cents < minimum || cents > maximum) { errors[field] = "Informe um valor válido, com no máximo duas casas decimais."; return; }
    Object.assign(rules, { [key]: cents });
  }
  function limit(choice: keyof CashbackForm, field: keyof CashbackForm, key: keyof CashbackRules) {
    if (form[choice] === "unlimited") Object.assign(rules, { [key]: null });
    else if (form[choice] === "limited") decimal(field, key, 1, 1_000_000_000_000);
    else if (requireComplete) errors[choice] = "Escolha um limite ou a opção sem limite.";
  }
  decimal("earnRatePercent", "earnRateBps", 1, 10000);
  decimal("minimumEarn", "minimumEarnCents", 0, 1_000_000_000_000);
  limit("maximumEarnPerOrderChoice", "maximumEarnPerOrder", "maximumEarnPerOrderCents");
  limit("buyerMonthlyEarnLimitChoice", "buyerMonthlyEarnLimit", "buyerMonthlyEarnLimitCents");
  limit("monthlyBudgetChoice", "monthlyBudget", "monthlyBudgetCents");
  if (form.releaseTrigger) rules.releaseTrigger = form.releaseTrigger;
  else if (requireComplete) errors.releaseTrigger = "Escolha o marco de liberação.";
  function days(field: "releaseDelayDays" | "expiryDays", key: "releaseDelayDays" | "expiryDays", minimum: number, maximum: number) {
    const text = form[field].trim();
    if (!text) { if (requireComplete) errors[field] = "Informe o prazo em dias."; return; }
    const value = Number(text);
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(value) || value < minimum || value > maximum) errors[field] = `Informe um número inteiro de ${minimum} a ${maximum} dias.`;
    else Object.assign(rules, { [key]: value });
  }
  days("releaseDelayDays", "releaseDelayDays", 0, 365);
  if (form.expiryChoice === "unlimited") rules.expiryDays = null;
  else if (form.expiryChoice === "limited") days("expiryDays", "expiryDays", 1, 3650);
  else if (requireComplete) errors.expiryChoice = "Escolha prazo de validade ou sem vencimento.";
  decimal("minimumRedeemOrder", "minimumRedeemOrderCents", 0, 1_000_000_000_000);
  decimal("maximumRedeemPercent", "maximumRedeemBps", 1, 9999);
  if (form.maximumRedeemPercent.trim() && cashbackDecimal(form.maximumRedeemPercent) === 10000) errors.maximumRedeemPercent = "O resgate deve ser menor que 100% para manter uma cobrança externa.";
  limit("maximumRedeemChoice", "maximumRedeem", "maximumRedeemCents");
  if (form.allowWithDiscounts) rules.allowWithDiscounts = form.allowWithDiscounts === "yes";
  else if (requireComplete) errors.allowWithDiscounts = "Escolha a regra de combinação com descontos.";
  if (form.terms.trim()) {
    if (form.terms.trim().length < 10 || form.terms.length > 10000) errors.terms = "Escreva um regulamento entre 10 e 10.000 caracteres.";
    else rules.terms = form.terms.trim();
  } else if (requireComplete) errors.terms = "Informe o regulamento que será apresentado ao cliente.";
  return { rules, errors, complete: Object.keys(errors).length === 0 && Object.keys(rules).length === 13 };
}

export const cashbackMoney = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
export function cashbackDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Data indisponível" : date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export const cashbackTransactionLabels: Record<string, string> = {
  grant: "Crédito gerado", release: "Crédito liberado", reserve: "Reserva no checkout", unreserve: "Reserva liberada", redeem: "Cashback utilizado",
  expire: "Crédito expirado", reverse: "Crédito estornado", restore: "Crédito restituído", adjustment: "Ajuste manual", loss: "Perda promocional",
};
