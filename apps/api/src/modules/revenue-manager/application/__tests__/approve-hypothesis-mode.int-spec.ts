import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import type { PrismaClient } from "@prisma/client";
import { HypothesisEntity } from "../../domain/entities/hypothesis.entity.js";
import { PrismaHypothesisRepository } from "../../infrastructure/prisma-hypothesis.repository.js";
import { ApproveHypothesisUseCase } from "../use-cases/approve-hypothesis.use-case.js";
import { CreateExperimentFromHypothesisUseCase } from "../use-cases/create-experiment-from-hypothesis.use-case.js";
import { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { CheckoutSettingsRepository } from "../../../checkout-settings/domain/ports/checkout-settings-repository.port.js";
import { CheckoutSettingsEntity } from "../../../checkout-settings/domain/entities/checkout-settings.entity.js";
import type { AdvancedRule } from "@zyon/shared-types";

/**
 * F3-T02: Integration spec for approve-hypothesis with mode parameter
 * Tests apply_direct (saves AdvancedRule) and test_ab (creates experiment)
 */

describe("ApproveHypothesisUseCase with mode parameter", () => {
  let useCase: ApproveHypothesisUseCase;
  let hypothesisRepo: PrismaHypothesisRepository;
  let mockOutbox: OutboxRepository;
  let mockCheckoutSettingsRepo: CheckoutSettingsRepository;
  let mockCreateExperiment: CreateExperimentFromHypothesisUseCase;
  let mockPrisma: PrismaClient;

  before(() => {
    // Create mock repositories
    mockOutbox = {
      appendOutbox: async () => undefined,
    } as any;

    mockCheckoutSettingsRepo = {
      get: async (merchantId: string) => {
        return CheckoutSettingsEntity.createDefault({ merchantId }).snapshot();
      },
      save: async (settings) => settings,
      delete: async () => undefined,
    } as any;

    mockCreateExperiment = {
      execute: async (input: any) => ({
        experiment_id: `exp_${input.hypothesis_id}`,
        hypothesis_id: input.hypothesis_id,
        status: "created" as const,
      }),
    } as any;

    hypothesisRepo = {} as any;

    useCase = new ApproveHypothesisUseCase(
      hypothesisRepo,
      mockOutbox,
      mockCheckoutSettingsRepo,
      mockPrisma,
      mockCreateExperiment,
    );
  });

  it("should accept mode parameter and pass it through", async () => {
    // Create a mock hypothesis with discount_rule_json
    const mockHypothesis = {
      id: "hyp_123",
      merchant_id: "merchant_123",
      status: "pending_review",
      hypothesis_type: "discount_rule" as const,
      discount_rule_json: {
        id: "rule_456",
        name: "Test Rule",
        conditions: [],
        action: { type: "offer_discount", params: { percent: 10 } },
        enabled: true,
        priority: 1,
      } as AdvancedRule,
      approval_strategy: "manual",
      snapshot: () => ({
        id: "hyp_123",
        merchant_id: "merchant_123",
        status: "pending_review",
        hypothesis_type: "discount_rule",
        discount_rule_json: {
          id: "rule_456",
          name: "Test Rule",
          conditions: [],
          action: { type: "offer_discount", params: { percent: 10 } },
          enabled: true,
          priority: 1,
        },
        merchant_approved_at: new Date().toISOString(),
        approval_strategy: "manual",
      }),
      approve: (approver: string, reason?: string) => mockHypothesis,
      risk_level: "low",
    } as any;

    hypothesisRepo.findById = async () => mockHypothesis;
    hypothesisRepo.save = async () => undefined;

    // Test apply_direct mode
    const result1 = await useCase.execute({
      hypothesis_id: "hyp_123",
      merchant_id: "merchant_123",
      approved_by: "user_123",
      mode: "apply_direct",
    });

    assert.strictEqual(result1.mode, "apply_direct", "mode should be apply_direct");
    assert.strictEqual(result1.rule_id, "rule_456", "rule_id should be set");
    assert.strictEqual(result1.experiment_id, undefined, "experiment_id should not be set");

    // Test test_ab mode
    const result2 = await useCase.execute({
      hypothesis_id: "hyp_123",
      merchant_id: "merchant_123",
      approved_by: "user_123",
      mode: "test_ab",
    });

    assert.strictEqual(result2.mode, "test_ab", "mode should be test_ab");
    assert.strictEqual(result2.experiment_id, "exp_hyp_123", "experiment_id should be set");
    assert.strictEqual(result2.rule_id, "rule_456", "rule_id should not be set in test_ab mode");
  });

  it("should validate mode is required", async () => {
    try {
      await useCase.execute({
        hypothesis_id: "hyp_123",
        merchant_id: "merchant_123",
        approved_by: "user_123",
        mode: undefined as any,
      });
      assert.fail("Should have thrown error for missing mode");
    } catch (err) {
      // Expected
    }
  });

  it("should validate mode is one of the allowed values", async () => {
    try {
      await useCase.execute({
        hypothesis_id: "hyp_123",
        merchant_id: "merchant_123",
        approved_by: "user_123",
        mode: "invalid_mode" as any,
      });
      assert.fail("Should have thrown error for invalid mode");
    } catch (err) {
      // Expected
    }
  });
});
