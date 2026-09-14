import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { ApproveHypothesisUseCase } from "../use-cases/approve-hypothesis.use-case.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";

const rule = { id: "offer", name: "Oferta", enabled: false, priority: 1,
  conditions: [{ field: "cart_total", operator: "gte", value: 200 }],
  action: { type: "offer_discount", params: { percent: 10, maxDiscountReais: 30 } } };
function fixture(type: "prompt" | "discount_rule" = "discount_rule", options: { missingSettings?: boolean; experimentFailed?: boolean; conflict?: boolean } = {}) {
  let hypothesis = HypothesisEntity.create({ merchant_id: "merchant", observation_id: "obs",
    hypothesis_text: "Comparar oferta", reasoning: "Abandono observado", expected_lift_percent: 5, risk_level: "low",
    hypothesis_type: type, approval_strategy: "manual", ...(type === "discount_rule" ? { discount_rule_json: rule as never } : {}),
    template: { name: "Oferta", description: "Comparar", variant_a: { name: "Atual", system_prompt: "Atual", weight: 50, is_control: true },
      variant_b: { name: "Nova", system_prompt: "Nova", weight: 50, is_control: false } } });
  const original = CheckoutSettingsEntity.createDefault({ merchantId: "merchant" }).snapshot();
  original.advancedRules = [{ ...rule, id: "existing", enabled: true } as never];
  let savedSettings: typeof original | undefined; let expectedVersion: string | undefined; let approvals = 0; let experiments = 0;
  const useCase = new ApproveHypothesisUseCase(
    { findById: async () => hypothesis, save: async (h: HypothesisEntity) => { approvals++; hypothesis = h; } } as never,
    { appendOutbox: async () => {} } as never,
    { get: async () => options.missingSettings ? undefined : original,
      save: async (value: typeof original, version?: string) => {
        if (options.conflict) throw Error("CHECKOUT_SETTINGS_CONFLICT");
        savedSettings = value; expectedVersion = version; return value;
      } } as never,
    {} as never,
    { execute: async () => { experiments++; return options.experimentFailed ? { status: "failed", error: "unavailable" } : { status: "created", experiment_id: "experiment" }; } } as never,
  );
  return { original, get state() { return { savedSettings, expectedVersion, approvals, experiments }; },
    execute: (mode: "test_ab" | "apply_direct") => useCase.execute({ hypothesis_id: hypothesis.id, merchant_id: "merchant", approved_by: "owner", mode }) };
}
test("direct approval activates the capped rule, preserves existing rules and checks the settings version", async () => {
  const f = fixture(); const result = await f.execute("apply_direct");
  assert.equal(result.rule_id, "offer"); assert.equal(result.experiment_id, undefined);
  assert.equal(f.state.experiments, 0); assert.equal(f.state.expectedVersion, f.original.updatedAt);
  assert.deepEqual(f.state.savedSettings!.advancedRules, [f.original.advancedRules![0], { ...rule, enabled: true }]);
});
test("prompt changes require A/B testing and cannot be applied as a commercial rule", async () => {
  const f = fixture("prompt"); await assert.rejects(f.execute("apply_direct"), /HYPOTHESIS_REQUIRES_AB_TEST/);
  assert.equal(f.state.approvals, 0); assert.equal(f.state.experiments, 0);
});
test("unavailable settings prevent recording direct approval", async () => {
  const f = fixture("discount_rule", { missingSettings: true });
  await assert.rejects(f.execute("apply_direct"), /HYPOTHESIS_CHECKOUT_SETTINGS_UNAVAILABLE/);
  assert.equal(f.state.approvals, 0);
});
test("A/B approval returns a confirmed experiment identity without applying the rule directly", async () => {
  const f = fixture(); const result = await f.execute("test_ab");
  assert.equal(result.status, "experiment_created"); assert.equal(result.experiment_id, "experiment");
  assert.equal(f.state.experiments, 1); assert.equal(f.state.savedSettings, undefined);
});
test("experiment creation failure is not returned as a successful activation", async () => {
  const f = fixture("prompt", { experimentFailed: true }); const result = await f.execute("test_ab");
  assert.equal(result.status, "experiment_failed"); assert.equal(result.experiment_id, undefined);
});
test("concurrent settings changes propagate an error instead of reporting an applied rule", async () => {
  const f = fixture("discount_rule", { conflict: true });
  await assert.rejects(f.execute("apply_direct"), /CHECKOUT_SETTINGS_CONFLICT/);
  assert.equal(f.state.savedSettings, undefined);
});
