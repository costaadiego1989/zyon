import test from "node:test";
import assert from "node:assert/strict";
import type { AdvancedRule, CheckoutSettings } from "@zyon/shared-types";

import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import type { HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import { CreateExperimentFromHypothesisUseCase } from "../use-cases/create-experiment-from-hypothesis.use-case.js";

import { CreateExperimentUseCase } from "../../../experiments/application/use-cases/create-experiment.use-case.js";
import { StartExperimentUseCase } from "../../../experiments/application/use-cases/start-experiment.use-case.js";
import { PromptExperimentEntity } from "../../../experiments/domain/entities/prompt-experiment.entity.js";
import type { ExperimentRepositoryPort } from "../../../experiments/domain/ports/experiment-repository.port.js";

import type { CheckoutSettingsRepository } from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";

import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";

/**
 * F4-T03 — CreateExperimentFromHypothesis (discount_rule) integration.
 *
 * Cobre ADI-F4-02: hipótese discount_rule aprovada → experimento com control
 * (applied_rule_id=null) + treatment (applied_rule_id=<ruleId>); a AdvancedRule
 * é persistida como draft (enabled=false) no checkout-settings do merchant.
 *
 * Test doubles in-memory (padrão dos int-specs do módulo). Prisma não é usado:
 * o PrismaClient injetado no use-case não é tocado por estes caminhos.
 */

class InMemoryHypothesisRepository implements HypothesisRepositoryPort {
  private map = new Map<string, HypothesisEntity>();
  async save(h: HypothesisEntity): Promise<void> {
    this.map.set(h.id, h);
  }
  async findById(id: string, merchantId: string): Promise<HypothesisEntity | null> {
    const h = this.map.get(id);
    return h && h.merchant_id === merchantId ? h : null;
  }
  async findByMerchant(
    merchantId: string,
    options?: { status?: string; limit?: number },
  ): Promise<HypothesisEntity[]> {
    const all = [...this.map.values()].filter((h) => h.merchant_id === merchantId);
    return options?.status ? all.filter((h) => h.status === options.status) : all;
  }
  async findPendingByMerchant(merchantId: string): Promise<HypothesisEntity[]> {
    return this.findByMerchant(merchantId, { status: "pending_review" });
  }
  async findByObservation(observationId: string): Promise<HypothesisEntity[]> {
    return [...this.map.values()].filter((h) => h.observation_id === observationId);
  }
}

class InMemoryExperimentRepository implements ExperimentRepositoryPort {
  private map = new Map<string, PromptExperimentEntity>();
  async save(e: PromptExperimentEntity): Promise<void> {
    this.map.set(e.id, e);
  }
  async findById(id: string, merchantId: string): Promise<PromptExperimentEntity | null> {
    const e = this.map.get(id);
    return e && e.merchant_id === merchantId ? e : null;
  }
  async findByMerchant(merchantId: string): Promise<PromptExperimentEntity[]> {
    return [...this.map.values()].filter((e) => e.merchant_id === merchantId);
  }
  async findRunning(merchantId: string): Promise<PromptExperimentEntity | null> {
    return (
      [...this.map.values()].find((e) => e.merchant_id === merchantId && e.status === "running") ??
      null
    );
  }
  async delete(id: string, merchantId: string): Promise<void> {
    const e = this.map.get(id);
    if (e && e.merchant_id === merchantId) this.map.delete(id);
  }
}

class InMemoryCheckoutSettingsRepository implements CheckoutSettingsRepository {
  private map = new Map<string, CheckoutSettings>();
  saveCalls = 0;
  async get(merchantId: string): Promise<CheckoutSettings | undefined> {
    return this.map.get(merchantId);
  }
  async save(settings: CheckoutSettings): Promise<CheckoutSettings> {
    this.saveCalls += 1;
    this.map.set(settings.merchantId, settings);
    return settings;
  }
  async delete(merchantId: string): Promise<void> {
    this.map.delete(merchantId);
  }
}

const candidateRule: AdvancedRule = {
  id: "rule_disc_candidate_1",
  name: "Cart >= 300 → 30% cap R$16",
  conditions: [{ field: "cart_total", operator: "gte", value: 300 }],
  action: { type: "offer_discount", params: { percent: 30, maxDiscountReais: 16 } },
  enabled: true,
  priority: 10,
};

function makeDiscountRuleHypothesis(merchantId: string): HypothesisEntity {
  return HypothesisEntity.create({
    merchant_id: merchantId,
    observation_id: "obs_disc_1",
    hypothesis_text: "Desconto escalonado eleva conversão do cohort price_sensitive",
    reasoning: "Baixa conversão no cohort price_sensitive",
    expected_lift_percent: 8,
    risk_level: "low",
    approval_strategy: "auto", // auto → status approved
    hypothesis_type: "discount_rule",
    discount_rule_json: candidateRule,
    template: {
      name: "AB: regra de desconto cart>=300",
      description: "control sem regra vs treatment com regra",
      variant_a: { name: "Control", system_prompt: "baseline", weight: 50, is_control: true },
      variant_b: { name: "Treatment", system_prompt: "baseline", weight: 50, is_control: false },
    },
  });
}

function buildUseCase(deps: {
  hypothesisRepo: HypothesisRepositoryPort;
  experimentRepo: ExperimentRepositoryPort;
  settingsRepo?: CheckoutSettingsRepository;
}): CreateExperimentFromHypothesisUseCase {
  const outbox = new InMemoryOutboxRepository();
  const createExp = new CreateExperimentUseCase(deps.experimentRepo, outbox);
  const startExp = new StartExperimentUseCase(deps.experimentRepo, outbox);
  // prisma unused on these paths — cast a stub
  const prismaStub = {} as never;
  return new CreateExperimentFromHypothesisUseCase(
    prismaStub,
    deps.hypothesisRepo,
    createExp,
    startExp,
    deps.settingsRepo,
  );
}

test("discount_rule hypothesis → treatment carries applied_rule_id, control null", async () => {
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const experimentRepo = new InMemoryExperimentRepository();
  const settingsRepo = new InMemoryCheckoutSettingsRepository();

  const h = makeDiscountRuleHypothesis("m_disc");
  await hypothesisRepo.save(h);

  const useCase = buildUseCase({ hypothesisRepo, experimentRepo, settingsRepo });
  const result = await useCase.execute({ merchant_id: "m_disc", hypothesis_id: h.id });

  assert.strictEqual(result.status, "created", "experiment created");
  assert.strictEqual(result.applied_rule_id, candidateRule.id, "output surfaces rule id");

  const exp = await experimentRepo.findById(result.experiment_id, "m_disc");
  assert.ok(exp, "experiment persisted");

  const control = exp.variants.find((v) => v.is_control);
  const treatment = exp.variants.find((v) => !v.is_control);
  assert.ok(control && treatment);
  assert.strictEqual(control.applied_rule_id ?? null, null, "control never carries a rule");
  assert.strictEqual(treatment.applied_rule_id, candidateRule.id, "treatment carries the rule");
});

test("discount_rule hypothesis → AdvancedRule persisted as DRAFT (enabled=false)", async () => {
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const experimentRepo = new InMemoryExperimentRepository();
  const settingsRepo = new InMemoryCheckoutSettingsRepository();

  const h = makeDiscountRuleHypothesis("m_draft");
  await hypothesisRepo.save(h);

  const useCase = buildUseCase({ hypothesisRepo, experimentRepo, settingsRepo });
  await useCase.execute({ merchant_id: "m_draft", hypothesis_id: h.id });

  const settings = await settingsRepo.get("m_draft");
  assert.ok(settings, "settings created for merchant");
  const persisted = settings.advancedRules.find((r) => r.id === candidateRule.id);
  assert.ok(persisted, "candidate rule persisted in advancedRules");
  assert.strictEqual(persisted.enabled, false, "rule is a draft (inert until treatment assigns it)");
  // params preserved (percent + reais cap)
  assert.strictEqual(persisted.action.params.percent, 30);
  assert.strictEqual(persisted.action.params.maxDiscountReais, 16);
});

test("draft persistence is idempotent — same rule id not duplicated", async () => {
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const experimentRepo = new InMemoryExperimentRepository();
  const settingsRepo = new InMemoryCheckoutSettingsRepository();

  // Pre-seed valid settings with an older copy of the same rule id (enabled=true)
  const seeded = CheckoutSettingsEntity.createDefault({ merchantId: "m_idem" })
    .update({ advancedRules: [{ ...candidateRule, name: "stale", enabled: true }] })
    .snapshot();
  await settingsRepo.save(seeded);

  const h = makeDiscountRuleHypothesis("m_idem");
  await hypothesisRepo.save(h);

  const useCase = buildUseCase({ hypothesisRepo, experimentRepo, settingsRepo });
  await useCase.execute({ merchant_id: "m_idem", hypothesis_id: h.id });

  const settings = await settingsRepo.get("m_idem");
  assert.ok(settings);
  const matches = settings.advancedRules.filter((r) => r.id === candidateRule.id);
  assert.strictEqual(matches.length, 1, "rule id appears exactly once (replaced, not duplicated)");
  assert.strictEqual(matches[0].enabled, false, "replaced copy is the draft");
});

test("prompt hypothesis → NO rule persisted, variants have no applied_rule_id", async () => {
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const experimentRepo = new InMemoryExperimentRepository();
  const settingsRepo = new InMemoryCheckoutSettingsRepository();

  const h = HypothesisEntity.create({
    merchant_id: "m_prompt",
    observation_id: "obs_p",
    hypothesis_text: "Tom mais urgente converte mais",
    reasoning: "x",
    expected_lift_percent: 5,
    risk_level: "low",
    approval_strategy: "auto",
    // hypothesis_type omitted → defaults to "prompt"
    template: {
      name: "AB prompt",
      description: "d",
      variant_a: { name: "Control", system_prompt: "calm", weight: 50, is_control: true },
      variant_b: { name: "Treatment", system_prompt: "urgent", weight: 50, is_control: false },
    },
  });
  await hypothesisRepo.save(h);

  const useCase = buildUseCase({ hypothesisRepo, experimentRepo, settingsRepo });
  const result = await useCase.execute({ merchant_id: "m_prompt", hypothesis_id: h.id });

  assert.strictEqual(result.status, "created");
  assert.strictEqual(result.applied_rule_id, undefined, "prompt hypothesis carries no rule");
  assert.strictEqual(settingsRepo.saveCalls, 0, "no draft rule persisted for prompt hypothesis");

  const exp = await experimentRepo.findById(result.experiment_id, "m_prompt");
  assert.ok(exp);
  for (const v of exp.variants) {
    assert.strictEqual(v.applied_rule_id ?? null, null, "no variant carries a rule");
  }
});

test("discount_rule hypothesis missing discount_rule_json → failed (no experiment)", async () => {
  const hypothesisRepo = new InMemoryHypothesisRepository();
  const experimentRepo = new InMemoryExperimentRepository();
  const settingsRepo = new InMemoryCheckoutSettingsRepository();

  // Rehydrate a discount_rule hypothesis WITHOUT the json (edge/corrupt data)
  const h = HypothesisEntity.rehydrate({
    id: "hyp_bad",
    merchant_id: "m_bad",
    observation_id: "obs_b",
    hypothesis_text: "x",
    reasoning: "x",
    expected_lift_percent: 5,
    risk_level: "low",
    hypothesis_type: "discount_rule",
    // discount_rule_json intentionally absent
    template: {
      name: "AB",
      description: "d",
      variant_a: { name: "Control", system_prompt: "a", weight: 50, is_control: true },
      variant_b: { name: "Treatment", system_prompt: "b", weight: 50, is_control: false },
    },
    status: "approved",
    approval_strategy: "manual",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await hypothesisRepo.save(h);

  const useCase = buildUseCase({ hypothesisRepo, experimentRepo, settingsRepo });
  const result = await useCase.execute({ merchant_id: "m_bad", hypothesis_id: "hyp_bad" });

  assert.strictEqual(result.status, "failed", "missing rule json → failed");
  assert.match(result.error ?? "", /DISCOUNT_RULE_MISSING/);
  assert.strictEqual(settingsRepo.saveCalls, 0, "no draft persisted");
  assert.strictEqual((await experimentRepo.findByMerchant("m_bad")).length, 0, "no experiment created");
});
