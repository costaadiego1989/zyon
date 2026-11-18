import type { CashbackDraft } from "@zyon/shared-types";
import { CashbackError } from "./cashback.js";
import { validateCashbackDraft } from "./cashback-draft.js";

const decisions = [
  ["earnRateBps", "percent", "Qual percentual da compra deve virar cashback? Informe o número com %.", ["ganho", "percentual de ganho"]],
  ["minimumEarnCents", "money", "Qual o mínimo da compra para ganhar? Informe em R$, inclusive se o mínimo for zero.", ["mínimo para ganhar"]],
  ["maximumEarnPerOrderCents", "money_limit", "Qual o limite de ganho por pedido? Informe em R$ ou responda sem limite.", ["limite por pedido"]],
  ["buyerMonthlyEarnLimitCents", "money_limit", "Qual o limite mensal de ganho por cliente? Informe em R$ ou responda sem limite.", ["limite mensal por cliente"]],
  ["monthlyBudgetCents", "money_limit", "Qual o orçamento mensal para novos créditos? Informe em R$ ou responda sem limite.", ["orçamento mensal"]],
  ["releaseTrigger", "release", "Quando liberar o crédito: pagamento confirmado ou pedido concluído?", ["liberação"]],
  ["releaseDelayDays", "days", "Quantos dias esperar após esse evento? Informe um número inteiro com dias, inclusive se for zero.", ["espera para liberar"]],
  ["expiryDays", "expiry", "Qual a validade do crédito? Informe um número inteiro com dias ou responda sem vencimento.", ["validade"]],
  ["minimumRedeemOrderCents", "money", "Qual o mínimo da compra para usar cashback? Informe em R$, inclusive se o mínimo for zero.", ["mínimo para usar"]],
  ["maximumRedeemBps", "percent", "Qual percentual máximo da compra pode ser pago com cashback? Informe com %, abaixo de 100%.", ["percentual máximo de uso"]],
  ["maximumRedeemCents", "money_limit", "Qual o limite de uso por compra em dinheiro? Informe em R$ ou responda sem limite.", ["limite de uso"]],
  ["combination.allowCoupons", "boolean", "Permitir cashback junto com cupons? Responda sim ou não.", ["cupons"]],
  ["combination.allowAdvancedRules", "boolean", "Permitir cashback junto com regras avançadas? Responda sim ou não.", ["regras avançadas"]],
  ["combination.limitMode", "mode", "A combinação deve respeitar o teto geral ou usar um teto específico de cashback?", ["modo do teto"]],
  ["combination.maximumCombinedDiscountBps", "percent_limit", "Qual o teto percentual de todos os descontos combinados? Informe com % ou responda sem limite. Pelo menos um teto combinado deve ser definido.", ["teto percentual combinado"]],
  ["combination.maximumCombinedDiscountCents", "money_limit", "Qual o teto em reais de todos os descontos combinados? Informe em R$ ou responda sem limite. Pelo menos um teto combinado deve ser definido.", ["teto em reais combinado"]],
  ["terms", "terms", "Escreva o texto que o cliente deve ler, começando com Regulamento: e incluindo as condições do programa.", ["regulamento"]],
] as const;
export type CashbackConfigurationField = typeof decisions[number][0];
export const CASHBACK_CONFIGURATION_FIELDS: readonly CashbackConfigurationField[] = decisions.map(d => d[0]);
const normalized = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");
function read(draft: CashbackDraft, field: CashbackConfigurationField): unknown {
  return field.startsWith("combination.") ? draft.combination?.[field.slice(12) as keyof NonNullable<CashbackDraft["combination"]>] : draft[field as keyof CashbackDraft];
}
export function missingCashbackConfigurationFields(draft: CashbackDraft): CashbackConfigurationField[] {
  return CASHBACK_CONFIGURATION_FIELDS.filter(field => read(draft, field) === undefined);
}
export function nextCashbackConfigurationStep(draft: CashbackDraft) {
  const missing = missingCashbackConfigurationFields(draft), field = missing[0];
  if (!field) return null;
  return { field, prompt: decisions.find(d => d[0] === field)![2], completed: decisions.length - missing.length, total: decisions.length };
}
function decimal(text: string): number {
  if (!/^\d+(?:[,.]\d{1,2})?$/.test(text)) throw new CashbackError("cashback_answer_invalid");
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) throw new CashbackError("cashback_answer_invalid");
  return value;
}
/** Parse the persisted user message, never a value or quote supplied by the model.
 * Bare answers are restricted to the current missing decision. Amendments are named. */
export function parseCashbackConfigurationAnswer(input: { message: string; field: string; draft: CashbackDraft }): CashbackDraft {
  const decision = decisions.find(d => d[0] === input.field);
  if (!decision) throw new CashbackError("cashback_answer_field_invalid");
  if (typeof input.message !== "string" || input.message.length > 12000) throw new CashbackError("cashback_answer_invalid");
  const [field, type, , names] = decision;
  let answer = input.message.trim();
  const named = /^([^:\n=]{1,80})\s*[:=]\s*([\s\S]+)$/.exec(answer);
  if (named) {
    if (!(names as readonly string[]).some(name => normalized(name) === normalized(named[1]!))) throw new CashbackError("cashback_answer_field_required");
    answer = named[2]!.trim();
  } else if (field !== nextCashbackConfigurationStep(input.draft)?.field || type === "terms") throw new CashbackError("cashback_answer_field_required");
  const text = normalized(answer);
  let value: unknown;
  if (["money_limit", "percent_limit"].includes(type) && ["sem limite", "ilimitado"].includes(text)) value = null;
  else if (type === "expiry" && ["sem vencimento", "sem expiracao"].includes(text)) value = null;
  else if (type === "money" || type === "money_limit") {
    const match = /^(?:R\$\s*(\d+(?:[,.]\d{1,2})?)|(\d+(?:[,.]\d{1,2})?)\s*(?:reais|real))$/i.exec(answer);
    if (match) value = decimal(match[1] ?? match[2]!);
  } else if (type === "percent" || type === "percent_limit") {
    const match = /^(\d+(?:[,.]\d{1,2})?)\s*%$/.exec(answer); if (match) value = decimal(match[1]!);
  } else if (type === "days" || type === "expiry") {
    const match = /^(\d+)\s*dias?$/.exec(text); if (match) value = Number(match[1]);
  } else if (type === "boolean") {
    if (["sim", "permitir", "permitido"].includes(text)) value = true;
    if (["nao", "nao permitir", "proibir"].includes(text)) value = false;
  } else if (type === "release") {
    if (text === "pagamento confirmado") value = "payment_confirmed";
    if (text === "pedido concluido") value = "order_fulfilled";
  } else if (type === "mode") {
    if (["teto geral", "respeitar teto geral"].includes(text)) value = "respect_general";
    if (["teto especifico", "teto especifico de cashback"].includes(text)) value = "cashback_specific";
  } else if (type === "terms") value = answer;
  if (value === undefined) throw new CashbackError("cashback_answer_invalid");
  const patch: CashbackDraft = field.startsWith("combination.") ? { combination: { [field.slice(12)]: value } } : { [field]: value };
  const combination = { ...input.draft.combination, ...patch.combination };
  if (typeof combination.allowCoupons === "boolean" && typeof combination.allowAdvancedRules === "boolean" && field.startsWith("combination.")) {
    patch.allowWithDiscounts = combination.allowCoupons || combination.allowAdvancedRules;
  }
  validateCashbackDraft({ ...input.draft, ...patch, ...(Object.keys(combination).length ? { combination } : {}) });
  return validateCashbackDraft(patch);
}
