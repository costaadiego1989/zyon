import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApproveHypothesisUseCase } from "../use-cases/approve-hypothesis.use-case.js";
import { RejectHypothesisUseCase } from "../use-cases/reject-hypothesis.use-case.js";
import { HypothesisEntity, type HypothesisSnapshot } from "../../domain/entities/hypothesis.entity.js";
import type { HypothesisRepositoryPort } from "../../domain/ports/hypothesis-repository.port.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";

function makeHypothesisRepo(overrides?: Partial<HypothesisRepositoryPort>): HypothesisRepositoryPort {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    findById: vi.fn().mockResolvedValue(null),
    findByMerchant: vi.fn().mockResolvedValue([]),
    findPendingByMerchant: vi.fn().mockResolvedValue([]),
    findByObservation: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeOutboxRepo(): OutboxRepository {
  return {
    appendOutbox: vi.fn().mockResolvedValue({}),
    listOutbox: vi.fn().mockResolvedValue([]),
    listPending: vi.fn().mockResolvedValue([]),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
    claimBatch: vi.fn().mockResolvedValue([]),
    recordFailure: vi.fn().mockResolvedValue({ attempts: 1, dead: false }),
    isProcessed: vi.fn().mockResolvedValue(false),
    isHandlerProcessed: vi.fn().mockResolvedValue(false),
    markHandlerProcessed: vi.fn().mockResolvedValue(undefined),
  };
}

function makePendingHypothesis(overrides?: Partial<HypothesisSnapshot>): HypothesisEntity {
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

describe("ApproveHypothesisUseCase", () => {
  let useCase: ApproveHypothesisUseCase;
  let hypothesisRepo: HypothesisRepositoryPort;
  let outboxRepo: OutboxRepository;

  beforeEach(() => {
    const hypothesis = makePendingHypothesis();
    hypothesisRepo = makeHypothesisRepo({
      findById: vi.fn().mockResolvedValue(hypothesis),
    });
    outboxRepo = makeOutboxRepo();
    useCase = new ApproveHypothesisUseCase(hypothesisRepo, outboxRepo);
  });

  it("approves a pending hypothesis", async () => {
    const result = await useCase.execute({
      hypothesis_id: "hyp1",
      merchant_id: "m1",
      approved_by: "merchant_user",
      approval_reason: "Good idea",
    });

    expect(result.status).toBe("approved");
    expect(result.approved_at).toBeDefined();
    expect(hypothesisRepo.save).toHaveBeenCalled();
    expect(outboxRepo.appendOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "revenue_manager.hypothesis.approved",
      }),
    );
  });

  it("throws HYPOTHESIS_NOT_FOUND if not found", async () => {
    hypothesisRepo.findById = vi.fn().mockResolvedValue(null);
    await expect(
      useCase.execute({
        hypothesis_id: "nonexistent",
        merchant_id: "m1",
        approved_by: "user",
      }),
    ).rejects.toThrow("HYPOTHESIS_NOT_FOUND");
  });

  it("throws HYPOTHESIS_NOT_PENDING_REVIEW if already approved", async () => {
    const approvedHypothesis = HypothesisEntity.create({
      merchant_id: "m1",
      observation_id: "obs1",
      hypothesis_text: "Test",
      reasoning: "Reason",
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
    hypothesisRepo.findById = vi.fn().mockResolvedValue(approvedHypothesis);

    await expect(
      useCase.execute({
        hypothesis_id: "hyp1",
        merchant_id: "m1",
        approved_by: "user",
      }),
    ).rejects.toThrow("HYPOTHESIS_NOT_PENDING_REVIEW");
  });
});

describe("RejectHypothesisUseCase", () => {
  let useCase: RejectHypothesisUseCase;
  let hypothesisRepo: HypothesisRepositoryPort;
  let outboxRepo: OutboxRepository;

  beforeEach(() => {
    const hypothesis = makePendingHypothesis();
    hypothesisRepo = makeHypothesisRepo({
      findById: vi.fn().mockResolvedValue(hypothesis),
    });
    outboxRepo = makeOutboxRepo();
    useCase = new RejectHypothesisUseCase(hypothesisRepo, outboxRepo);
  });

  it("rejects a pending hypothesis", async () => {
    const result = await useCase.execute({
      hypothesis_id: "hyp1",
      merchant_id: "m1",
      reason: "Too risky for our current budget",
    });

    expect(result.status).toBe("rejected");
    expect(result.rejection_reason).toBe("Too risky for our current budget");
    expect(hypothesisRepo.save).toHaveBeenCalled();
    expect(outboxRepo.appendOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: "revenue_manager.hypothesis.rejected",
      }),
    );
  });

  it("throws HYPOTHESIS_NOT_FOUND if not found", async () => {
    hypothesisRepo.findById = vi.fn().mockResolvedValue(null);
    await expect(
      useCase.execute({
        hypothesis_id: "nonexistent",
        merchant_id: "m1",
        reason: "Reason",
      }),
    ).rejects.toThrow("HYPOTHESIS_NOT_FOUND");
  });

  it("throws HYPOTHESIS_NOT_PENDING_REVIEW for already rejected hypothesis", async () => {
    const pendingHypothesis = makePendingHypothesis();
    const rejectedHypothesis = pendingHypothesis.reject("First rejection");
    hypothesisRepo.findById = vi.fn().mockResolvedValue(rejectedHypothesis);

    await expect(
      useCase.execute({
        hypothesis_id: "hyp1",
        merchant_id: "m1",
        reason: "Second rejection",
      }),
    ).rejects.toThrow("HYPOTHESIS_NOT_PENDING_REVIEW");
  });
});
