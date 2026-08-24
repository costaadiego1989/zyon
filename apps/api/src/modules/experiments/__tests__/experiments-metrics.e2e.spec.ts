import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { CreateExperimentUseCase } from "../application/use-cases/create-experiment.use-case.js";
import { StartExperimentUseCase } from "../application/use-cases/start-experiment.use-case.js";
import { AssignVariantToSessionUseCase } from "../application/use-cases/assign-variant-to-session.use-case.js";
import { GetExperimentResultsUseCase } from "../application/use-cases/get-experiment-results.use-case.js";
import { RecordFunnelEventUseCase } from "../application/use-cases/record-funnel-event.use-case.js";
import { RecordExperimentResultUseCase } from "../application/use-cases/record-experiment-result.use-case.js";
import { SignificanceCalculator } from "../domain/services/significance-calculator.service.js";
import type { PromptExperimentSnapshot } from "../domain/entities/prompt-experiment.entity.js";
import { PromptExperimentEntity } from "../domain/entities/prompt-experiment.entity.js";
import type { ExperimentRepositoryPort } from "../domain/ports/experiment-repository.port.js";
import type { OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port.js";

// ============================================================================
// In-Memory Repositories for Testing
// ============================================================================

class InMemoryExperimentRepository implements ExperimentRepositoryPort {
  private experiments: Map<string, PromptExperimentSnapshot> = new Map();

  async save(experiment: PromptExperimentEntity): Promise<void> {
    this.experiments.set(`${experiment.merchant_id}/${experiment.id}`, experiment.snapshot());
  }

  async findById(id: string, merchantId: string): Promise<PromptExperimentEntity | null> {
    const snapshot = this.experiments.get(`${merchantId}/${id}`);
    return snapshot ? PromptExperimentEntity.rehydrate(snapshot) : null;
  }

  async findByMerchant(merchantId: string): Promise<PromptExperimentEntity[]> {
    return Array.from(this.experiments.values())
      .filter((s) => s.merchant_id === merchantId)
      .map((s) => PromptExperimentEntity.rehydrate(s));
  }

  async findRunning(merchantId: string): Promise<PromptExperimentEntity | null> {
    const candidates = Array.from(this.experiments.values()).filter(
      (s) => s.merchant_id === merchantId && s.status === "running",
    );
    if (candidates.length === 0) return null;
    return PromptExperimentEntity.rehydrate(candidates[0]);
  }

  async delete(id: string, merchantId: string): Promise<void> {
    this.experiments.delete(`${merchantId}/${id}`);
  }
}

class InMemoryOutboxRepository implements OutboxRepository {
  private outbox: any[] = [];

  async appendOutbox(event: any): Promise<any> {
    this.outbox.push(event);
    return event;
  }

  listOutbox(_merchantId: string): any[] {
    return this.outbox;
  }

  listPending(_batchSize?: number): any[] {
    return [];
  }

  async markDelivered(_eventId: string): Promise<void> {}
  async markFailed(_eventId: string, _error?: string): Promise<void> {}

  claimBatch(_batchSize?: number): any[] {
    return [];
  }

  recordFailure(_eventId: string, _error: string, _backoff: any): { attempts: number; dead: boolean } {
    return { attempts: 1, dead: false };
  }

  isProcessed(_eventId: string): boolean {
    return false;
  }

  isHandlerProcessed(_eventId: string, _handlerId: string): boolean {
    return false;
  }

  markHandlerProcessed(_eventId: string, _handlerId: string): void {}

  async clear(): Promise<void> {
    this.outbox = [];
  }
}

// ============================================================================
// Mock Prisma Client for Funnel Tracking
// ============================================================================

interface MockPromptVariantResult {
  id: string;
  variantId: string;
  sessionId: string;
  converted: boolean;
  revenue: number | null;
  offersShown: number;
  offersAccepted: number;
  durationSeconds: number | null;
  conversationStarted: boolean;
  cartViewed: boolean;
  cartItemsAdded: number;
  checkoutStarted: boolean;
  checkoutCompleted: boolean;
  timeToCart: number | null;
  timeToCheckout: number | null;
  timeToConversion: number | null;
  createdAt: Date;
  updatedAt?: Date;
}

interface MockCheckoutSession {
  id: string;
  merchantId: string;
  sessionId: string;
  globalUserId: string;
  conversationId: string;
  cart: Record<string, unknown>;
  customer: Record<string, unknown> | null;
  shipping: Record<string, unknown> | null;
  shippingOptions: Record<string, unknown> | null;
  abandonmentScore: number;
  triggerAgent: boolean;
  chatHistory: unknown[];
  promptVariantId: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

class MockPrismaClient {
  private checkoutSessions: Map<string, MockCheckoutSession> = new Map();
  private promptVariantResults: Map<string, MockPromptVariantResult> = new Map();

  get checkoutSession() {
    return {
      findFirst: async (opts: any) => {
        const where = opts.where || {};
        for (const session of this.checkoutSessions.values()) {
          if (where.merchantId && where.merchantId !== session.merchantId) continue;
          if (where.sessionId && where.sessionId !== session.sessionId) continue;
          return session;
        }
        return null;
      },
    };
  }

  get promptVariantResult() {
    return {
      upsert: async (opts: any) => {
        const key = `${opts.where.variantId_sessionId.variantId}/${opts.where.variantId_sessionId.sessionId}`;
        const existing = this.promptVariantResults.get(key);

        if (existing) {
          // Update path
          const updates = opts.update || {};
          const updated: MockPromptVariantResult = { ...existing };

          if (updates.conversationStarted !== undefined) updated.conversationStarted = updates.conversationStarted;
          if (updates.cartViewed !== undefined) updated.cartViewed = updates.cartViewed;
          if (updates.cartItemsAdded !== undefined) {
            if (typeof updates.cartItemsAdded === "object" && updates.cartItemsAdded.increment) {
              updated.cartItemsAdded += updates.cartItemsAdded.increment;
            } else {
              updated.cartItemsAdded = updates.cartItemsAdded;
            }
          }
          if (updates.checkoutStarted !== undefined) updated.checkoutStarted = updates.checkoutStarted;
          if (updates.checkoutCompleted !== undefined) updated.checkoutCompleted = updates.checkoutCompleted;
          if (updates.converted !== undefined) updated.converted = updates.converted;
          if (updates.revenue !== undefined) updated.revenue = updates.revenue;
          if (updates.offersShown !== undefined) updated.offersShown = updates.offersShown;
          if (updates.offersAccepted !== undefined) updated.offersAccepted = updates.offersAccepted;
          if (updates.durationSeconds !== undefined) updated.durationSeconds = updates.durationSeconds;
          if (updates.timeToCart !== undefined) updated.timeToCart = updates.timeToCart;
          if (updates.timeToCheckout !== undefined) updated.timeToCheckout = updates.timeToCheckout;
          if (updates.timeToConversion !== undefined) updated.timeToConversion = updates.timeToConversion;
          updated.updatedAt = new Date();

          this.promptVariantResults.set(key, updated);
          return updated;
        } else {
          // Create path
          const created: MockPromptVariantResult = {
            id: `pvr_${Math.random().toString(36).substring(7)}`,
            variantId: opts.where.variantId_sessionId.variantId,
            sessionId: opts.where.variantId_sessionId.sessionId,
            converted: opts.create.converted ?? false,
            revenue: opts.create.revenue ?? null,
            offersShown: opts.create.offersShown ?? 0,
            offersAccepted: opts.create.offersAccepted ?? 0,
            durationSeconds: opts.create.durationSeconds ?? null,
            conversationStarted: opts.create.conversationStarted ?? true,
            cartViewed: opts.create.cartViewed ?? false,
            cartItemsAdded: opts.create.cartItemsAdded ?? 0,
            checkoutStarted: opts.create.checkoutStarted ?? false,
            checkoutCompleted: opts.create.checkoutCompleted ?? false,
            timeToCart: opts.create.timeToCart ?? null,
            timeToCheckout: opts.create.timeToCheckout ?? null,
            timeToConversion: opts.create.timeToConversion ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          this.promptVariantResults.set(key, created);
          return created;
        }
      },

      findMany: async (opts: any) => {
        const where = opts.where || {};
        const variantIds = where.variantId?.in || [];

        if (variantIds.length === 0) {
          return Array.from(this.promptVariantResults.values());
        }

        return Array.from(this.promptVariantResults.values()).filter((r) =>
          variantIds.includes(r.variantId)
        );
      },

      findUnique: async (opts: any) => {
        const key = `${opts.where.variantId_sessionId.variantId}/${opts.where.variantId_sessionId.sessionId}`;
        return this.promptVariantResults.get(key) || null;
      },
    };
  }

  // Test helper methods
  registerCheckoutSession(session: MockCheckoutSession): void {
    const key = `${session.merchantId}/${session.sessionId}`;
    this.checkoutSessions.set(key, session);
  }

  getPromptVariantResult(variantId: string, sessionId: string): MockPromptVariantResult | null {
    const key = `${variantId}/${sessionId}`;
    return this.promptVariantResults.get(key) || null;
  }

  getAllFunnelResults(): MockPromptVariantResult[] {
    return Array.from(this.promptVariantResults.values());
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

function createMockCheckoutSession(overrides?: {
  merchantId?: string;
  sessionId?: string;
  globalUserId?: string;
  promptVariantId?: string;
}): MockCheckoutSession {
  return {
    id: `sess_${Math.random().toString(36).substring(7)}`,
    merchantId: overrides?.merchantId ?? "mrc_metrics_test",
    sessionId: overrides?.sessionId ?? `session_${Math.random().toString(36).substring(7)}`,
    globalUserId: overrides?.globalUserId ?? "user_global_123",
    conversationId: `conv_${Math.random().toString(36).substring(7)}`,
    cart: { items: [] },
    customer: null,
    shipping: null,
    shippingOptions: null,
    abandonmentScore: 0,
    triggerAgent: true,
    chatHistory: [],
    promptVariantId: overrides?.promptVariantId ?? null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ============================================================================
// Tests
// ============================================================================

test("METRICS-001: Record 10 sessions per variant → verify conversion_rate (30% vs 50%)", async () => {
  const experimentRepo = new InMemoryExperimentRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const prisma = new MockPrismaClient();

  const createUseCase = new CreateExperimentUseCase(experimentRepo, outboxRepo);
  const startUseCase = new StartExperimentUseCase(experimentRepo, outboxRepo);
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);
  const recordResultUseCase = new RecordExperimentResultUseCase(prisma as any);
  const getResultsUseCase = new GetExperimentResultsUseCase(experimentRepo, prisma as any);

  const merchantId = "mrc_metrics_001";

  // Step 1: Create experiment with 2 variants (control + treatment)
  const createResult = await createUseCase.execute({
    merchant_id: merchantId,
    name: "Metrics Test 001",
    variants: [
      { name: "control", system_prompt: "Control prompt", weight: 50, is_control: true },
      { name: "treatment", system_prompt: "Treatment prompt", weight: 50, is_control: false },
    ],
  });
  assert.ok(createResult.experiment_id);

  // Step 2: Start experiment
  await startUseCase.execute({
    merchant_id: merchantId,
    experiment_id: createResult.experiment_id,
  });

  // Get variant IDs from the experiment
  const experiment = await experimentRepo.findById(createResult.experiment_id, merchantId);
  assert.ok(experiment);
  const controlVariant = experiment.variants.find((v) => v.name === "control");
  const treatmentVariant = experiment.variants.find((v) => v.name === "treatment");
  assert.ok(controlVariant);
  assert.ok(treatmentVariant);

  // Step 3: Record 10 sessions for CONTROL variant (3 converted)
  for (let i = 0; i < 10; i++) {
    const sessionId = `session_control_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: controlVariant.id,
    });
    prisma.registerCheckoutSession(session);

    // All sessions reach cart
    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    // 3 out of 10 convert
    if (i < 3) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Step 4: Record 10 sessions for TREATMENT variant (5 converted)
  for (let i = 0; i < 10; i++) {
    const sessionId = `session_treatment_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: treatmentVariant.id,
    });
    prisma.registerCheckoutSession(session);

    // All sessions reach cart
    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    // 5 out of 10 convert
    if (i < 5) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Step 5: Get results and verify metrics
  const results = await getResultsUseCase.execute(createResult.experiment_id, merchantId);
  assert.ok(results);
  assert.equal(results.variants.length, 2);

  // Find control and treatment metrics
  const controlMetrics = results.variants.find((v) => v.variant_name === "control");
  const treatmentMetrics = results.variants.find((v) => v.variant_name === "treatment");

  assert.ok(controlMetrics);
  assert.ok(treatmentMetrics);

  // Verify control metrics: 10 sessions, 3 converted, 30% conversion rate
  assert.equal(controlMetrics.sample_size, 10, "Control should have 10 sessions");
  assert.equal(controlMetrics.conversions, 3, "Control should have 3 conversions");
  assert.equal(controlMetrics.conversion_rate, 30, "Control conversion_rate should be 30%");

  // Verify treatment metrics: 10 sessions, 5 converted, 50% conversion rate
  assert.equal(treatmentMetrics.sample_size, 10, "Treatment should have 10 sessions");
  assert.equal(treatmentMetrics.conversions, 5, "Treatment should have 5 conversions");
  assert.equal(treatmentMetrics.conversion_rate, 50, "Treatment conversion_rate should be 50%");
});

test("METRICS-002: Verify confidence is calculated (> 0% with enough data)", async () => {
  const experimentRepo = new InMemoryExperimentRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const prisma = new MockPrismaClient();

  const createUseCase = new CreateExperimentUseCase(experimentRepo, outboxRepo);
  const startUseCase = new StartExperimentUseCase(experimentRepo, outboxRepo);
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);
  const recordResultUseCase = new RecordExperimentResultUseCase(prisma as any);
  const getResultsUseCase = new GetExperimentResultsUseCase(experimentRepo, prisma as any);

  const merchantId = "mrc_metrics_002";

  // Step 1: Create experiment
  const createResult = await createUseCase.execute({
    merchant_id: merchantId,
    name: "Metrics Test 002 - Significance",
    variants: [
      { name: "control", system_prompt: "Control prompt", weight: 50, is_control: true },
      { name: "treatment", system_prompt: "Treatment prompt", weight: 50, is_control: false },
    ],
  });

  // Step 2: Start experiment
  await startUseCase.execute({
    merchant_id: merchantId,
    experiment_id: createResult.experiment_id,
  });

  const experiment = await experimentRepo.findById(createResult.experiment_id, merchantId);
  assert.ok(experiment);
  const controlVariant = experiment.variants.find((v) => v.name === "control");
  const treatmentVariant = experiment.variants.find((v) => v.name === "treatment");
  assert.ok(controlVariant);
  assert.ok(treatmentVariant);

  // Step 3: Record 100 sessions per variant with strong difference
  // Control: 100 sessions, 20 converted (20% conversion)
  for (let i = 0; i < 100; i++) {
    const sessionId = `session_ctrl_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: controlVariant.id,
    });
    prisma.registerCheckoutSession(session);

    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    if (i < 20) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Treatment: 100 sessions, 40 converted (40% conversion)
  for (let i = 0; i < 100; i++) {
    const sessionId = `session_treat_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: treatmentVariant.id,
    });
    prisma.registerCheckoutSession(session);

    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    if (i < 40) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Step 4: Calculate confidence manually
  const results = await getResultsUseCase.execute(createResult.experiment_id, merchantId);
  assert.ok(results);

  const calculator = new SignificanceCalculator();
  const variantStats = results.variants.map((v) => ({
    variantId: v.variant_id,
    name: v.variant_name,
    sessions: v.sample_size,
    converted: v.conversions,
  }));

  const significance = calculator.calculateConfidence(variantStats);

  // With 20 vs 40 conversions out of 100 sessions each, we should have:
  // p1=0.2, p2=0.4, n1=n2=100
  // p_pooled = 0.3, se ≈ 0.0645
  // z ≈ 3.1, CDF(3.1) ≈ 0.999
  // Expected: confidence > 0.99
  assert.ok(significance.confidence > 0, "Confidence should be > 0%");
  assert.ok(significance.confidence > 0.95, "Confidence should be > 95% with this data");
  assert.equal(significance.isSignificant, true, "Should be statistically significant");
  assert.equal(significance.winnerId, treatmentVariant.id, "Treatment should win (40% > 20%)");
});

test("METRICS-003: Equal conversions → no winner declared (confidence ≈ 50%)", async () => {
  const experimentRepo = new InMemoryExperimentRepository();
  const outboxRepo = new InMemoryOutboxRepository();
  const prisma = new MockPrismaClient();

  const createUseCase = new CreateExperimentUseCase(experimentRepo, outboxRepo);
  const startUseCase = new StartExperimentUseCase(experimentRepo, outboxRepo);
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);
  const recordResultUseCase = new RecordExperimentResultUseCase(prisma as any);
  const getResultsUseCase = new GetExperimentResultsUseCase(experimentRepo, prisma as any);

  const merchantId = "mrc_metrics_003";

  // Step 1: Create experiment
  const createResult = await createUseCase.execute({
    merchant_id: merchantId,
    name: "Metrics Test 003 - Tie",
    variants: [
      { name: "control", system_prompt: "Control prompt", weight: 50, is_control: true },
      { name: "treatment", system_prompt: "Treatment prompt", weight: 50, is_control: false },
    ],
  });

  // Step 2: Start experiment
  await startUseCase.execute({
    merchant_id: merchantId,
    experiment_id: createResult.experiment_id,
  });

  const experiment = await experimentRepo.findById(createResult.experiment_id, merchantId);
  assert.ok(experiment);
  const controlVariant = experiment.variants.find((v) => v.name === "control");
  const treatmentVariant = experiment.variants.find((v) => v.name === "treatment");
  assert.ok(controlVariant);
  assert.ok(treatmentVariant);

  // Step 3: Record identical conversions for both variants
  // Control: 100 sessions, 30 converted (30% conversion)
  for (let i = 0; i < 100; i++) {
    const sessionId = `session_ctrl_tie_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: controlVariant.id,
    });
    prisma.registerCheckoutSession(session);

    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    if (i < 30) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Treatment: 100 sessions, 30 converted (30% conversion) — SAME as control
  for (let i = 0; i < 100; i++) {
    const sessionId = `session_treat_tie_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: treatmentVariant.id,
    });
    prisma.registerCheckoutSession(session);

    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    if (i < 30) {
      await recordResultUseCase.execute({
        sessionId,
        merchantId,
        converted: true,
        revenue: 100,
      });
    }
  }

  // Step 4: Get results
  const results = await getResultsUseCase.execute(createResult.experiment_id, merchantId);
  assert.ok(results);

  const controlMetrics = results.variants.find((v) => v.variant_name === "control");
  const treatmentMetrics = results.variants.find((v) => v.variant_name === "treatment");

  assert.ok(controlMetrics);
  assert.ok(treatmentMetrics);

  // Both should have 30% conversion rate
  assert.equal(controlMetrics.conversion_rate, 30);
  assert.equal(treatmentMetrics.conversion_rate, 30);

  // Step 5: Calculate confidence
  const calculator = new SignificanceCalculator();
  const variantStats = results.variants.map((v) => ({
    variantId: v.variant_id,
    name: v.variant_name,
    sessions: v.sample_size,
    converted: v.conversions,
  }));

  const significance = calculator.calculateConfidence(variantStats);

  // With equal conversion rates, z=0, so confidence should be ~0.5
  assert.ok(significance.confidence > 0.45 && significance.confidence < 0.55,
    `Confidence with tie should be ≈0.5, got ${significance.confidence}`);
  assert.equal(significance.isSignificant, false, "Should not be significant (it's a tie)");
});
