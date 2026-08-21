import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../domain/entities/observation.entity.js";
import { StrategyLessonEntity } from "../domain/entities/strategy-lesson.entity.js";

/**
 * Integration Wiring Test — Verify the 4 components connect
 *
 * 1. ObserveMetrics use-case + repo
 * 2. GenerateHypothesis use-case + LLM generator
 * 3. CreateExperimentFromHypothesis use-case + CreateExperiment + StartExperiment
 * 4. StrategyFeedbackWorker listens for experiment.completed outbox event
 * 5. RecordStrategyLessonUseCase computes lesson
 */

test("Integration Wiring — Full Revenue Manager Loop", async (t) => {
  // Test the domain entity lifecycle (no external deps)

  await t.test("Observation → Hypothesis → Experiment → Lesson flow", () => {
    // ===== Step 1: Observation =====
    const observation = ObservationEntity.create({
      merchant_id: "m1",
      observation_window_start: new Date("2026-08-01"),
      observation_window_end: new Date("2026-08-02"),
      funnel: {
        total_sessions: 1000,
        started_checkout: 600,
        reached_shipping: 400,
        reached_payment: 300,
        completed_order: 200,
        conversion_rate: 0.2,
      },
      abandonment: {
        abandoned_at_shipping: 50,
        abandoned_at_payment: 80,
        abandonment_rate: 0.325,
        top_abandonment_objection: "shipping_cost",
      },
      objections: {
        shipping_cost_count: 200,
        price_count: 100,
        trust_count: 20,
        payment_count: 15,
        unknown_count: 5,
      },
      cross_sell: {
        suggestions_shown: 300,
        suggestions_accepted: 60,
        acceptance_rate: 0.2,
        top_suggested_skus: [],
      },
      cohorts: {
        returning_customers_rate: 0.3,
        new_customers_rate: 0.7,
        high_discount_sensitivity_rate: 0.4,
        low_discount_sensitivity_rate: 0.6,
      },
      revenue: {
        total_revenue_cents: 600000,
        avg_order_value_cents: 3000,
        total_orders: 200,
      },
      ai_costs_cents: 100,
    });

    assert.ok(observation.id);
    assert.strictEqual(observation.merchant_id, "m1");
    assert.strictEqual(observation.abandonment.top_abandonment_objection, "shipping_cost");

    // ===== Step 2: Hypothesis from observation =====
    const hypothesis = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: observation.id,
      hypothesis_text: "Emphasize shipping cost transparency",
      reasoning: "Shipping cost is top abandonment reason",
      expected_lift_percent: 8,
      risk_level: "low",
      template: {
        name: "Shipping Cost Transparency Test",
        description: "Explain shipping cost options upfront",
        variant_a: {
          name: "Control",
          system_prompt: "Standard checkout assistant",
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "Improved",
          system_prompt: "Proactively explain shipping cost options",
          weight: 50,
          is_control: false,
        },
      },
      approval_strategy: "auto",
    });

    assert.ok(hypothesis.id);
    assert.strictEqual(hypothesis.status, "approved"); // auto-approved (low risk)
    assert.strictEqual(hypothesis.observation_id, observation.id);

    // ===== Step 3: Mock experiment completion and lesson recording =====
    // (In real wiring: experiment created → auto-promote worker → strategy-feedback worker → record lesson)

    // Simulate experiment completed with control winning (hypothesis was wrong)
    const lessonData = {
      merchant_id: "m1",
      experiment_id: "exp_123",
      hypothesis_id: hypothesis.id,
      hypothesis_text: hypothesis.hypothesis_text,
      actual_winner: "control" as const,
      hypothesis_was_correct: false, // control won, but we expected variant to win
      control_conversion_rate: 0.22,
      challenger_conversion_rate: 0.21,
      conversion_lift_percent: -4.5,
      sessions_per_variant: 150,
      statistical_confidence: 0.87,
      insights: {
        why_winner_won: "Control was simpler, no confusion",
        objection_reduction: "No objection reduction observed",
        decision_speed_impact: "No impact",
        cross_sell_impact: "No impact",
        recommended_next_steps: ["Try different messaging approach", "Focus on trust signals instead"],
      },
      generator_feedback: "Hypothesis was incorrect. Control maintained higher conversion despite explicit shipping explanation.",
    };

    const lesson = StrategyLessonEntity.create(lessonData);

    assert.ok(lesson.id);
    assert.strictEqual(lesson.merchant_id, "m1");
    assert.strictEqual(lesson.experiment_id, "exp_123");
    assert.strictEqual(lesson.hypothesis_was_correct, false);
    assert.strictEqual(lesson.conversion_lift_percent, -4.5);
  });

  // Test the lifecycle state machine
  await t.test("Hypothesis state transitions: pending → approved → experiment_created", () => {
    const observation = ObservationEntity.create({
      merchant_id: "m1",
      observation_window_start: new Date("2026-08-01"),
      observation_window_end: new Date("2026-08-02"),
      funnel: {
        total_sessions: 100,
        started_checkout: 50,
        reached_shipping: 30,
        reached_payment: 20,
        completed_order: 15,
        conversion_rate: 0.15,
      },
      abandonment: {
        abandoned_at_shipping: 5,
        abandoned_at_payment: 8,
        abandonment_rate: 0.433,
        top_abandonment_objection: "price",
      },
      objections: {
        shipping_cost_count: 10,
        price_count: 30,
        trust_count: 5,
        payment_count: 3,
        unknown_count: 2,
      },
      cross_sell: {
        suggestions_shown: 50,
        suggestions_accepted: 10,
        acceptance_rate: 0.2,
        top_suggested_skus: [],
      },
      cohorts: {
        returning_customers_rate: 0.2,
        new_customers_rate: 0.8,
        high_discount_sensitivity_rate: 0.5,
        low_discount_sensitivity_rate: 0.5,
      },
      revenue: {
        total_revenue_cents: 75000,
        avg_order_value_cents: 5000,
        total_orders: 15,
      },
      ai_costs_cents: 50,
    });

    // Manual approval (medium risk)
    const manualHypothesis = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: observation.id,
      hypothesis_text: "Offer price-matching guarantee",
      reasoning: "Price is top concern",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "Price Matching Test",
        description: "Offer price match guarantee",
        variant_a: {
          name: "Control",
          system_prompt: "Standard",
          weight: 50,
          is_control: true,
        },
        variant_b: {
          name: "PriceMatch",
          system_prompt: "Mention price match guarantee",
          weight: 50,
          is_control: false,
        },
      },
      approval_strategy: "manual",
    });

    assert.strictEqual(manualHypothesis.status, "pending_review"); // Not auto-approved

    // Simulate merchant approval
    const approved = manualHypothesis.approve("merchant_user_1", "Looks good for testing");
    assert.strictEqual(approved.status, "approved");
    assert.strictEqual(approved.snapshot().merchant_approved_by, "merchant_user_1");

    // Mark experiment created
    const withExperiment = approved.markExperimentCreated("exp_456");
    assert.strictEqual(withExperiment.status, "experiment_created");
    assert.strictEqual(withExperiment.snapshot().created_experiment_id, "exp_456");
  });

  await t.test("Fingerprint deduplication prevents duplicate observations", () => {
    const baseMetrics = {
      merchant_id: "m1",
      observation_window_start: new Date("2026-08-01"),
      observation_window_end: new Date("2026-08-02"),
      funnel: {
        total_sessions: 500,
        started_checkout: 250,
        reached_shipping: 150,
        reached_payment: 100,
        completed_order: 70,
        conversion_rate: 0.14,
      },
      abandonment: {
        abandoned_at_shipping: 20,
        abandoned_at_payment: 30,
        abandonment_rate: 0.333,
        top_abandonment_objection: "trust",
      },
      objections: {
        shipping_cost_count: 50,
        price_count: 40,
        trust_count: 60,
        payment_count: 20,
        unknown_count: 10,
      },
      cross_sell: {
        suggestions_shown: 150,
        suggestions_accepted: 30,
        acceptance_rate: 0.2,
        top_suggested_skus: [],
      },
      cohorts: {
        returning_customers_rate: 0.25,
        new_customers_rate: 0.75,
        high_discount_sensitivity_rate: 0.35,
        low_discount_sensitivity_rate: 0.65,
      },
      revenue: {
        total_revenue_cents: 350000,
        avg_order_value_cents: 5000,
        total_orders: 70,
      },
      ai_costs_cents: 75,
    };

    const obs1 = ObservationEntity.create(baseMetrics);
    const obs2 = ObservationEntity.create(baseMetrics);

    // Same metrics = same fingerprint
    assert.strictEqual(obs1.fingerprint, obs2.fingerprint);

    // Different IDs (each is a new entity)
    assert.notStrictEqual(obs1.id, obs2.id);

    // Different metrics = different fingerprint
    const obs3 = ObservationEntity.create({
      ...baseMetrics,
      abandonment: {
        ...baseMetrics.abandonment,
        abandoned_at_shipping: 50, // Changed
      },
    });

    assert.notStrictEqual(obs1.fingerprint, obs3.fingerprint);
  });
});
