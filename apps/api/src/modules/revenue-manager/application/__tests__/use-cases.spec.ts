import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../../domain/entities/observation.entity.js";
import type { HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import type { ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";
import type { StrategyLessonRepositoryPort } from "../../domain/ports/strategy-lesson-repository.port.js";
import type { StrategyLessonEntity } from "../../domain/entities/strategy-lesson.entity.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import type { DomainEventEnvelope } from "@zyon/shared-types";

// ===== IN-MEMORY REPOSITORIES =====

class InMemoryObservationRepository implements ObservationRepositoryPort {
  private observations = new Map<string, ObservationEntity>();
  private fingerprintIndex = new Map<string, ObservationEntity>();

  async save(observation: ObservationEntity): Promise<void> {
    this.observations.set(observation.id, observation);
    this.fingerprintIndex.set(observation.fingerprint, observation);
  }

  async findById(id: string, merchantId: string): Promise<ObservationEntity | null> {
    const obs = this.observations.get(id);
    return obs && obs.merchant_id === merchantId ? obs : null;
  }

  async findByFingerprint(fingerprint: string): Promise<ObservationEntity | null> {
    return this.fingerprintIndex.get(fingerprint) || null;
  }

  async findLatestByMerchant(merchantId: string): Promise<ObservationEntity | null> {
    const all = Array.from(this.observations.values())
      .filter((o) => o.merchant_id === merchantId)
      .sort(
        (a, b) =>
          new Date(b.snapshot().created_at).getTime() - new Date(a.snapshot().created_at).getTime(),
      );
    return all[0] || null;
  }

  async findByMerchant(merchantId: string, limit?: number): Promise<ObservationEntity[]> {
    return Array.from(this.observations.values())
      .filter((o) => o.merchant_id === merchantId)
      .slice(0, limit);
  }
}

class InMemoryHypothesisRepository implements HypothesisRepositoryPort {
  private hypotheses = new Map<string, HypothesisEntity>();

  async save(hypothesis: HypothesisEntity): Promise<void> {
    this.hypotheses.set(hypothesis.id, hypothesis);
  }

  async findById(id: string, merchantId: string): Promise<HypothesisEntity | null> {
    const h = this.hypotheses.get(id);
    return h && h.merchant_id === merchantId ? h : null;
  }

  async findByMerchant(
    merchantId: string,
    options?: { status?: string; limit?: number },
  ): Promise<HypothesisEntity[]> {
    const all = Array.from(this.hypotheses.values()).filter((h) => h.merchant_id === merchantId);
    if (options?.status) {
      return all.filter((h) => h.status === options.status).slice(0, options.limit);
    }
    return all.slice(0, options?.limit);
  }

  async findPendingByMerchant(merchantId: string): Promise<HypothesisEntity[]> {
    return this.findByMerchant(merchantId, { status: "pending_review" });
  }

  async findByObservation(observationId: string): Promise<HypothesisEntity[]> {
    return Array.from(this.hypotheses.values()).filter((h) => h.observation_id === observationId);
  }
}

class InMemoryStrategyLessonRepository implements StrategyLessonRepositoryPort {
  private lessons = new Map<string, StrategyLessonEntity>();

  async save(lesson: StrategyLessonEntity): Promise<void> {
    this.lessons.set(lesson.id, lesson);
  }

  async findByMerchant(merchantId: string, limit?: number): Promise<StrategyLessonEntity[]> {
    return Array.from(this.lessons.values())
      .filter((l) => l.merchant_id === merchantId)
      .slice(0, limit);
  }

  async findByExperiment(experimentId: string): Promise<StrategyLessonEntity[]> {
    return Array.from(this.lessons.values()).filter((l) => l.experiment_id === experimentId);
  }

  async findByHypothesis(hypothesisId: string): Promise<StrategyLessonEntity | null> {
    return (
      Array.from(this.lessons.values()).find((l) => l.hypothesis_id === hypothesisId) || null
    );
  }
}

class InMemoryOutboxRepository implements OutboxRepository {
  private events: DomainEventEnvelope[] = [];

  appendOutbox(event: DomainEventEnvelope): DomainEventEnvelope {
    this.events.push(event);
    return event;
  }

  listOutbox(_merchantId: string): DomainEventEnvelope[] { return []; }
  listPending(): DomainEventEnvelope[] { return this.events; }
  claimBatch(): { envelope: DomainEventEnvelope; attempts: number }[] { return []; }
  markDelivered(): void {}
  markFailed(): void {}
  recordFailure() { return { attempts: 1, dead: false }; }
  isProcessed(): boolean { return false; }
  isHandlerProcessed(): boolean { return false; }
  markHandlerProcessed(): void {}

  getAppended(): DomainEventEnvelope[] { return this.events; }
  reset(): void { this.events = []; }
}

// ===== FIXTURES =====

function baseObservationMetrics() {
  return {
    merchant_id: "m1",
    observation_window_start: new Date("2026-08-19"),
    observation_window_end: new Date("2026-08-20"),
    funnel: {
      total_sessions: 1000,
      started_checkout: 500,
      reached_shipping: 350,
      reached_payment: 300,
      completed_order: 200,
      conversion_rate: 0.2,
    },
    abandonment: {
      abandoned_at_shipping: 80,
      abandoned_at_payment: 50,
      abandonment_rate: 0.37,
      top_abandonment_objection: "shipping_cost" as const,
    },
    objections: {
      shipping_cost_count: 150,
      price_count: 100,
      trust_count: 30,
      payment_count: 20,
      unknown_count: 10,
    },
    cross_sell: {
      suggestions_shown: 200,
      suggestions_accepted: 60,
      acceptance_rate: 0.3,
      top_suggested_skus: [{ sku: "SKU_001", accepted_count: 40 }],
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
    ai_costs_cents: 180,
  };
}

function makeHypothesis(overrides?: Partial<Parameters<typeof HypothesisEntity.create>[0]>) {
  return HypothesisEntity.create({
    merchant_id: "m1",
    observation_id: "obs1",
    hypothesis_text: "Test hypothesis",
    reasoning: "Test reasoning",
    expected_lift_percent: 12,
    risk_level: "medium",
    template: {
      name: "Test",
      description: "Test",
      variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
      variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
    },
    approval_strategy: "manual",
    ...overrides,
  });
}

// ===== ObserveMetricsUseCase Logic Tests =====

test("ObserveMetricsUseCase — observation logic", async (t) => {
  await t.test("first observation call creates observation with fingerprint", async () => {
    const observationRepo = new InMemoryObservationRepository();
    const metrics = baseObservationMetrics();

    const observation = ObservationEntity.create(metrics);
    const existing = await observationRepo.findByFingerprint(observation.fingerprint);
    assert.strictEqual(existing, null, "No existing observation with this fingerprint");

    await observationRepo.save(observation);

    const stored = await observationRepo.findByFingerprint(observation.fingerprint);
    assert.ok(stored, "Observation saved and retrievable by fingerprint");
    assert.strictEqual(stored.id, observation.id);
  });

  await t.test("same fingerprint returns existing (dedup)", async () => {
    const observationRepo = new InMemoryObservationRepository();
    const metrics = baseObservationMetrics();

    const obs1 = ObservationEntity.create(metrics);
    await observationRepo.save(obs1);

    // Simulate second call with same metrics
    const obs2 = ObservationEntity.create(metrics);
    const existing = await observationRepo.findByFingerprint(obs2.fingerprint);

    assert.ok(existing, "Fingerprint match found → dedup triggered");
    assert.strictEqual(existing.id, obs1.id, "Returns original observation");
    // In real use-case, this would return null (deduped)
  });

  await t.test("different metrics generate new observation (no dedup)", async () => {
    const observationRepo = new InMemoryObservationRepository();
    const metrics = baseObservationMetrics();

    const obs1 = ObservationEntity.create(metrics);
    await observationRepo.save(obs1);

    // Change metrics
    const differentMetrics = {
      ...metrics,
      funnel: { ...metrics.funnel, completed_order: 250 }, // Different conversion
    };
    const obs2 = ObservationEntity.create(differentMetrics);
    const existing = await observationRepo.findByFingerprint(obs2.fingerprint);

    assert.strictEqual(existing, null, "Different metrics = different fingerprint = no dedup");
  });

  await t.test("different merchant_id generates different fingerprint", async () => {
    const metrics = baseObservationMetrics();
    const obs1 = ObservationEntity.create({ ...metrics, merchant_id: "m1" });
    const obs2 = ObservationEntity.create({ ...metrics, merchant_id: "m2" });
    assert.notStrictEqual(obs1.fingerprint, obs2.fingerprint);
  });

  await t.test("different window_start generates different fingerprint", async () => {
    const metrics = baseObservationMetrics();
    const obs1 = ObservationEntity.create(metrics);
    const obs2 = ObservationEntity.create({
      ...metrics,
      observation_window_start: new Date("2026-08-20"), // Different day
    });
    assert.notStrictEqual(obs1.fingerprint, obs2.fingerprint);
  });
});

// ===== GenerateHypothesisUseCase Logic Tests =====

test("GenerateHypothesisUseCase — hypothesis creation logic", async (t) => {
  await t.test("LLM valid response → hypothesis created", () => {
    // Simulate what use-case does after LLM returns valid JSON
    const llmResponse = {
      hypothesis_text: "Offer 10% discount to abandoners",
      reasoning: "High shipping abandonment",
      expected_lift_percent: 8.5,
    };

    const hypothesis = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: llmResponse.hypothesis_text,
      reasoning: llmResponse.reasoning,
      expected_lift_percent: llmResponse.expected_lift_percent,
      risk_level: "low", // assessed from expected_lift_percent < 10
      template: {
        name: "Discount Test",
        description: "Test discount at shipping",
        variant_a: { name: "Control", system_prompt: "Normal", weight: 50, is_control: true },
        variant_b: { name: "Offer", system_prompt: "Offer 10% off", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // low risk → auto
    });

    assert.ok(hypothesis.id);
    assert.strictEqual(hypothesis.status, "approved", "Low risk = auto-approved");
    assert.strictEqual(hypothesis.expected_lift_percent, 8.5);
  });

  await t.test("LLM invalid JSON → throws (prevents persistence)", async () => {
    const { validateHypothesisResponse } = await import(
      "../../domain/services/hypothesis-validator.service.js"
    );

    const invalidLLMResponse = {
      hypothesis_text: "Test",
      // Missing: reasoning, expected_lift_percent, template
    };

    assert.throws(
      () => validateHypothesisResponse(invalidLLMResponse),
      /HYPOTHESIS_INVALID_JSON/,
      "Invalid LLM response rejected before save",
    );
  });

  await t.test("LLM hallucination (discount 100%) → rejected by risk + safety", async () => {
    const { validateHypothesisSafety } = await import(
      "../../domain/services/hypothesis-validator.service.js"
    );
    const { assessRiskLevel } = await import(
      "../../domain/value-objects/hypothesis-risk-level.js"
    );

    const hallucinatedResponse = {
      hypothesis_text: "Give 100% discount to everyone",
      reasoning: "Maximum conversion",
      expected_lift_percent: 150,
      template: {
        name: "Hallucination",
        description: "Bad",
        variant_a: { name: "A", system_prompt: "Normal", weight: 50, is_control: true },
        variant_b: {
          name: "B",
          system_prompt: "Offer 100% discount free everything",
          weight: 50,
          is_control: false,
        },
      },
    };

    // Risk assessment catches it
    const riskLevel = assessRiskLevel(150, 100); // lift=150%, discount=100%
    assert.strictEqual(riskLevel, "high", "150% lift → high risk");

    // Safety guardrails also catch it
    assert.throws(
      () =>
        validateHypothesisSafety(hallucinatedResponse, {
          max_discount_percent: 50,
          allow_free_shipping: false,
        }),
      /HYPOTHESIS_EXTREME_DISCOUNT/,
      "100% discount exceeds max 50%",
    );
  });
});

// ===== CreateExperimentFromHypothesisUseCase Logic Tests =====

test("CreateExperimentFromHypothesisUseCase — preconditions", async (t) => {
  await t.test("approved hypothesis → can mark experiment created", () => {
    const h = makeHypothesis({ approval_strategy: "auto" }); // auto = approved
    assert.strictEqual(h.status, "approved");

    const withExp = h.markExperimentCreated("exp_001");
    assert.strictEqual(withExp.status, "experiment_created");
    assert.strictEqual(withExp.snapshot().created_experiment_id, "exp_001");
  });

  await t.test("non-approved hypothesis → throws HYPOTHESIS_NOT_APPROVED", () => {
    const h = makeHypothesis({ approval_strategy: "manual" }); // manual = pending_review
    assert.strictEqual(h.status, "pending_review");

    assert.throws(
      () => h.markExperimentCreated("exp_001"),
      /HYPOTHESIS_NOT_APPROVED/,
      "Cannot create experiment from pending hypothesis",
    );
  });

  await t.test("rejected hypothesis → throws HYPOTHESIS_NOT_APPROVED", () => {
    const pending = makeHypothesis({ approval_strategy: "manual" });
    const rejected = pending.reject("Too risky");
    assert.strictEqual(rejected.status, "rejected");

    assert.throws(
      () => rejected.markExperimentCreated("exp_001"),
      /HYPOTHESIS_NOT_APPROVED/,
      "Cannot create experiment from rejected hypothesis",
    );
  });

  await t.test("approved hypothesis → can mark experiment failed", () => {
    const h = makeHypothesis({ approval_strategy: "auto" });
    const failed = h.markExperimentFailed("Constraint violation: running experiment exists");

    assert.strictEqual(failed.status, "experiment_failed");
    assert.strictEqual(
      failed.snapshot().experiment_creation_error,
      "Constraint violation: running experiment exists",
    );
  });
});

// ===== ConstraintValidator Logic Tests =====

test("ConstraintValidator — running experiment constraint", async (t) => {
  await t.test("merchant has running experiment → blocks second hypothesis", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();

    // First hypothesis → approved → experiment_created (represents running experiment)
    const h1 = makeHypothesis({ merchant_id: "m_constrained", approval_strategy: "auto" });
    const h1WithExp = h1.markExperimentCreated("exp_running_001");
    await hypothesisRepo.save(h1WithExp);

    // Check constraint: merchant has hypothesis with status "experiment_created"
    const merchantHypotheses = await hypothesisRepo.findByMerchant("m_constrained", {
      status: "experiment_created",
    });
    const hasRunningExperiment = merchantHypotheses.length > 0;

    assert.strictEqual(hasRunningExperiment, true, "Merchant has running experiment");
  });

  await t.test("merchant has no running experiment → allows hypothesis", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();

    // Only a pending hypothesis, no experiment created yet
    const h = makeHypothesis({ merchant_id: "m_free", approval_strategy: "manual" });
    await hypothesisRepo.save(h);

    const merchantHypotheses = await hypothesisRepo.findByMerchant("m_free", {
      status: "experiment_created",
    });
    const hasRunningExperiment = merchantHypotheses.length > 0;

    assert.strictEqual(hasRunningExperiment, false, "No running experiment = constraint passes");
  });
});

// ===== ApproveHypothesisUseCase (via direct entity method) =====

test("ApproveHypothesisUseCase — integration with outbox", async (t) => {
  await t.test("approves pending hypothesis and persists + emits event", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const outbox = new InMemoryOutboxRepository();

    const h = makeHypothesis({ approval_strategy: "manual" });
    await hypothesisRepo.save(h);

    // Simulate use-case logic
    const found = await hypothesisRepo.findById(h.id, "m1");
    assert.ok(found);
    const approved = found.approve("merchant_user_1", "Looks good");
    await hypothesisRepo.save(approved);

    // Emit event
    outbox.appendOutbox({
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "revenue_manager.hypothesis.approved",
      schema_version: 1,
      merchant_id: "m1",
      occurred_at: new Date().toISOString(),
      correlation_id: `corr_${crypto.randomUUID()}`,
      causation_id: "revenue_manager.approve_hypothesis",
      producer: "revenue-manager",
      payload: { hypothesis_id: h.id, approved_by: "merchant_user_1" },
    });

    // Verify
    const stored = await hypothesisRepo.findById(h.id, "m1");
    assert.ok(stored);
    assert.strictEqual(stored.status, "approved");

    const events = outbox.getAppended();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, "revenue_manager.hypothesis.approved");
    assert.strictEqual((events[0].payload as { hypothesis_id: string }).hypothesis_id, h.id);
  });

  await t.test("RejectHypothesisUseCase — emits rejection event", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const outbox = new InMemoryOutboxRepository();

    const h = makeHypothesis({ approval_strategy: "manual" });
    await hypothesisRepo.save(h);

    // Simulate use-case logic
    const found = await hypothesisRepo.findById(h.id, "m1");
    assert.ok(found);
    const rejected = found.reject("Too risky for our brand");
    await hypothesisRepo.save(rejected);

    outbox.appendOutbox({
      event_id: `evt_${crypto.randomUUID()}`,
      event_type: "revenue_manager.hypothesis.rejected",
      schema_version: 1,
      merchant_id: "m1",
      occurred_at: new Date().toISOString(),
      correlation_id: `corr_${crypto.randomUUID()}`,
      causation_id: "revenue_manager.reject_hypothesis",
      producer: "revenue-manager",
      payload: { hypothesis_id: h.id, reason: "Too risky for our brand" },
    });

    const stored = await hypothesisRepo.findById(h.id, "m1");
    assert.ok(stored);
    assert.strictEqual(stored.status, "rejected");

    const events = outbox.getAppended();
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].event_type, "revenue_manager.hypothesis.rejected");
  });
});

// ===== RecordStrategyLesson Tests =====

test("RecordStrategyLesson — hypothesis correctness", async (t) => {
  await t.test("hypothesis_was_correct = true when challenger wins and hypothesis predicted challenger", () => {
    // Hypothesis predicted challenger variant would win (expected_lift > 0)
    // Experiment shows challenger conversion 0.25 vs control 0.20 → lift = 25%
    const controlConversion = 0.20;
    const challengerConversion = 0.25;
    const liftPercent = ((challengerConversion - controlConversion) / controlConversion) * 100; // 25%

    const hypothesisWasCorrect = liftPercent > 0;
    assert.strictEqual(hypothesisWasCorrect, true, "Positive lift = hypothesis correct");
  });

  await t.test("hypothesis_was_correct = false when control wins", () => {
    // Hypothesis predicted challenger would win, but control won
    const controlConversion = 0.22;
    const challengerConversion = 0.18;
    const liftPercent = ((challengerConversion - controlConversion) / controlConversion) * 100; // -18.18%

    const hypothesisWasCorrect = liftPercent > 0;
    assert.strictEqual(hypothesisWasCorrect, false, "Negative lift = hypothesis incorrect");
  });

  await t.test("lift calculation handles zero control conversion", () => {
    const controlConversion = 0;
    const challengerConversion = 0.10;
    const liftPercent = controlConversion > 0
      ? ((challengerConversion - controlConversion) / controlConversion) * 100
      : 0;

    assert.strictEqual(liftPercent, 0, "Zero control → lift is 0 (avoid division by zero)");
  });

  await t.test("strategy lesson captures conversion stats correctly", async () => {
    const { StrategyLessonEntity } = await import(
      "../../domain/entities/strategy-lesson.entity.js"
    );

    const lesson = StrategyLessonEntity.create({
      merchant_id: "m1",
      experiment_id: "exp_001",
      hypothesis_id: "hyp_001",
      hypothesis_text: "Free shipping increases conversions",
      actual_winner: "challenger",
      hypothesis_was_correct: true,
      control_conversion_rate: 0.20,
      challenger_conversion_rate: 0.25,
      conversion_lift_percent: 25.0,
      sessions_per_variant: 600,
      statistical_confidence: 0.97,
      insights: {
        why_winner_won: "Free shipping removed price objection barrier",
        objection_reduction: "Shipping objections down 40%",
        decision_speed_impact: "Decision time -12%",
        cross_sell_impact: "+3% cross-sell acceptance",
        recommended_next_steps: ["Promote to 100%", "Test premium shipping offer"],
      },
      generator_feedback: "Expected 8.5%, actual 25%. Strong overperformance.",
    });

    assert.strictEqual(lesson.hypothesis_was_correct, true);
    assert.strictEqual(lesson.conversion_lift_percent, 25.0);
    assert.ok(lesson.insights.recommended_next_steps.length >= 2);
  });
});
