import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { ObservationEntity } from "../../domain/entities/observation.entity.js";
import { ApproveHypothesisUseCase } from "../use-cases/approve-hypothesis.use-case.js";
import { RejectHypothesisUseCase } from "../use-cases/reject-hypothesis.use-case.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import type { StrategyLessonRepositoryPort } from "../../domain/ports/strategy-lesson-repository.port.js";
import type { ObservationRepositoryPort } from "../../domain/ports/observation-repository.port.js";

/** In-memory test doubles for repositories */
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
    options?: { status?: string; limit?: number }
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

  getAll(): HypothesisEntity[] {
    return Array.from(this.hypotheses.values());
  }
}

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
      .sort((a, b) => new Date(b.snapshot().created_at).getTime() - new Date(a.snapshot().created_at).getTime());
    return all[0] || null;
  }

  async findByMerchant(merchantId: string, limit?: number): Promise<ObservationEntity[]> {
    return Array.from(this.observations.values())
      .filter((o) => o.merchant_id === merchantId)
      .slice(0, limit);
  }
}

class InMemoryStrategyLessonRepository implements StrategyLessonRepositoryPort {
  private lessons = new Map<string, any>();

  async save(lesson: any): Promise<void> {
    this.lessons.set(lesson.id, lesson);
  }

  async findByMerchant(merchantId: string, limit?: number): Promise<any[]> {
    return Array.from(this.lessons.values())
      .filter((l) => l.merchant_id === merchantId)
      .slice(0, limit);
  }

  async findByExperiment(experimentId: string): Promise<any[]> {
    return Array.from(this.lessons.values()).filter((l) => l.experiment_id === experimentId);
  }

  async findByHypothesis(hypothesisId: string): Promise<any | null> {
    const all = Array.from(this.lessons.values()).filter((l) => l.hypothesis_id === hypothesisId);
    return all[0] || null;
  }
}

test("ApproveHypothesisUseCase", async (t) => {
  await t.test("approves pending hypothesis and emits event", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const outbox = new InMemoryOutboxRepository();
    const useCase = new ApproveHypothesisUseCase(hypothesisRepo, outbox);

    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test hypothesis",
      reasoning: "Some reason",
      expected_lift_percent: 12,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "With change", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });
    await hypothesisRepo.save(h);

    const result = await useCase.execute({
      hypothesis_id: h.id,
      merchant_id: "m1",
      approved_by: "user123",
      approval_reason: "Looks good",
    });

    assert.strictEqual(result.status, "approved");
    assert.ok(result.approved_at);
    assert.strictEqual(result.hypothesis_id, h.id);

    // Verify outbox event
    const pending = outbox.listPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].event_type, "revenue_manager.hypothesis.approved");
  });

  await t.test("throws if hypothesis not found", async () => {
    const useCase = new ApproveHypothesisUseCase(new InMemoryHypothesisRepository(), new InMemoryOutboxRepository());

    try {
      await useCase.execute({
        hypothesis_id: "nonexistent",
        merchant_id: "m1",
        approved_by: "user123",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(String(error), /HYPOTHESIS_NOT_FOUND/);
    }
  });

  await t.test("throws if hypothesis not pending_review", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // auto → created as approved
    });
    await hypothesisRepo.save(h);

    const useCase = new ApproveHypothesisUseCase(hypothesisRepo, new InMemoryOutboxRepository());

    try {
      await useCase.execute({
        hypothesis_id: h.id,
        merchant_id: "m1",
        approved_by: "user123",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(String(error), /HYPOTHESIS_NOT_PENDING_REVIEW/);
    }
  });

  await t.test("persists approval reason", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 15,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });
    await hypothesisRepo.save(h);

    const useCase = new ApproveHypothesisUseCase(hypothesisRepo, new InMemoryOutboxRepository());

    await useCase.execute({
      hypothesis_id: h.id,
      merchant_id: "m1",
      approved_by: "user456",
      approval_reason: "Custom approval reason",
    });

    const updated = await hypothesisRepo.findById(h.id, "m1");
    assert.ok(updated);
    assert.strictEqual(updated.snapshot().merchant_approval_reason, "Custom approval reason");
    assert.strictEqual(updated.snapshot().merchant_approved_by, "user456");
  });
});

test("RejectHypothesisUseCase", async (t) => {
  await t.test("rejects pending hypothesis and emits event", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const outbox = new InMemoryOutboxRepository();
    const useCase = new RejectHypothesisUseCase(hypothesisRepo, outbox);

    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 20,
      risk_level: "high",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });
    await hypothesisRepo.save(h);

    const result = await useCase.execute({
      hypothesis_id: h.id,
      merchant_id: "m1",
      reason: "Too aggressive for our market",
    });

    assert.strictEqual(result.status, "rejected");
    assert.strictEqual(result.rejection_reason, "Too aggressive for our market");

    const pending = outbox.listPending();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].event_type, "revenue_manager.hypothesis.rejected");
  });

  await t.test("throws if hypothesis not found", async () => {
    const useCase = new RejectHypothesisUseCase(new InMemoryHypothesisRepository(), new InMemoryOutboxRepository());

    try {
      await useCase.execute({
        hypothesis_id: "nonexistent",
        merchant_id: "m1",
        reason: "Some reason",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(String(error), /HYPOTHESIS_NOT_FOUND/);
    }
  });

  await t.test("throws if already rejected", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 15,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });
    await hypothesisRepo.save(h);

    const useCase = new RejectHypothesisUseCase(hypothesisRepo, new InMemoryOutboxRepository());

    // First rejection
    await useCase.execute({
      hypothesis_id: h.id,
      merchant_id: "m1",
      reason: "First rejection",
    });

    // Second rejection should fail
    try {
      await useCase.execute({
        hypothesis_id: h.id,
        merchant_id: "m1",
        reason: "Second rejection",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(String(error), /HYPOTHESIS_NOT_PENDING_REVIEW/);
    }
  });

  await t.test("throws if already approved", async () => {
    const hypothesisRepo = new InMemoryHypothesisRepository();
    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // auto → approved
    });
    await hypothesisRepo.save(h);

    const useCase = new RejectHypothesisUseCase(hypothesisRepo, new InMemoryOutboxRepository());

    try {
      await useCase.execute({
        hypothesis_id: h.id,
        merchant_id: "m1",
        reason: "Cannot reject already-approved",
      });
      assert.fail("Should have thrown");
    } catch (error) {
      assert.match(String(error), /HYPOTHESIS_NOT_PENDING_REVIEW/);
    }
  });
});

test("Repository test doubles", async (t) => {
  await t.test("InMemoryHypothesisRepository saves and retrieves", async () => {
    const repo = new InMemoryHypothesisRepository();
    const h = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
      expected_lift_percent: 10,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No change", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Change", weight: 50, is_control: false },
      },
      approval_strategy: "manual",
    });

    await repo.save(h);
    const found = await repo.findById(h.id, "m1");
    assert.ok(found);
    assert.strictEqual(found.id, h.id);
  });

  await t.test("InMemoryHypothesisRepository filters by status", async () => {
    const repo = new InMemoryHypothesisRepository();
    const h1 = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Manual",
      reasoning: "Reason",
      expected_lift_percent: 15,
      risk_level: "medium",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Yes", weight: 50, is_control: false },
      },
      approval_strategy: "manual", // pending_review
    });
    const h2 = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs2",
      hypothesis_text: "Auto",
      reasoning: "Reason",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "Test",
        description: "Test",
        variant_a: { name: "Control", system_prompt: "No", weight: 50, is_control: true },
        variant_b: { name: "Variant", system_prompt: "Yes", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // approved
    });

    await repo.save(h1);
    await repo.save(h2);

    const pending = await repo.findByMerchant("m1", { status: "pending_review" });
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].id, h1.id);

    const approved = await repo.findByMerchant("m1", { status: "approved" });
    assert.strictEqual(approved.length, 1);
    assert.strictEqual(approved[0].id, h2.id);
  });

  await t.test("InMemoryObservationRepository fingerprint dedup", async () => {
    const repo = new InMemoryObservationRepository();
    const metrics = {
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
        top_abandonment_objection: "shipping_cost" as const,
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
        top_suggested_skus: [],
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

    const obs1 = ObservationEntity.create(metrics);
    const obs2 = ObservationEntity.create(metrics);

    await repo.save(obs1);
    const existing = await repo.findByFingerprint(obs1.fingerprint);
    assert.ok(existing);
    assert.strictEqual(existing.id, obs1.id);

    // Same fingerprint, should find same observation
    const sameFingerprint = await repo.findByFingerprint(obs2.fingerprint);
    assert.ok(sameFingerprint);
    assert.strictEqual(sameFingerprint.fingerprint, obs1.fingerprint);
  });
});
