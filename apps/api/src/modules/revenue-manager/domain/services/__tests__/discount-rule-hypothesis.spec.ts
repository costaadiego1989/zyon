import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { MerchantRules } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import {
  DiscountRuleHypothesisService,
  type CohortStats,
} from "../discount-rule-hypothesis.service.js";

/**
 * F2-T01: Unit tests DiscountRuleHypothesisService
 *
 * Requisitos (ADI-F2-01..06):
 * - gera candidata AdvancedRule para cohort de baixa conversão, dentro dos caps
 * - não gera se sampleSize < 30
 * - percent respeitado ≤ maxDiscountPercent
 * - margem projetada < minimumMarginPercent → null
 * - fingerprint dedup (não gera idêntica repetida)
 * - autonomousEngineEnabled=false → retorna null
 */

test("DiscountRuleHypothesisService - gera candidata para cohort de baixa conversão", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    maxDiscountPercent: 20,
    minimumMarginPercent: 15,
  };

  // Cohort price_sensitive com N=50, baixa conversão (5%)
  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05, // 5% = baixa
      avgMarginPercent: 35, // suficiente acima do mínimo
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.ok(result, "deve gerar candidata para baixa conversão");
  assert.ok(result.rule, "candidata deve ter regra");
  assert.ok(result.rule.action.params.percent !== undefined);
  assert.ok(
    Number(result.rule.action.params.percent) <= rules.maxDiscountPercent,
    "percent dentro do cap"
  );
  assert.ok(result.fingerprint, "deve ter fingerprint");
});

test("DiscountRuleHypothesisService - não gera se sampleSize < 30", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules = DEFAULT_MERCHANT_RULES;

  // Cohort com N=20 (insuficiente)
  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 20,
      conversionRate: 0.03,
      avgMarginPercent: 35,
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.equal(result, null, "não deve gerar com N < 30");
});

test("DiscountRuleHypothesisService - respeita maxDiscountPercent", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    maxDiscountPercent: 10,
  };

  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05,
      avgMarginPercent: 35,
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.ok(result, "pode gerar candidata");
  assert.ok(
    Number(result.rule.action.params.percent) <= 10,
    "percent não excede cap de 10%"
  );
});

test("DiscountRuleHypothesisService - rejeita se margem projetada < minimumMarginPercent", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    maxDiscountPercent: 50,
    minimumMarginPercent: 40, // mínimo alto
  };

  // Cohort com margem insuficiente
  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05,
      avgMarginPercent: 30, // abaixo do mínimo de 40
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.equal(
    result,
    null,
    "não deve gerar candidata se margem violaria mínimo"
  );
});

test("DiscountRuleHypothesisService - fingerprint dedup (não gera repetida)", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    maxDiscountPercent: 20,
  };

  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05,
      avgMarginPercent: 35,
    },
  ];

  // Gera primeira candidata
  const result1 = service.generate(stats, rules, 30);
  assert.ok(result1, "primeira candidata gerada");

  // Mesmas stats → deve retornar null por dedup (fingerprint idêntico)
  const result2 = service.generate(stats, rules, 30);
  assert.equal(result2, null, "não deve gerar candidata idêntica (dedup)");
});

test("DiscountRuleHypothesisService - autonomousEngineEnabled=false → retorna null", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    autonomousEngineEnabled: false, // motor desligado
    maxDiscountPercent: 20,
  };

  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05,
      avgMarginPercent: 35,
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.equal(
    result,
    null,
    "não deve gerar candidata se autonomousEngineEnabled=false"
  );
});

test("DiscountRuleHypothesisService - retorna null se nenhuma candidata segura", async () => {
  const service = new DiscountRuleHypothesisService();
  const rules: MerchantRules = {
    ...DEFAULT_MERCHANT_RULES,
    maxDiscountPercent: 5,
    minimumMarginPercent: 50,
  };

  // Stats que não satisfazem: margem baixa, cap baixo
  const stats: CohortStats[] = [
    {
      intent: "price_sensitive",
      sampleSize: 50,
      conversionRate: 0.05,
      avgMarginPercent: 20,
    },
  ];

  const result = service.generate(stats, rules, 30);

  assert.equal(
    result,
    null,
    "retorna null quando nenhuma candidata é segura"
  );
});
