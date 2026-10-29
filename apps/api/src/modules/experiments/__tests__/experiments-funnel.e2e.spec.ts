import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { RecordFunnelEventUseCase, type RecordFunnelEventInput, type FunnelStage } from "../application/use-cases/record-funnel-event.use-case.js";
import { RecordExperimentResultUseCase } from "../application/use-cases/record-experiment-result.use-case.js";

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

  // Return mock data with delegated operations
  get checkoutSession() {
    return {
      findFirst: async (opts: any) => {
        const where = opts.where || {};
        for (const session of this.checkoutSessions.values()) {
          if (
            where.merchantId && where.merchantId !== session.merchantId
          ) continue;
          if (
            where.sessionId && where.sessionId !== session.sessionId
          ) continue;
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
    merchantId: overrides?.merchantId ?? "mrc_funnel_test",
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

test("Funnel: Full funnel success (conversation → cart → checkout → purchase)", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);

  const merchantId = "mrc_funnel_full";
  const sessionId = "session_full_funnel";
  const variantId = "var_aggressive_123";

  // Register checkout session with variant assignment
  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // Step 1: Record conversation started
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "conversation_started",
  });

  let result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result, "Result should exist after conversation_started");
  assert.equal(result!.conversationStarted, true);

  // Step 2: Record cart viewed (at T+120s)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_viewed",
    metadata: { timeFromStart: 120 },
  });

  result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.cartViewed, true);
  assert.equal(result!.timeToCart, 120);

  // Step 3: Record cart items added (qty=2, at T+140s)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_item_added",
    metadata: { cartItemsAdded: 2, timeFromStart: 140 },
  });

  result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.cartItemsAdded, 2);

  // Step 4: Record checkout started (at T+300s)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "checkout_started",
    metadata: { timeFromStart: 300 },
  });

  result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.checkoutStarted, true);
  assert.equal(result!.timeToCheckout, 300);

  // Step 5: Record checkout completed (converted, at T+480s)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "checkout_completed",
    metadata: { timeFromStart: 480 },
  });

  result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.checkoutCompleted, true);
  assert.equal(result!.timeToConversion, 480);

  // Verify all flags are true (full funnel)
  assert.equal(result!.conversationStarted, true);
  assert.equal(result!.cartViewed, true);
  assert.equal(result!.checkoutStarted, true);
  assert.equal(result!.checkoutCompleted, true);
  assert.equal(result!.cartItemsAdded, 2);
});

test("Funnel: Drop-off at cart (conversation but no cart view)", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);

  const merchantId = "mrc_funnel_cart_dropoff";
  const sessionId = "session_cart_dropoff";
  const variantId = "var_consultive_456";

  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // Only record conversation start
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "conversation_started",
  });

  const result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result.conversationStarted, true);
  assert.equal(result.cartViewed, false, "Should never reach cart");
  assert.equal(result.checkoutCompleted, false, "Should not convert");
});

test("Funnel: Drop-off at checkout (items added but abandoned before purchase)", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);

  const merchantId = "mrc_funnel_checkout_dropoff";
  const sessionId = "session_checkout_dropoff";
  const variantId = "var_scarcity_789";

  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // Go through: conversation → cart → items → checkout START (but no completion)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "conversation_started",
  });

  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_viewed",
    metadata: { timeFromStart: 100 },
  });

  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_item_added",
    metadata: { cartItemsAdded: 1, timeFromStart: 150 },
  });

  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "checkout_started",
    metadata: { timeFromStart: 250 },
  });

  const result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.checkoutStarted, true, "Checkout was started");
  assert.equal(result!.checkoutCompleted, false, "But checkout was abandoned");
  assert.equal(result!.converted, false, "No conversion");
});

test("Funnel: Variant A outperforms B (conversion rate comparison)", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);
  const recordResultUseCase = new RecordExperimentResultUseCase(prisma as any);

  const merchantId = "mrc_funnel_ab_test";
  const variantA = "var_a_aggressive";
  const variantB = "var_b_consultive";

  // Create 10 sessions for Variant A, 4 convert
  for (let i = 0; i < 10; i++) {
    const sessionId = `session_a_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: variantA,
    });
    prisma.registerCheckoutSession(session);

    // All reach at least cart_viewed
    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    // 8 out of 10 reach checkout
    if (i < 8) {
      await recordFunnelUseCase.execute({
        merchantId,
        sessionId,
        stage: "checkout_started",
      });

      // 4 out of 8 actually convert
      if (i < 4) {
        await recordResultUseCase.execute({
          sessionId,
          merchantId,
          converted: true,
          revenue: 100,
        });
      }
    }
  }

  // Create 10 sessions for Variant B, 3 convert
  for (let i = 0; i < 10; i++) {
    const sessionId = `session_b_${i}`;
    const session = createMockCheckoutSession({
      merchantId,
      sessionId,
      promptVariantId: variantB,
    });
    prisma.registerCheckoutSession(session);

    // All reach at least cart_viewed
    await recordFunnelUseCase.execute({
      merchantId,
      sessionId,
      stage: "cart_viewed",
    });

    // 6 out of 10 reach checkout
    if (i < 6) {
      await recordFunnelUseCase.execute({
        merchantId,
        sessionId,
        stage: "checkout_started",
      });

      // 3 out of 6 convert
      if (i < 3) {
        await recordResultUseCase.execute({
          sessionId,
          merchantId,
          converted: true,
          revenue: 100,
        });
      }
    }
  }

  // Verify funnel metrics per variant
  const resultsA = prisma
    .getAllFunnelResults()
    .filter((r) => r.variantId === variantA);
  const resultsB = prisma
    .getAllFunnelResults()
    .filter((r) => r.variantId === variantB);

  assert.equal(resultsA.length, 10, "Should have 10 A results");
  assert.equal(resultsB.length, 10, "Should have 10 B results");

  // A conversion rate: 4/10 = 40%
  const aConverted = resultsA.filter((r) => r.converted).length;
  const aConversionRate = (aConverted / resultsA.length) * 100;

  // B conversion rate: 3/10 = 30%
  const bConverted = resultsB.filter((r) => r.converted).length;
  const bConversionRate = (bConverted / resultsB.length) * 100;

  assert.equal(aConversionRate, 40);
  assert.equal(bConversionRate, 30);
  assert.ok(aConversionRate > bConversionRate, "Variant A should outperform B");
});

test("Integration: CompleteOrder triggers RecordExperimentResult", async () => {
  const prisma = new MockPrismaClient();
  const recordResultUseCase = new RecordExperimentResultUseCase(prisma as any);

  const merchantId = "mrc_integration_complete_order";
  const sessionId = "session_integration_123";
  const variantId = "var_winner_999";

  // Setup session with variant
  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // Simulate CompleteOrder calling RecordExperimentResult
  await recordResultUseCase.execute({
    sessionId,
    merchantId,
    converted: true,
    revenue: 250,
    offersShown: 2,
    offersAccepted: 1,
    durationSeconds: 600,
  });

  const result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result, "Result should be recorded");
  assert.equal(result!.converted, true);
  assert.equal(result!.revenue, 250);
  assert.equal(result!.offersShown, 2);
  assert.equal(result!.offersAccepted, 1);
  assert.equal(result!.durationSeconds, 600);
});

test("Funnel: Timing metrics recorded at each stage", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);

  const merchantId = "mrc_funnel_timing";
  const sessionId = "session_timing_123";
  const variantId = "var_timing_test";

  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // T=0: Conversation started (baseline)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "conversation_started",
  });

  // T+120s: Cart viewed
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_viewed",
    metadata: { timeFromStart: 120 },
  });

  // T+300s: Checkout started
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "checkout_started",
    metadata: { timeFromStart: 300 },
  });

  // T+480s: Checkout completed
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "checkout_completed",
    metadata: { timeFromStart: 480 },
  });

  const result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.ok(result);
  assert.equal(result!.timeToCart, 120, "Should record cart timing");
  assert.equal(result!.timeToCheckout, 300, "Should record checkout start timing");
  assert.equal(result!.timeToConversion, 480, "Should record conversion timing");

  // Verify timing sequence
  assert.ok(result!.timeToCart! < result!.timeToCheckout!);
  assert.ok(result!.timeToCheckout! < result!.timeToConversion!);
});

test("Funnel: Idempotency — same event recorded twice = single row", async () => {
  const prisma = new MockPrismaClient();
  const recordFunnelUseCase = new RecordFunnelEventUseCase(prisma as any);

  const merchantId = "mrc_funnel_idempotency";
  const sessionId = "session_idempotency";
  const variantId = "var_idempotency_test";

  const session = createMockCheckoutSession({
    merchantId,
    sessionId,
    promptVariantId: variantId,
  });
  prisma.registerCheckoutSession(session);

  // Record cart_item_added twice with same qty
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_item_added",
    metadata: { cartItemsAdded: 1 },
  });

  let result = prisma.getPromptVariantResult(variantId, sessionId);
  assert.equal(result?.cartItemsAdded, 1, "First record: 1 item");

  // Record again (should increment due to upsert update with increment)
  await recordFunnelUseCase.execute({
    merchantId,
    sessionId,
    stage: "cart_item_added",
    metadata: { cartItemsAdded: 1 },
  });

  result = prisma.getPromptVariantResult(variantId, sessionId);
  // Note: Based on the use-case logic, cart_item_added increments cartItemsAdded in updates
  assert.equal(result?.cartItemsAdded, 2, "Second record: items should accumulate");

  // Verify only one row exists
  const allResults = prisma.getAllFunnelResults();
  const thisSessionResults = allResults.filter(
    (r) => r.variantId === variantId && r.sessionId === sessionId
  );
  assert.equal(thisSessionResults.length, 1, "Should have exactly 1 row despite 2 events");
});
