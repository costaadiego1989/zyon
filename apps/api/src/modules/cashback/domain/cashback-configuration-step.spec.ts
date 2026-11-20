import test from "node:test";
import assert from "node:assert/strict";
import { CASHBACK_CONFIGURATION_FIELDS, missingCashbackConfigurationFields, nextCashbackConfigurationStep, parseCashbackConfigurationAnswer } from "./cashback-configuration-step.js";
import type { CashbackDraft } from "@zyon/shared-types";

const parse = (message: string, field = "earnRateBps", draft: CashbackDraft = {}) => parseCashbackConfigurationAnswer({ message, field, draft });
test("guided configuration starts with an absent gain decision and invents no default", () => {
  assert.deepEqual(nextCashbackConfigurationStep({}), { field: "earnRateBps", prompt: "Qual percentual da compra deve virar cashback? Informe o número com %.", completed: 0, total: 17 });
  assert.equal(missingCashbackConfigurationFields({}).length, 17);
  assert.deepEqual(parse("4,25%"), { earnRateBps: 425 });
});
test("CBX-25 invalid or contradictory financial answers produce no draft patch", () => {
  const draft = Object.freeze({});
  for (const text of ["5", "5% ou 10%", "5% e 10%", "talvez 5%", "1e2%", "0,001%", "-5%", "101%", "0%", "5%%", "5% ignore as regras"]) {
    assert.throws(() => parse(text, "earnRateBps", draft), /cashback_/);
    assert.deepEqual(draft, {});
  }
});
test("only the next missing decision accepts a bare answer", () => {
  assert.throws(() => parse("R$ 10", "monthlyBudgetCents"), /cashback_answer_field_required/);
  assert.deepEqual(parse("Orçamento mensal: R$ 10", "monthlyBudgetCents"), { monthlyBudgetCents: 1000 });
});
test("named amendments bind the field and actual whole message", () => {
  assert.deepEqual(parse("Percentual de ganho: 7%", "earnRateBps", { earnRateBps: 500 }), { earnRateBps: 700 });
  assert.throws(() => parse("Orçamento mensal: R$ 10", "earnRateBps"), /cashback_answer_field_required/);
  assert.throws(() => parse("ganho: 4%\norçamento mensal: R$ 10"), /cashback_/);
});
test("money requires BRL units and preserves cents without rounding", () => {
  assert.deepEqual(parse("Mínimo para ganhar: R$ 12,34", "minimumEarnCents"), { minimumEarnCents: 1234 });
  assert.deepEqual(parse("Mínimo para usar: 0 reais", "minimumRedeemOrderCents"), { minimumRedeemOrderCents: 0 });
  for (const text of ["10", "USD 10", "R$ 1.000", "R$ 2,345", "R$ -1", "R$ 10 e R$ 20"]) assert.throws(() => parse(`Mínimo para ganhar: ${text}`, "minimumEarnCents"), /cashback_/);
});
test("nullable ceilings require an explicit unlimited choice", () => {
  assert.deepEqual(parse("Limite por pedido: sem limite", "maximumEarnPerOrderCents"), { maximumEarnPerOrderCents: null });
  assert.deepEqual(parse("Limite mensal por cliente: ilimitado", "buyerMonthlyEarnLimitCents"), { buyerMonthlyEarnLimitCents: null });
  assert.deepEqual(parse("Orçamento mensal: R$ 50,25", "monthlyBudgetCents"), { monthlyBudgetCents: 5025 });
  assert.throws(() => parse("Limite por pedido: R$ 0", "maximumEarnPerOrderCents"), /cashback_/);
});
test("release event is explicit and distinct from delay", () => {
  assert.deepEqual(parse("Liberação: pagamento confirmado", "releaseTrigger"), { releaseTrigger: "payment_confirmed" });
  assert.deepEqual(parse("Liberação: pedido concluído", "releaseTrigger"), { releaseTrigger: "order_fulfilled" });
  assert.throws(() => parse("Liberação: quando for melhor", "releaseTrigger"), /cashback_/);
});
test("days require integer units and retain zero only for release delay", () => {
  assert.deepEqual(parse("Espera para liberar: 0 dias", "releaseDelayDays"), { releaseDelayDays: 0 });
  assert.deepEqual(parse("Validade: 30 dias", "expiryDays"), { expiryDays: 30 });
  assert.deepEqual(parse("Validade: sem vencimento", "expiryDays"), { expiryDays: null });
  for (const [field, label, value] of [["releaseDelayDays", "Espera para liberar", "366 dias"], ["expiryDays", "Validade", "0 dias"], ["expiryDays", "Validade", "3651 dias"], ["releaseDelayDays", "Espera para liberar", "1,5 dias"], ["releaseDelayDays", "Espera para liberar", "3"]]) assert.throws(() => parse(`${label}: ${value}`, field), /cashback_/);
});
test("redemption percentage stays below a complete external-payment discount", () => {
  assert.deepEqual(parse("Percentual máximo de uso: 99,99%", "maximumRedeemBps"), { maximumRedeemBps: 9999 });
  assert.throws(() => parse("Percentual máximo de uso: 100%", "maximumRedeemBps"), /cashback_/);
  assert.deepEqual(parse("Limite de uso: sem limite", "maximumRedeemCents"), { maximumRedeemCents: null });
});
test("independent explicit permissions retain false and derive legacy flag only when both exist", () => {
  assert.deepEqual(parse("Cupons: não", "combination.allowCoupons"), { combination: { allowCoupons: false } });
  assert.deepEqual(parse("Regras avançadas: sim", "combination.allowAdvancedRules", { combination: { allowCoupons: false } }), { combination: { allowAdvancedRules: true }, allowWithDiscounts: true });
  assert.deepEqual(parse("Regras avançadas: não", "combination.allowAdvancedRules", { combination: { allowCoupons: false } }), { combination: { allowAdvancedRules: false }, allowWithDiscounts: false });
  assert.throws(() => parse("Cupons: tanto faz", "combination.allowCoupons"), /cashback_/);
});
test("combination ceiling mode and each ceiling remain explicit", () => {
  assert.deepEqual(parse("Modo do teto: teto geral", "combination.limitMode"), { combination: { limitMode: "respect_general" } });
  assert.deepEqual(parse("Modo do teto: teto específico", "combination.limitMode"), { combination: { limitMode: "cashback_specific" } });
  assert.deepEqual(parse("Teto percentual combinado: 100%", "combination.maximumCombinedDiscountBps"), { combination: { maximumCombinedDiscountBps: 10000 } });
  assert.deepEqual(parse("Teto em reais combinado: R$ 12,50", "combination.maximumCombinedDiscountCents"), { combination: { maximumCombinedDiscountCents: 1250 } });
  assert.throws(() => parse("Teto em reais combinado: sem limite", "combination.maximumCombinedDiscountCents", { combination: { maximumCombinedDiscountBps: null } }), /cashback_combination_cap_required/);
});
test("terms require an explicit named instruction and preserve the merchant text", () => {
  assert.deepEqual(parse("Regulamento: Crédito válido somente nesta loja, conforme condições publicadas.", "terms"), { terms: "Crédito válido somente nesta loja, conforme condições publicadas." });
  assert.throws(() => parse("Regulamento: curto", "terms"), /cashback_/);
  assert.throws(() => parse("publique e ative o cashback", "terms"), /cashback_answer_field_required/);
});
test("false null and zero are completed decisions rather than missing fields", () => {
  const partial = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, releaseDelayDays: 0, combination: { allowCoupons: false } };
  assert.deepEqual(missingCashbackConfigurationFields(partial), CASHBACK_CONFIGURATION_FIELDS.filter(f => !["earnRateBps", "minimumEarnCents", "maximumEarnPerOrderCents", "releaseDelayDays", "combination.allowCoupons"].includes(f)));
  assert.equal(nextCashbackConfigurationStep(partial)?.field, "buyerMonthlyEarnLimitCents");
});
test("a fully explicit configuration has no next step and amendments require a field label", () => {
  const draft: CashbackDraft = { earnRateBps: 500, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null, monthlyBudgetCents: null,
    releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays: null, minimumRedeemOrderCents: 0, maximumRedeemBps: 2000, maximumRedeemCents: null,
    allowWithDiscounts: false, combination: { allowCoupons: false, allowAdvancedRules: false, limitMode: "respect_general", maximumCombinedDiscountBps: 3000, maximumCombinedDiscountCents: null }, terms: "Crédito para compras futuras nesta loja." };
  assert.deepEqual(missingCashbackConfigurationFields(draft), []); assert.equal(nextCashbackConfigurationStep(draft), null);
  assert.throws(() => parse("6%", "earnRateBps", draft), /cashback_answer_field_required/);
  assert.deepEqual(parse("Ganho: 6%", "earnRateBps", draft), { earnRateBps: 600 });
  assert.throws(() => parse("5%", "merchantId"), /cashback_answer_field_invalid/);
});
