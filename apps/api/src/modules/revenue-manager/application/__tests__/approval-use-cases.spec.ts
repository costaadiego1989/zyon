import test from "node:test";
import assert from "node:assert/strict";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import type { HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";

function makeHypothesisRepo(overrides?: Partial<HypothesisRepositoryPort>): HypothesisRepositoryPort {
  return {
    save: async () => {},
    findById: async () => null,
    findByMerchant: async () => [],
    findPendingByMerchant: async () => [],
    findByObservation: async () => [],
    ...overrides,
  };
}

function makeOutboxRepo(): OutboxRepository {
  const calls: unknown[] = [];
  return {
    appendOutbox: async (e) => { calls.push(e); return e; },
    listOutbox: async () => [],
    listPending: async () => [],
    markDelivered: async () => {},
    markFailed: async () => {},
    claimBatch: async () => [],
    recordFailure: async () => ({ attempts: 1, dead: false }),
    isProcessed: async () => false,
    isHandlerProcessed: async () => false,
    markHandlerProcessed: async () => {},
    _calls: calls,
  } as OutboxRepository & { _calls: unknown[] };
}

function makePendingHypothesis(): HypothesisEntity {
  return HypothesisEntity.create({
    merchant_id: "m1",
    observation_id: "obs1",
    hypothesis_text: "Test hypothesis",
    reasoning: "Because data shows X",
    expected_lift_percent: 10,
    risk_level: "medium",
    template: {
      name: "Test",
      description: "Desc",
      variant_a: { name: "Control", system_prompt: "Control prompt", weight: 50, is_control: true },
      variant_b: { name: "Challenger", system_prompt: "Challenger prompt", weight: 50, is_control: false },
    },
    approval_strategy: "manual",
  });
}

test("ApproveHypothesisUseCase", async (t) => {
  await t.test("approves a pending hypothesis", async () => {
    const hypothesis = makePendingHypothesis();
    let savedEntity: HypothesisEntity | undefined = undefined;
    const repo = makeHypothesisRepo({
      findById: async () => hypothesis,
      save: async (h) => { savedEntity = h; },
    });
    const outbox = makeOutboxRepo();

    // Import inline (avoids NestJS DI)
    const { ApproveHypothesisUseCase } = await import("../use-cases/approve-hypothesis.use-case.js");
    const useCase = Object.create(ApproveHypothesisUseCase.prototype);
    (useCase as { hypothesisRepo: HypothesisRepositoryPort }).hypothesisRepo = repo;
    (useCase as { outbox: OutboxRepository }).outbox = outbox;
    (useCase as { logger: { log: () => void } }).logger = { log: () => {} };

    const result = await useCase.execute({
      hypothesis_id: hypothesis.id,
      merchant_id: "m1",
      approved_by: "merchant_user",
      approval_reason: "Good idea",
    });

    assert.strictEqual(result.status, "approved");
    assert.ok(result.approved_at);
    assert.ok(savedEntity);
    assert.strictEqual((savedEntity as HypothesisEntity).status, "approved");
  });

  await t.test("throws HYPOTHESIS_NOT_FOUND if not found", async () => {
    const repo = makeHypothesisRepo({ findById: async () => null });
    const outbox = makeOutboxRepo();

    const { ApproveHypothesisUseCase } = await import("../use-cases/approve-hypothesis.use-case.js");
    const useCase = Object.create(ApproveHypothesisUseCase.prototype);
    (useCase as { hypothesisRepo: HypothesisRepositoryPort }).hypothesisRepo = repo;
    (useCase as { outbox: OutboxRepository }).outbox = outbox;
    (useCase as { logger: { log: () => void } }).logger = { log: () => {} };

    await assert.rejects(
      () => useCase.execute({ hypothesis_id: "x", merchant_id: "m1", approved_by: "u" }),
      /HYPOTHESIS_NOT_FOUND/,
    );
  });

  await t.test("throws HYPOTHESIS_NOT_PENDING_REVIEW if already approved", async () => {
    const approvedHypothesis = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "R",
      expected_lift_percent: 5,
      risk_level: "low",
      template: {
        name: "T",
        description: "D",
        variant_a: { name: "A", system_prompt: "A", weight: 50, is_control: true },
        variant_b: { name: "B", system_prompt: "B", weight: 50, is_control: false },
      },
      approval_strategy: "auto", // auto = already approved
    });

    const repo = makeHypothesisRepo({ findById: async () => approvedHypothesis });
    const outbox = makeOutboxRepo();

    const { ApproveHypothesisUseCase } = await import("../use-cases/approve-hypothesis.use-case.js");
    const useCase = Object.create(ApproveHypothesisUseCase.prototype);
    (useCase as { hypothesisRepo: HypothesisRepositoryPort }).hypothesisRepo = repo;
    (useCase as { outbox: OutboxRepository }).outbox = outbox;
    (useCase as { logger: { log: () => void } }).logger = { log: () => {} };

    await assert.rejects(
      () => useCase.execute({ hypothesis_id: "x", merchant_id: "m1", approved_by: "u" }),
      /HYPOTHESIS_NOT_PENDING_REVIEW/,
    );
  });
});

test("RejectHypothesisUseCase", async (t) => {
  await t.test("rejects a pending hypothesis", async () => {
    const hypothesis = makePendingHypothesis();
    let savedEntity: HypothesisEntity | undefined = undefined;
    const repo = makeHypothesisRepo({
      findById: async () => hypothesis,
      save: async (h) => { savedEntity = h; },
    });
    const outbox = makeOutboxRepo();

    const { RejectHypothesisUseCase } = await import("../use-cases/reject-hypothesis.use-case.js");
    const useCase = Object.create(RejectHypothesisUseCase.prototype);
    (useCase as { hypothesisRepo: HypothesisRepositoryPort }).hypothesisRepo = repo;
    (useCase as { outbox: OutboxRepository }).outbox = outbox;
    (useCase as { logger: { log: () => void } }).logger = { log: () => {} };

    const result = await useCase.execute({
      hypothesis_id: hypothesis.id,
      merchant_id: "m1",
      reason: "Too risky",
    });

    assert.strictEqual(result.status, "rejected");
    assert.strictEqual(result.rejection_reason, "Too risky");
    assert.ok(savedEntity);
    assert.strictEqual((savedEntity as HypothesisEntity).status, "rejected");
  });
});
