import test from "node:test";
import assert from "node:assert/strict";

import { AssignVariantToSessionUseCase } from "../use-cases/assign-variant-to-session.use-case.js";
import { PromptExperimentEntity } from "../../domain/entities/prompt-experiment.entity.js";
import type { ExperimentRepositoryPort } from "../../domain/ports/experiment-repository.port.js";

/**
 * F4-T04 — AssignVariantToSession returns applied_rule_id.
 *
 * Cobre ADI-F4-03/04 + INV-07:
 * - treatment com applied_rule_id → assignment retorna o id (checkout-offer usa
 *   como regra ativa no AdvancedRuleEvaluator);
 * - control → applied_rule_id null;
 * - sem experimento running → null (holdout/nenhum experimento nunca recebe
 *   variant; INV-07 é garantido upstream pelo HoldoutGroupService).
 */

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
    this.map.delete(id);
  }
}

function runningRuleExperiment(merchantId: string, ruleId: string): PromptExperimentEntity {
  const exp = PromptExperimentEntity.create({
    merchant_id: merchantId,
    name: "discount rule AB",
    variants: [
      { name: "Control", system_prompt: "baseline", weight: 50, is_control: true },
      { name: "Treatment", system_prompt: "baseline", weight: 50, is_control: false, applied_rule_id: ruleId },
    ],
  });
  return exp.start();
}

test("treatment variant → assignment returns its applied_rule_id", async () => {
  const repo = new InMemoryExperimentRepository();
  const ruleId = "rule_disc_abc";
  // Weight the treatment at 100 so weightedRandom deterministically picks it.
  const exp = PromptExperimentEntity.create({
    merchant_id: "m1",
    name: "forced treatment",
    variants: [
      { name: "Control", system_prompt: "baseline", weight: 0, is_control: true },
      { name: "Treatment", system_prompt: "baseline", weight: 100, is_control: false, applied_rule_id: ruleId },
    ],
  }).start();
  await repo.save(exp);

  const useCase = new AssignVariantToSessionUseCase(repo);
  const out = await useCase.execute({ merchant_id: "m1", session_id: "s1" });

  assert.ok(out, "assignment returned");
  assert.strictEqual(out.variant_name, "Treatment");
  assert.strictEqual(out.applied_rule_id, ruleId, "treatment surfaces rule id to checkout-offer");
});

test("control variant → applied_rule_id is null", async () => {
  const repo = new InMemoryExperimentRepository();
  const exp = PromptExperimentEntity.create({
    merchant_id: "m2",
    name: "forced control",
    variants: [
      { name: "Control", system_prompt: "baseline", weight: 100, is_control: true },
      { name: "Treatment", system_prompt: "baseline", weight: 0, is_control: false, applied_rule_id: "rule_x" },
    ],
  }).start();
  await repo.save(exp);

  const useCase = new AssignVariantToSessionUseCase(repo);
  const out = await useCase.execute({ merchant_id: "m2", session_id: "s2" });

  assert.ok(out);
  assert.strictEqual(out.variant_name, "Control");
  assert.strictEqual(out.applied_rule_id, null, "control never activates a rule");
});

test("output always carries applied_rule_id key across many assignments", async () => {
  const repo = new InMemoryExperimentRepository();
  await repo.save(runningRuleExperiment("m3", "rule_r"));
  const useCase = new AssignVariantToSessionUseCase(repo);

  for (let i = 0; i < 40; i++) {
    const out = await useCase.execute({ merchant_id: "m3", session_id: `s_${i}` });
    assert.ok(out);
    assert.ok("applied_rule_id" in out, "key present");
    // treatment → ruleId; control → null. Never undefined.
    assert.ok(out.applied_rule_id === "rule_r" || out.applied_rule_id === null);
  }
});

test("no running experiment → null (holdout / no-experiment never receives a rule)", async () => {
  const repo = new InMemoryExperimentRepository();
  const useCase = new AssignVariantToSessionUseCase(repo);
  const out = await useCase.execute({ merchant_id: "m_none", session_id: "s" });
  assert.strictEqual(out, null, "INV-07: no experiment → no variant → no rule");
});

test("tenant scope — running experiment of another merchant is not assigned", async () => {
  const repo = new InMemoryExperimentRepository();
  await repo.save(runningRuleExperiment("m_owner", "rule_owner"));
  const useCase = new AssignVariantToSessionUseCase(repo);

  const out = await useCase.execute({ merchant_id: "m_other", session_id: "s" });
  assert.strictEqual(out, null, "cross-tenant experiment never assigned (INV-06)");
});
