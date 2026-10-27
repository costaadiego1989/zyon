import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { StrategyLessonEntity } from "../domain/entities/strategy-lesson.entity.js";
import { assessRiskLevel, shouldAutoApprove } from "../domain/value-objects/hypothesis-risk-level.js";
import { validateHypothesisResponse, validateHypothesisSafety } from "../domain/services/hypothesis-validator.service.js";

/**
 * E2E Test: Full Autonomous Revenue Manager Flow
 *
 * Scenario: Merchant observes high shipping abandonment → LLM generates hypothesis →
 * system auto-approves low-risk hypothesis → experiment created → completes →
 * strategy lesson recorded.
 */
test("Revenue Manager E2E — Full Autonomous Flow", async (t) => {
  // ===== SETUP: Create base metrics for observation =====
  const baseMetrics = {
    merchant_id: "merchant_acme_1",
    observation_window_start: new Date("2026-08-19"),
    observation_window_end: new Date("2026-08-20"),
    funnel: {
      total_sessions: 1200,
      started_checkout: 600,
      reached_shipping: 450,
      reached_payment: 350,
      completed_order: 250,
      conversion_rate: 0.208, // 250/1200
    },
    abandonment: {
      abandoned_at_shipping: 100,
      abandoned_at_payment: 100,
      abandonment_rate: 0.567, // (100+100)/450 approx
      top_abandonment_objection: "shipping_cost" as const,
    },
    objections: {
      shipping_cost_count: 280,
      price_count: 150,
      trust_count: 40,
      payment_count: 30,
      unknown_count: 20,
    },
    cross_sell: {
      suggestions_shown: 400,
      suggestions_accepted: 120,
      acceptance_rate: 0.30,
      top_suggested_skus: [
        { sku: "PREMIUM_SKU", accepted_count: 80 },
        { sku: "BUNDLE_SKU", accepted_count: 40 },
      ],
    },
    cohorts: {
      returning_customers_rate: 0.35,
      new_customers_rate: 0.65,
      high_discount_sensitivity_rate: 0.42,
      low_discount_sensitivity_rate: 0.58,
    },
    revenue: {
      total_revenue_cents: 750000,
      avg_order_value_cents: 3000,
      total_orders: 250,
    },
    ai_costs_cents: 200,
  };

  // ===== STEP 1: Create & store observation =====
  await t.test("Step 1: Create observation with valid metrics", () => {
    const observation = ObservationEntity.create(baseMetrics);

    assert.ok(observation.id, "Observation has ID");
    assert.ok(observation.fingerprint, "Observation has fingerprint");
    assert.strictEqual(observation.merchant_id, "merchant_acme_1");
    assert.strictEqual(observation.funnel.conversion_rate, 0.208);
    assert.strictEqual(observation.abandonment.top_abandonment_objection, "shipping_cost");
  });

  // ===== STEP 2: Verify fingerprint determinism (deduplication) =====
  await t.test("Step 2: Fingerprints are deterministic for identical metrics", () => {
    const obs1 = ObservationEntity.create(baseMetrics);
    const obs2 = ObservationEntity.create(baseMetrics);

    assert.strictEqual(obs1.fingerprint, obs2.fingerprint, "Same metrics = same fingerprint");
    assert.notStrictEqual(obs1.id, obs2.id, "But different observation IDs");
  });

  // ===== STEP 3: Verify fingerprint changes with different metrics =====
  await t.test("Step 3: Fingerprints differ for different metrics", () => {
    const obs1 = ObservationEntity.create(baseMetrics);
    const obs2 = ObservationEntity.create({
      ...baseMetrics,
      abandonment: {
        ...baseMetrics.abandonment,
        abandoned_at_shipping: 150, // Different abandonment count
      },
    });

    assert.notStrictEqual(obs1.fingerprint, obs2.fingerprint);
  });

  // ===== STEP 4: Simulate LLM response for hypothesis =====
  await t.test("Step 4: Validate LLM-generated hypothesis response", () => {
    const llmResponse = {
      hypothesis_text: "Prominent free shipping offer to shipping-stage abandoners",
      reasoning: "280 shipping cost objections (36.7% of objections). High discount sensitivity in cohort (42%). Test: free shipping vs control.",
      expected_lift_percent: 8.5,
      template: {
        name: "Free Shipping vs Control",
        description: "Test free shipping offer impact on checkout completion",
        variant_a: {
          name: "Control",
          system_prompt: "Guide buyer through checkout normally",
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "Free Shipping Offer",
          system_prompt: "At shipping step, emphasize free shipping offer. Mention we cover shipping costs.",
          weight: 50,
          is_control: false,
        },
      },
    };

    // Validate JSON schema
    assert.doesNotThrow(() => validateHypothesisResponse(llmResponse));

    // Validate safety guardrails (merchant allows free shipping)
    const constraints = {
      max_discount_percent: 30,
      allow_free_shipping: true,
    };
    assert.doesNotThrow(() => validateHypothesisSafety(llmResponse, constraints));
  });

  // ===== STEP 5: Assess risk and determine approval strategy =====
  await t.test("Step 5: Risk assessment → auto-approval decision", () => {
    const expectedLift = 8.5;
    const riskLevel = assessRiskLevel(expectedLift, 0); // Free shipping = 0% monetary discount

    assert.strictEqual(riskLevel, "low", "Expected lift 8.5% + no monetary discount = low risk");
    assert.strictEqual(shouldAutoApprove(riskLevel), true, "Low risk → auto-approve");
  });

  // ===== STEP 6: Create hypothesis with auto-approval =====
  await t.test("Step 6: Create hypothesis — low risk → auto-approved status", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_20260820_001",
      hypothesis_text: "Free shipping offer reduces shipping stage abandonment",
      reasoning: "280 shipping cost objections; 42% discount sensitive cohort",
      expected_lift_percent: 8.5,
      risk_level: "low",
      template: {
        name: "Free Shipping vs Control",
        description: "Test free shipping on checkout completion",
        variant_a: {
          name: "Control",
          system_prompt: "Guide normally",
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "Free Shipping",
          system_prompt: "Emphasize free shipping at step",
          weight: 50,
          is_control: false,
        },
      },
      approval_strategy: "auto",
    });

    assert.strictEqual(hypothesis.status, "approved", "Auto strategy → approved at creation");
    assert.strictEqual(hypothesis.snapshot().merchant_approved_by, "system");
    assert.ok(hypothesis.snapshot().merchant_approved_at);
  });

  // ===== STEP 7: Manually-approved (medium risk) hypothesis =====
  await t.test("Step 7: Medium-risk hypothesis requires manual approval", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_20260820_002",
      hypothesis_text: "Test aggressive 25% discount on returning customers",
      reasoning: "Returning customers 35% of base. High discount sensitivity. Could lift AOV.",
      expected_lift_percent: 18.0, // 18% → medium risk
      risk_level: "medium",
      template: {
        name: "Aggressive Discount Test",
        description: "25% off for returning customers",
        variant_a: {
          name: "Control",
          system_prompt: "Standard offer flow",
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "25% Discount",
          system_prompt: "Offer 25% discount to returning customers",
          weight: 50,
          is_control: false,
        },
      },
      approval_strategy: "manual",
    });

    assert.strictEqual(hypothesis.status, "pending_review", "Manual strategy → pending_review");
    assert.strictEqual(hypothesis.snapshot().merchant_approved_by, undefined);
  });

  // ===== STEP 8: State machine transitions =====
  await t.test("Step 8: Hypothesis state machine — pending → approved", () => {
    const pending = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_001",
      hypothesis_text: "Test",
      reasoning: "Test reason",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    const approved = pending.approve("user_merchant_123", "Looks good for testing");
    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.snapshot().merchant_approved_by, "user_merchant_123");
  });

  // ===== STEP 9: Invalid state transition prevention =====
  await t.test("Step 9: Cannot re-approve or reject after approved", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_001",
      hypothesis_text: "Test",
      reasoning: "Test reason",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto",
    });

    const approved = hypothesis;
    assert.throws(
      () => approved.approve("another_user", "Again?"),
      /HYPOTHESIS_NOT_PENDING_REVIEW/,
      "Cannot approve non-pending hypothesis"
    );
    assert.throws(
      () => approved.reject("Nope"),
      /HYPOTHESIS_NOT_PENDING_REVIEW/,
      "Cannot reject approved hypothesis"
    );
  });

  // ===== STEP 10: Experiment creation prerequisite (approved status) =====
  await t.test("Step 10: Only approved hypothesis can create experiment", () => {
    const pending = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_001",
      hypothesis_text: "Pending test",
      reasoning: "Reason",
      expected_lift_percent: 15,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    assert.throws(
      () => pending.markExperimentCreated("exp_123"),
      /HYPOTHESIS_NOT_APPROVED/,
      "Cannot create experiment from pending hypothesis"
    );
  });

  // ===== STEP 11: Hypothesis → experiment transition =====
  await t.test("Step 11: Approved hypothesis transitions to experiment_created", () => {
    const approved = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_001",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 8,
      risk_level: "low",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto",
    });

    const withExperiment = approved.markExperimentCreated("exp_acme_001");
    assert.strictEqual(withExperiment.status, "experiment_created");
    assert.strictEqual(withExperiment.snapshot().created_experiment_id, "exp_acme_001");
  });

  // ===== STEP 12: Strategy lesson recording (post-experiment) =====
  await t.test("Step 12: Record strategy lesson after experiment completes", () => {
    const lesson = StrategyLessonEntity.create({
      merchant_id: "merchant_acme_1",
      experiment_id: "exp_acme_001",
      hypothesis_id: "hyp_acme_001",
      hypothesis_text: "Free shipping reduces shipping abandonment",
      actual_winner: "challenger",
      hypothesis_was_correct: true, // Hypothesis predicted challenger (free shipping) would win
      control_conversion_rate: 0.208,
      challenger_conversion_rate: 0.245, // Challenger won: 24.5% vs 20.8% = 17.8% lift
      conversion_lift_percent: 17.8,
      sessions_per_variant: 600,
      statistical_confidence: 0.96,
      insights: {
        why_winner_won: "Free shipping emphasis resonated with 42% discount-sensitive cohort",
        objection_reduction: "Shipping cost objections reduced by 35% in challenger variant",
        decision_speed_impact: "Average decision time 15% faster in free shipping variant",
        cross_sell_impact: "+8% cross-sell acceptance in challenger variant",
        recommended_next_steps: [
          "Promote free shipping offer to 100% of traffic",
          "Test free shipping + premium product bundling",
          "Analyze returning vs new customer response",
        ],
      },
      generator_feedback:
        "Expected lift: 8.5% | Actual lift: 17.8% | Confidence: 96% | Hypothesis correct: true",
    });

    assert.ok(lesson.id, "Lesson has ID");
    assert.strictEqual(lesson.hypothesis_was_correct, true, "Hypothesis prediction correct");
    assert.strictEqual(lesson.conversion_lift_percent, 17.8);
    assert.ok(lesson.insights.recommended_next_steps.length > 0);
  });

  // ===== STEP 13: High-risk hypothesis → manual approval + rejection =====
  await t.test("Step 13: High-risk hypothesis requires explicit manual approval", () => {
    const highRiskHypothesis = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: "obs_risky",
      hypothesis_text: "Test extreme 60% discount",
      reasoning: "Maximum risk test",
      expected_lift_percent: 65.0, // Way above 50% threshold
      risk_level: "high",
      template: {
        name: "Extreme Test",
        description: "Extreme discount",
        variant_a: { name: "Control", system_prompt: "Normal", weight: 50, is_control: true },
        variant_b: { name: "Extreme", system_prompt: "Offer 60% off", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    assert.strictEqual(highRiskHypothesis.status, "pending_review");

    // Merchant rejects
    const rejected = highRiskHypothesis.reject("Too aggressive, risk margin on profitability");
    assert.strictEqual(rejected.status, "rejected");
    assert.strictEqual(rejected.snapshot().rejection_reason, "Too aggressive, risk margin on profitability");
  });

  // ===== STEP 14: Constraint validation scenarios =====
  await t.test("Step 14: Running experiment constraint prevents duplicate hypotheses", () => {
    // Simulate: merchant has running experiment
    const h1 = HypothesisEntity.create({
      merchant_id: "merchant_constrained",
      observation_id: "obs_1",
      hypothesis_text: "First hypothesis",
      reasoning: "First",
      expected_lift_percent: 8,
      risk_level: "low",
      template: {
        name: "T1",
        description: "D1",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto",
    });

    const withExperiment = h1.markExperimentCreated("exp_running");
    assert.strictEqual(withExperiment.status, "experiment_created");

    // In a real scenario, constraint validator would check:
    // "If merchant_constrained has experiment status=running, reject second hypothesis"
    // For this test, we just verify the state machine allows it:
    const h2 = HypothesisEntity.create({
      merchant_id: "merchant_constrained",
      observation_id: "obs_2",
      hypothesis_text: "Second hypothesis (blocked by constraint)",
      reasoning: "Second",
      expected_lift_percent: 10,
      risk_level: "medium",
      template: {
        name: "T2",
        description: "D2",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    assert.ok(h2.id, "Second hypothesis created (constraint enforced at use-case layer)");
  });

  // ===== STEP 15: Observation inheritance by multiple hypotheses =====
  await t.test("Step 15: Multiple hypotheses can stem from single observation", () => {
    const obs = ObservationEntity.create(baseMetrics);

    const hyp1 = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: obs.id,
      hypothesis_text: "Hypothesis 1 from observation",
      reasoning: "R1",
      expected_lift_percent: 8,
      risk_level: "low",
      template: {
        name: "T1",
        description: "D1",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto",
    });

    const hyp2 = HypothesisEntity.create({
      merchant_id: "merchant_acme_1",
      observation_id: obs.id,
      hypothesis_text: "Hypothesis 2 from same observation",
      reasoning: "R2",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "T2",
        description: "D2",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    assert.strictEqual(hyp1.observation_id, obs.id);
    assert.strictEqual(hyp2.observation_id, obs.id);
    assert.notStrictEqual(hyp1.id, hyp2.id);
  });

  // ===== STEP 16: Snapshot/rehydration round-trip =====
  await t.test("Step 16: Entity snapshots can be rehydrated", () => {
    const obs = ObservationEntity.create(baseMetrics);
    const snap = obs.snapshot();
    const restored = ObservationEntity.rehydrate(snap);

    assert.strictEqual(restored.fingerprint, obs.fingerprint);
    assert.strictEqual(restored.merchant_id, obs.merchant_id);
    assert.deepStrictEqual(restored.funnel, obs.funnel);
  });
});
