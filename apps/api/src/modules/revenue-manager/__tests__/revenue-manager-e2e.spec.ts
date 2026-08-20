import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { StrategyLessonEntity } from "../domain/entities/strategy-lesson.entity.js";
import { assessRiskLevel, shouldAutoApprove } from "../domain/value-objects/hypothesis-risk-level.js";
import { validateHypothesisResponse, validateHypothesisSafety } from "../domain/services/hypothesis-validator.service.js";
import type { HypothesisGenerationResponse } from "../domain/ports/hypothesis-generator.port.js";

/**
 * E2E Flow Test: Observe → Hypothesis → Approve → Create → Complete → Lesson
 *
 * Tests the entire revenue manager lifecycle using domain entities only
 * (no Prisma, no external dependencies). This validates the business logic
 * flow is correct end-to-end.
 */
test("Revenue Manager E2E Flow", async (t) => {
  // ===== Step 1: Observe merchant data =====
  await t.test("Step 1: ObserveMetrics — create observation from merchant data", () => {
    const observation = ObservationEntity.create({
      merchant_id: "merchant_test_1",
      observation_window_start: new Date("2026-08-01T00:00:00Z"),
      observation_window_end: new Date("2026-08-02T00:00:00Z"),
      funnel: {
        total_sessions: 1500,
        started_checkout: 600,
        reached_shipping: 400,
        reached_payment: 350,
        completed_order: 180,
        conversion_rate: 0.12,
      },
      abandonment: {
        abandoned_at_shipping: 80,
        abandoned_at_payment: 120,
        abandonment_rate: 0.47,
        top_abandonment_objection: "shipping_cost",
      },
      objections: {
        shipping_cost_count: 200,
        price_count: 100,
        trust_count: 40,
        payment_count: 25,
        unknown_count: 10,
      },
      cross_sell: {
        suggestions_shown: 300,
        suggestions_accepted: 60,
        acceptance_rate: 0.2,
        top_suggested_skus: [{ sku: "SKU-PREMIUM-1", accepted_count: 30 }],
      },
      cohorts: {
        returning_customers_rate: 0.25,
        new_customers_rate: 0.75,
        high_discount_sensitivity_rate: 0.45,
        low_discount_sensitivity_rate: 0.55,
      },
      revenue: {
        total_revenue_cents: 900000,
        avg_order_value_cents: 5000,
        total_orders: 180,
      },
      ai_costs_cents: 250,
    });

    assert.ok(observation.id, "Observation has ID");
    assert.ok(observation.fingerprint, "Observation has fingerprint");
    assert.strictEqual(observation.merchant_id, "merchant_test_1");
    // funnel does NOT have abandonment_rate (that's in abandonment)
    assert.strictEqual(observation.funnel.conversion_rate, 0.12);
  });

  // ===== Step 2: Generate hypothesis (simulated LLM response) =====
  await t.test("Step 2: GenerateHypothesis — validate LLM response + assess risk", () => {
    const llmResponse: HypothesisGenerationResponse = {
      hypothesis_text: "Offering a 10% discount coupon to users who abandon at the shipping step should reduce shipping-cost objections and improve conversion by 12%",
      reasoning: "47% abandonment rate with shipping_cost as top objection. High discount sensitivity (45%). Targeting the shipping step drop-off specifically.",
      expected_lift_percent: 12,
      template: {
        name: "Shipping Abandonment Discount V1",
        description: "Test 10% discount coupon vs no offer for users abandoning at shipping",
        variant_a: { name: "Control (No Offer)", system_prompt: "Assist the buyer through checkout without proactive discounting. Answer questions naturally.", weight: 50, is_control: true },
        variant_b: { name: "10% Discount Offer", system_prompt: "When a buyer hesitates at the shipping step, proactively offer a 10% discount coupon. Frame it as a limited-time offer.", weight: 50, is_control: false },
      },
    };

    // Validate JSON structure
    validateHypothesisResponse(llmResponse);

    // Validate safety
    validateHypothesisSafety(llmResponse, { max_discount_percent: 50, allow_free_shipping: false });

    // Assess risk
    const riskLevel = assessRiskLevel(llmResponse.expected_lift_percent);
    assert.strictEqual(riskLevel, "medium"); // 12% expected lift → medium

    // Should NOT auto-approve medium risk
    assert.strictEqual(shouldAutoApprove(riskLevel), false);
  });

  // ===== Step 3: Create hypothesis entity (pending_review for medium risk) =====
  await t.test("Step 3: CreateHypothesis — entity with manual approval required", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_test_1",
      observation_id: "obs_test_1",
      hypothesis_text: "Offering a 10% discount coupon to users who abandon at the shipping step",
      reasoning: "47% abandonment + high discount sensitivity",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "Shipping Abandonment Discount V1",
        description: "Test 10% discount coupon",
        variant_a: { name: "Control", system_prompt: "Assist naturally", weight: 50, is_control: true },
        variant_b: { name: "Discount", system_prompt: "Offer 10% discount", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    assert.strictEqual(hypothesis.status, "pending_review");
    assert.strictEqual(hypothesis.risk_level, "medium");
    assert.strictEqual(hypothesis.approval_strategy, "manual");
  });

  // ===== Step 4: Merchant approves hypothesis =====
  await t.test("Step 4: ApproveHypothesis — merchant approves pending hypothesis", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_test_1",
      observation_id: "obs_test_1",
      hypothesis_text: "Offering a 10% discount coupon",
      reasoning: "High abandonment",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "A", system_prompt: "No offer", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "Offer 10%", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    const approved = hypothesis.approve("merchant_user_42", "Looks good, let's try it");
    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.snapshot().merchant_approved_by, "merchant_user_42");
    assert.ok(approved.snapshot().merchant_approved_at);
  });

  // ===== Step 5: Create experiment from hypothesis =====
  await t.test("Step 5: MarkExperimentCreated — experiment created from approved hypothesis", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_test_1",
      observation_id: "obs_test_1",
      hypothesis_text: "Test",
      reasoning: "Test",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "T",
        description: "D",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // auto → approved at creation
    });

    assert.strictEqual(hypothesis.status, "approved");

    const withExperiment = hypothesis.markExperimentCreated("exp_test_001");
    assert.strictEqual(withExperiment.status, "experiment_created");
    assert.strictEqual(withExperiment.snapshot().created_experiment_id, "exp_test_001");
  });

  // ===== Step 6: Experiment completes → Record strategy lesson =====
  await t.test("Step 6: RecordStrategyLesson — learning from completed experiment", () => {
    const lesson = StrategyLessonEntity.create({
      merchant_id: "merchant_test_1",
      experiment_id: "exp_test_001",
      hypothesis_id: "hyp_test_001",
      hypothesis_text: "Offering a 10% discount coupon to reduce shipping abandonment",
      actual_winner: "challenger",
      hypothesis_was_correct: true,
      control_conversion_rate: 0.12,
      challenger_conversion_rate: 0.155,
      conversion_lift_percent: 29.17,
      sessions_per_variant: 250,
      statistical_confidence: 0.97,
      insights: {
        why_winner_won: "Discount Offer won significantly (29.2% lift). Strong signal to promote.",
        objection_reduction: "Shipping objection reduced from 47% to 31% of abandoners",
        decision_speed_impact: "Average time-to-checkout reduced by 18% in challenger variant",
        cross_sell_impact: "Cross-sell acceptance unchanged (not targeted in this experiment)",
        recommended_next_steps: [
          "Promote winning variant to 100% traffic",
          "Document learnings in strategy lesson database for LLM retraining",
        ],
      },
      generator_feedback: "Expected lift: 12% | Actual lift: 29.17% | Confidence: 97.0%",
    });

    assert.ok(lesson.id, "Lesson has ID");
    assert.strictEqual(lesson.hypothesis_was_correct, true);
    assert.strictEqual(lesson.conversion_lift_percent, 29.17);
    assert.ok(lesson.insights.recommended_next_steps.length >= 1);
  });

  // ===== Step 7: Low-risk auto-approval flow =====
  await t.test("Step 7: AutoApproval — low-risk hypothesis auto-approved", () => {
    const riskLevel = assessRiskLevel(5); // 5% lift → low risk
    assert.strictEqual(riskLevel, "low");
    assert.strictEqual(shouldAutoApprove(riskLevel), true);

    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_test_2",
      observation_id: "obs_test_2",
      hypothesis_text: "Minor tweak",
      reasoning: "Small optimization",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "T",
        description: "D",
        variant_a: { name: "A", system_prompt: "A prompt", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B prompt", weight: 50, is_control: false },
      },
      approval_strategy: "auto",
    });

    // Auto-approved at creation
    assert.strictEqual(hypothesis.status, "approved");
    assert.strictEqual(hypothesis.snapshot().merchant_approved_by, "system");
    assert.strictEqual(hypothesis.snapshot().merchant_approval_reason, "auto-approved (low risk)");
  });

  // ===== Step 8: Safety guardrails =====
  await t.test("Step 8: Safety — blocks extreme discounts and unsafe prompts", () => {
    const unsafeDiscount: HypothesisGenerationResponse = {
      hypothesis_text: "Offer 70% discount",
      reasoning: "Go big or go home",
      expected_lift_percent: 80,
      template: {
        name: "Extreme",
        description: "Test",
        variant_a: { name: "A", system_prompt: "Normal", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "Offer 70% off discount right now!", weight: 50, is_control: false },
      },
    };

    assert.throws(
      () => validateHypothesisSafety(unsafeDiscount, { max_discount_percent: 50, allow_free_shipping: false }),
      /HYPOTHESIS_EXTREME_DISCOUNT/,
    );

    // Extreme lift → high risk → no auto-approve
    const riskLevel = assessRiskLevel(80);
    assert.strictEqual(riskLevel, "high");
    assert.strictEqual(shouldAutoApprove(riskLevel), false);
  });

  // ===== Step 9: Rejection flow =====
  await t.test("Step 9: Rejection — merchant rejects hypothesis", () => {
    const hypothesis = HypothesisEntity.create({
      merchant_id: "merchant_test_1",
      observation_id: "obs_test_1",
      hypothesis_text: "Aggressive strategy",
      reasoning: "Reason",
      expected_lift_percent: 40,
      risk_level: "high",
      template: {
        name: "T",
        description: "D",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    const rejected = hypothesis.reject("Too aggressive for our brand positioning");
    assert.strictEqual(rejected.status, "rejected");
    assert.strictEqual(rejected.snapshot().rejection_reason, "Too aggressive for our brand positioning");

    // Cannot approve after rejection
    assert.throws(() => rejected.approve("user"), /HYPOTHESIS_NOT_PENDING_REVIEW/);
  });

  // ===== Step 10: Fingerprint deduplication =====
  await t.test("Step 10: Deduplication — same metrics produce same fingerprint", () => {
    const metricsInput = {
      merchant_id: "merchant_test_1",
      observation_window_start: new Date("2026-08-01T00:00:00Z"),
      observation_window_end: new Date("2026-08-02T00:00:00Z"),
      funnel: { total_sessions: 1000, started_checkout: 400, reached_shipping: 300, reached_payment: 250, completed_order: 150, conversion_rate: 0.15 },
      abandonment: { abandoned_at_shipping: 50, abandoned_at_payment: 80, abandonment_rate: 0.33, top_abandonment_objection: "price" },
      objections: { shipping_cost_count: 80, price_count: 150, trust_count: 20, payment_count: 15, unknown_count: 5 },
      cross_sell: { suggestions_shown: 200, suggestions_accepted: 40, acceptance_rate: 0.2, top_suggested_skus: [] },
      cohorts: { returning_customers_rate: 0.3, new_customers_rate: 0.7, high_discount_sensitivity_rate: 0.4, low_discount_sensitivity_rate: 0.6 },
      revenue: { total_revenue_cents: 750000, avg_order_value_cents: 5000, total_orders: 150 },
      ai_costs_cents: 200,
    };

    const obs1 = ObservationEntity.create(metricsInput);
    const obs2 = ObservationEntity.create(metricsInput);

    assert.strictEqual(obs1.fingerprint, obs2.fingerprint);
    assert.notStrictEqual(obs1.id, obs2.id); // Different UUIDs
  });
});
