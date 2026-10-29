import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../entities/hypothesis.entity.js";
import { ObservationEntity } from "../entities/observation.entity.js";
import { StrategyLessonEntity } from "../entities/strategy-lesson.entity.js";
import { assessRiskLevel, shouldAutoApprove } from "../value-objects/hypothesis-risk-level.js";
import { ConstraintViolation } from "../value-objects/constraint-violation.js";

test("HypothesisEntity", async (t) => {
  const baseInput = {
    merchant_id: "m1",
    observation_id: "obs1",
    hypothesis_text: "Offer 10% discount",
    reasoning: "High abandonment at payment",
    expected_lift_percent: 15,
    risk_level: "low" as const,
    template: {
      name: "Discount Test",
      description: "Test discount offer",
      variant_a: { name: "Control", system_prompt: "No offer", weight: 50, is_control: true },
      variant_b: { name: "Offer", system_prompt: "Offer 10% off", weight: 50, is_control: false },
    },
    approval_strategy: "manual" as const,
  };

  await t.test("creates hypothesis with pending_review status when strategy is manual", () => {
    const h = HypothesisEntity.create(baseInput);
    assert.strictEqual(h.status, "pending_review");
    assert.strictEqual(h.approval_strategy, "manual");
  });

  await t.test("creates hypothesis with approved status when strategy is auto", () => {
    const h = HypothesisEntity.create({ ...baseInput, approval_strategy: "auto" });
    assert.strictEqual(h.status, "approved");
    assert.strictEqual(h.snapshot().merchant_approved_by, "system");
  });

  await t.test("approve() transitions pending_review → approved", () => {
    const h = HypothesisEntity.create(baseInput);
    const updated = h.approve("user123", "Looks good");
    assert.strictEqual(updated.status, "approved");
    assert.strictEqual(updated.snapshot().merchant_approved_by, "user123");
    assert.strictEqual(updated.snapshot().merchant_approval_reason, "Looks good");
  });

  await t.test("approve() throws if not pending_review", () => {
    const h = HypothesisEntity.create({ ...baseInput, approval_strategy: "auto" });
    assert.throws(() => h.approve("user123"), /HYPOTHESIS_NOT_PENDING_REVIEW/);
  });

  await t.test("reject() transitions pending_review → rejected", () => {
    const h = HypothesisEntity.create(baseInput);
    const updated = h.reject("Too risky");
    assert.strictEqual(updated.status, "rejected");
    assert.strictEqual(updated.snapshot().rejection_reason, "Too risky");
  });

  await t.test("reject() throws if not pending_review", () => {
    const h = HypothesisEntity.create({ ...baseInput, approval_strategy: "auto" });
    assert.throws(() => h.reject("Some reason"), /HYPOTHESIS_NOT_PENDING_REVIEW/);
  });

  await t.test("markExperimentCreated() transitions approved → experiment_created", () => {
    const h = HypothesisEntity.create({ ...baseInput, approval_strategy: "auto" });
    const updated = h.markExperimentCreated("exp123");
    assert.strictEqual(updated.status, "experiment_created");
    assert.strictEqual(updated.snapshot().created_experiment_id, "exp123");
  });

  await t.test("markExperimentFailed() transitions approved → experiment_failed", () => {
    const h = HypothesisEntity.create({ ...baseInput, approval_strategy: "auto" });
    const updated = h.markExperimentFailed("Invalid JSON");
    assert.strictEqual(updated.status, "experiment_failed");
    assert.strictEqual(updated.snapshot().experiment_creation_error, "Invalid JSON");
  });

  await t.test("rehydrate() restores from snapshot", () => {
    const h = HypothesisEntity.create(baseInput);
    const snap = h.snapshot();
    const restored = HypothesisEntity.rehydrate(snap);
    assert.strictEqual(restored.status, h.status);
    assert.strictEqual(restored.id, h.id);
  });
});

test("ObservationEntity", async (t) => {
  const baseMetrics = {
    merchant_id: "m1",
    observation_window_start: new Date("2026-01-01"),
    observation_window_end: new Date("2026-01-02"),
    funnel: {
      total_sessions: 1000,
      started_checkout: 500,
      reached_shipping: 300,
      reached_payment: 250,
      completed_order: 200,
      conversion_rate: 0.2,
    },
    abandonment: {
      abandoned_at_shipping: 50,
      abandoned_at_payment: 100,
      abandonment_rate: 0.4,
      top_abandonment_objection: "shipping_cost",
    },
    objections: {
      shipping_cost_count: 150,
      price_count: 120,
      trust_count: 30,
      payment_count: 20,
      unknown_count: 5,
    },
    cross_sell: {
      suggestions_shown: 180,
      suggestions_accepted: 45,
      acceptance_rate: 0.25,
      top_suggested_skus: [{ sku: "SKU123", accepted_count: 20 }],
    },
    cohorts: {
      returning_customers_rate: 0.3,
      new_customers_rate: 0.7,
      high_discount_sensitivity_rate: 0.4,
      low_discount_sensitivity_rate: 0.6,
    },
    revenue: {
      total_revenue_cents: 500000,
      avg_order_value_cents: 2500,
      total_orders: 200,
    },
    ai_costs_cents: 150,
  };

  await t.test("creates observation with fingerprint", () => {
    const obs = ObservationEntity.create(baseMetrics);
    assert.ok(obs.id);
    assert.ok(obs.fingerprint);
    assert.strictEqual(obs.merchant_id, "m1");
  });

  await t.test("generates same fingerprint for identical metrics", () => {
    const obs1 = ObservationEntity.create(baseMetrics);
    const obs2 = ObservationEntity.create(baseMetrics);
    assert.strictEqual(obs1.fingerprint, obs2.fingerprint);
  });

  await t.test("generates different fingerprint for different metrics", () => {
    const obs1 = ObservationEntity.create(baseMetrics);
    const obs2 = ObservationEntity.create({
      ...baseMetrics,
      funnel: { ...baseMetrics.funnel, completed_order: 210 },
    });
    assert.notStrictEqual(obs1.fingerprint, obs2.fingerprint);
  });

  await t.test("snapshot includes all metrics", () => {
    const obs = ObservationEntity.create(baseMetrics);
    const snap = obs.snapshot();
    assert.strictEqual(snap.funnel.conversion_rate, 0.2);
    assert.strictEqual(snap.abandonment.top_abandonment_objection, "shipping_cost");
    assert.strictEqual(snap.revenue.total_revenue_cents, 500000);
  });
});

test("StrategyLessonEntity", async (t) => {
  await t.test("creates lesson with insights", () => {
    const lesson = StrategyLessonEntity.create({
      merchant_id: "m1",
      experiment_id: "exp1",
      hypothesis_id: "hyp1",
      hypothesis_text: "Offer discount",
      actual_winner: "challenger",
      hypothesis_was_correct: true,
      control_conversion_rate: 0.15,
      challenger_conversion_rate: 0.18,
      conversion_lift_percent: 20,
      sessions_per_variant: 500,
      statistical_confidence: 0.96,
      insights: {
        why_winner_won: "Discount resonated with price-sensitive segment",
        objection_reduction: "Shipping objection reduced by 15%",
        decision_speed_impact: "Decision time -20%",
        cross_sell_impact: "+5% cross-sell acceptance",
        recommended_next_steps: ["Promote to 100%", "Test in new cohort"],
      },
      generator_feedback: "Expected 15%, got 20%",
    });

    assert.ok(lesson.id);
    assert.strictEqual(lesson.hypothesis_was_correct, true);
    assert.strictEqual(lesson.conversion_lift_percent, 20);
  });

  await t.test("rehydrate() restores from snapshot", () => {
    const lesson = StrategyLessonEntity.create({
      merchant_id: "m1",
      experiment_id: "exp1",
      hypothesis_id: "hyp1",
      hypothesis_text: "Test",
      actual_winner: "control",
      hypothesis_was_correct: false,
      control_conversion_rate: 0.16,
      challenger_conversion_rate: 0.15,
      conversion_lift_percent: -6.25,
      sessions_per_variant: 100,
      statistical_confidence: 0.85,
      insights: {
        why_winner_won: "Control won",
        objection_reduction: "N/A",
        decision_speed_impact: "Neutral",
        cross_sell_impact: "Neutral",
        recommended_next_steps: ["Refine hypothesis"],
      },
      generator_feedback: "Hypothesis failed",
    });

    const snap = lesson.snapshot();
    const restored = StrategyLessonEntity.rehydrate(snap);
    assert.strictEqual(restored.hypothesis_was_correct, lesson.hypothesis_was_correct);
    assert.strictEqual(restored.conversion_lift_percent, lesson.conversion_lift_percent);
  });
});

test("RiskLevel", async (t) => {
  await t.test("returns 'low' for lift < 10% and discount <= 30%", () => {
    assert.strictEqual(assessRiskLevel(5, 20), "low");
    assert.strictEqual(assessRiskLevel(9, 30), "low");
  });

  await t.test("returns 'medium' for lift 10-50% and discount <= 30%", () => {
    assert.strictEqual(assessRiskLevel(10, 20), "medium");
    assert.strictEqual(assessRiskLevel(25, 15), "medium");
    assert.strictEqual(assessRiskLevel(49, 30), "medium");
  });

  await t.test("returns 'high' for lift >= 50% or discount > 30%", () => {
    assert.strictEqual(assessRiskLevel(50, 20), "high");
    assert.strictEqual(assessRiskLevel(15, 35), "high");
    assert.strictEqual(assessRiskLevel(60, 50), "high");
  });

  await t.test("shouldAutoApprove returns true only for 'low' risk", () => {
    assert.strictEqual(shouldAutoApprove("low"), true);
    assert.strictEqual(shouldAutoApprove("medium"), false);
    assert.strictEqual(shouldAutoApprove("high"), false);
  });
});

test("ConstraintViolation", async (t) => {
  await t.test("creates error with code and merchant info", () => {
    const err = new ConstraintViolation("MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT", "m1");
    assert.strictEqual(err.code, "MERCHANT_ALREADY_HAS_RUNNING_EXPERIMENT");
    assert.strictEqual(err.merchantId, "m1");
    assert.ok(err.message.includes("m1"));
  });

  await t.test("includes details in error message", () => {
    const err = new ConstraintViolation("HYPOTHESIS_EXTREME_DISCOUNT", "m1", { discount: 75 });
    assert.deepStrictEqual(err.details, { discount: 75 });
    assert.ok(err.message.includes("75"));
  });
});
